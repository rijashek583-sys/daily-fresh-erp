/**
 * Daily Fresh ERP — Daily Expense Database Service
 *
 * Dedicated, completely isolated service for the /expenses collection.
 * Uses trusted Cloud Functions for creation and modifications, and scoped Firestore queries for real-time reads.
 *
 * ARCHITECTURAL BOUNDARY & SAFETY GUARANTEES:
 * 1. Zero Financial Coupling: Does NOT write to /orders, /payments, /ledger, /clients, or /stock.
 * 2. Strict No-Deletion: Absolutely no deletion functions are exposed; records are immutable post-day.
 * 3. 2:00 AM IST Cutoff: Enforced by trusted server time in Cloud Functions.
 * 4. Audit Trail: Every single edit appends an immutable audit snapshot in Cloud Functions.
 * 5. Role Attribution: Admin records require operator attribution from /adminNames.
 */

import {
  collection,
  getDocs,
  query,
  where,
  onSnapshot,
  type FirestoreError,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, db } from '../lib/firebase';
import {
  type ExpenseDocument,
  type PredefinedExpenseCategory,
  type ExpenseSummaryReport,
  type ExpenseCategoryBreakdown,
  type CustomExpenseBreakdown,
  type StaffExpenseBreakdown,
  type AdminAttributionBreakdown,
  PREDEFINED_EXPENSE_CATEGORIES,
} from '../types/expense.types';
import { type AppUser } from '../types/auth.types';
import { getBusinessDayKey } from '../lib/businessDay';

export const EXPENSES_COLLECTION = 'expenses';
export const FUNCTIONS_REGION = 'asia-south1';

const functions = getFunctions(app, FUNCTIONS_REGION);

export interface ExpenseCreationPayload {
  amount: number;
  category: PredefinedExpenseCategory;
  customExpenseName?: string;
  notes?: string;
  adminName?: string;
  adminNameId?: string;
}

export interface ExpenseUpdatePayload {
  amount?: number;
  category?: PredefinedExpenseCategory;
  customExpenseName?: string;
  notes?: string;
  editorAdminName?: string;
}

/**
 * Validates expense creation payload and user authorization for immediate client UI feedback.
 */
export function validateExpenseCreation(
  payload: ExpenseCreationPayload,
  currentUser: AppUser
): { valid: boolean; error?: string } {
  if (!currentUser || !currentUser.uid) {
    return { valid: false, error: 'User must be authenticated to record an expense.' };
  }

  // 1. Amount validation
  if (typeof payload.amount !== 'number' || isNaN(payload.amount) || payload.amount <= 0) {
    return { valid: false, error: 'Expense amount must be a positive number greater than 0.' };
  }

  // 2. Category validation
  if (!payload.category || !PREDEFINED_EXPENSE_CATEGORIES.includes(payload.category)) {
    return {
      valid: false,
      error: `Invalid category. Must be one of: ${PREDEFINED_EXPENSE_CATEGORIES.join(', ')}`,
    };
  }

  // 3. Custom expense name requirement for 'Other Expense'
  if (payload.category === 'Other Expense') {
    if (!payload.customExpenseName || typeof payload.customExpenseName !== 'string') {
      return { valid: false, error: 'A specific expense name is required when category is "Other Expense".' };
    }
    const trimmed = payload.customExpenseName.trim();
    if (trimmed.length < 2) {
      return { valid: false, error: 'Specific expense name must be at least 2 characters.' };
    }
    if (trimmed.length > 50) {
      return { valid: false, error: 'Specific expense name cannot exceed 50 characters.' };
    }
  }

  // 4. Notes validation
  if (payload.notes && payload.notes.length > 500) {
    return { valid: false, error: 'Notes cannot exceed 500 characters.' };
  }

  // 5. Admin attribution requirement
  if (currentUser.role === 'admin') {
    if (!payload.adminName || !payload.adminName.trim()) {
      return { valid: false, error: 'Admin operator name is required to attribute expenses recorded under the Admin account.' };
    }
    if (!payload.adminNameId || !payload.adminNameId.trim()) {
      return { valid: false, error: 'A registered Admin Name selection is required.' };
    }
  } else {
    // Staff cannot attach admin attribution
    if (payload.adminName || payload.adminNameId) {
      return { valid: false, error: 'Staff members cannot record expenses under an Admin display name.' };
    }
  }

  return { valid: true };
}

/**
 * Creates a new expense record via the trusted recordExpense Cloud Function.
 * Authoritative business day is assigned on the server using trusted 2:00 AM IST cutoff.
 */
export async function createExpenseRecord(
  payload: ExpenseCreationPayload,
  currentUser: AppUser
): Promise<string> {
  const validation = validateExpenseCreation(payload, currentUser);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  try {
    const recordExpenseFn = httpsCallable<
      {
        amount: number;
        category: PredefinedExpenseCategory;
        customExpenseName?: string | null;
        notes?: string | null;
        adminName?: string | null;
        adminNameId?: string | null;
      },
      { success: boolean; expenseId: string; businessDay: string }
    >(functions, 'recordExpense');

    const res = await recordExpenseFn({
      amount: payload.amount,
      category: payload.category,
      customExpenseName: payload.category === 'Other Expense' ? payload.customExpenseName?.trim() : null,
      notes: payload.notes?.trim() || null,
      adminName: currentUser.role === 'admin' ? payload.adminName?.trim() : null,
      adminNameId: currentUser.role === 'admin' ? payload.adminNameId?.trim() : null,
    });

    return res.data.expenseId;
  } catch (err: any) {
    throw new Error(err?.message || 'Failed to record expense.');
  }
}

/**
 * Updates an existing expense record via the trusted updateExpense Cloud Function.
 * STRICT SERVER ENFORCEMENTS:
 * 1. Expenses from previous business days are locked permanently.
 * 2. Staff members can only edit their own expense records.
 * 3. Immutable creator fields are strictly preserved.
 * 4. Optimistic concurrency control via Firestore transaction.
 * 5. Appends an atomic audit snapshot to auditTrail.
 */
export async function updateExpenseRecord(
  expenseId: string,
  updates: ExpenseUpdatePayload,
  currentUser: AppUser
): Promise<void> {
  if (!expenseId) throw new Error('Expense ID is required.');
  if (!currentUser || !currentUser.uid) throw new Error('Authentication required to edit expenses.');

  try {
    const updateExpenseFn = httpsCallable<
      {
        expenseId: string;
        amount?: number;
        category?: PredefinedExpenseCategory;
        customExpenseName?: string | null;
        notes?: string | null;
        editorAdminName?: string | null;
      },
      { success: boolean; updatedBusinessDay: string }
    >(functions, 'updateExpense');

    await updateExpenseFn({
      expenseId,
      amount: updates.amount,
      category: updates.category,
      customExpenseName: updates.customExpenseName !== undefined ? updates.customExpenseName?.trim() || null : undefined,
      notes: updates.notes !== undefined ? updates.notes?.trim() || null : undefined,
      editorAdminName: currentUser.role === 'admin' ? (updates.editorAdminName?.trim() || null) : undefined,
    });
  } catch (err: any) {
    throw new Error(err?.message || 'Failed to update expense.');
  }
}

/**
 * Voids (soft-deletes) an expense record via the trusted voidExpense Cloud Function.
 * STRICT ENFORCEMENTS:
 * 1. Admin only.
 * 2. Non-empty void reason required (min 3 chars).
 * 3. Immutable audit snapshot recorded in Cloud Function.
 * 4. Preserves historical record while excluding from active totals.
 */
export async function voidExpenseRecord(
  expenseId: string,
  voidReason: string,
  currentUser: AppUser,
  adminName?: string
): Promise<void> {
  if (!expenseId) throw new Error('Expense ID is required to void.');
  if (!currentUser || currentUser.role !== 'admin') {
    throw new Error('Unauthorized: Only administrators can void expenses.');
  }
  if (!voidReason || voidReason.trim().length < 3) {
    throw new Error('A valid reason (at least 3 characters) is required to void an expense.');
  }

  try {
    const voidExpenseFn = httpsCallable<
      {
        expenseId: string;
        voidReason: string;
        adminName?: string | null;
      },
      { success: boolean; expenseId: string; voidedAt: string }
    >(functions, 'voidExpense');

    await voidExpenseFn({
      expenseId,
      voidReason: voidReason.trim(),
      adminName: adminName?.trim() || null,
    });
  } catch (err: any) {
    throw new Error(err?.message || 'Failed to void expense.');
  }
}

/**
 * Subscribes in real time to expenses for a specific business day.
 * Admins see all expenses; Staff see only their own.
 */
export function subscribeToExpensesByBusinessDay(
  businessDay: string,
  currentUser: AppUser,
  callback: (expenses: ExpenseDocument[]) => void,
  onError?: (err: FirestoreError) => void
): () => void {
  const colRef = collection(db, EXPENSES_COLLECTION);
  const isAdmin = currentUser.role === 'admin';

  const q = isAdmin
    ? query(colRef, where('businessDay', '==', businessDay))
    : query(colRef, where('businessDay', '==', businessDay), where('createdBy', '==', currentUser.uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const records: ExpenseDocument[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ExpenseDocument, 'id'>),
      }));

      // Sort descending by creation timestamp in memory (ensures zero index dependency)
      records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      callback(records);
    },
    (err) => {
      console.error('[ExpenseDb] Subscription error:', err);
      onError?.(err);
    }
  );
}

/**
 * Subscribes to recent personal expenses for a staff member.
 */
export function subscribeToStaffExpenses(
  currentUser: AppUser,
  callback: (expenses: ExpenseDocument[]) => void,
  onError?: (err: FirestoreError) => void
): () => void {
  const colRef = collection(db, EXPENSES_COLLECTION);
  const q = query(colRef, where('createdBy', '==', currentUser.uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const records: ExpenseDocument[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ExpenseDocument, 'id'>),
      }));

      records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      callback(records);
    },
    (err) => {
      console.error('[ExpenseDb] Staff expenses subscription error:', err);
      onError?.(err);
    }
  );
}

/**
 * Fetches expenses across a business day range.
 * If user is staff, scopes query to their own created expenses to satisfy Firestore Security Rules.
 */
export async function getExpensesByBusinessDayRange(
  fromBusinessDay: string,
  toBusinessDay: string,
  currentUser: AppUser
): Promise<ExpenseDocument[]> {
  const colRef = collection(db, EXPENSES_COLLECTION);
  const q = currentUser.role === 'admin'
    ? query(
        colRef,
        where('businessDay', '>=', fromBusinessDay),
        where('businessDay', '<=', toBusinessDay)
      )
    : query(
        colRef,
        where('createdBy', '==', currentUser.uid),
        where('businessDay', '>=', fromBusinessDay),
        where('businessDay', '<=', toBusinessDay)
      );

  const snapshot = await getDocs(q);
  const records: ExpenseDocument[] = snapshot.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<ExpenseDocument, 'id'>),
  }));

  // Sort by businessDay desc, then createdAt desc
  records.sort((a, b) => {
    if (a.businessDay !== b.businessDay) {
      return b.businessDay.localeCompare(a.businessDay);
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return records;
}

/**
 * Computes aggregations, breakdowns, and totals for an expense list.
 */
export function calculateExpenseSummary(
  expenses: ExpenseDocument[],
  fromBusinessDay: string,
  toBusinessDay: string,
  dateRangeLabel: string
): ExpenseSummaryReport {
  let totalAmount = 0;

  // Financial audit rule: voided expenses are strictly excluded from active totals and summaries
  const activeExpenses = expenses.filter((exp) => !exp.isVoided);

  const categoryMap: Record<PredefinedExpenseCategory, { totalAmount: number; count: number }> = {
    CNG: { totalAmount: 0, count: 0 },
    Petrol: { totalAmount: 0, count: 0 },
    Diesel: { totalAmount: 0, count: 0 },
    'Daily Food Expense': { totalAmount: 0, count: 0 },
    Toll: { totalAmount: 0, count: 0 },
    'Bus Charge': { totalAmount: 0, count: 0 },
    'Other Expense': { totalAmount: 0, count: 0 },
  };

  const customMap: Record<string, { totalAmount: number; count: number }> = {};
  const staffMap: Record<string, { staffName: string; totalAmount: number; count: number }> = {};
  const adminMap: Record<string, { totalAmount: number; count: number }> = {};

  activeExpenses.forEach((exp) => {
    totalAmount += exp.amount;

    // Category breakdown
    if (categoryMap[exp.category]) {
      categoryMap[exp.category].totalAmount += exp.amount;
      categoryMap[exp.category].count += 1;
    }

    // Custom Other Expense breakdown
    if (exp.category === 'Other Expense' && exp.customExpenseName) {
      const name = exp.customExpenseName.trim();
      if (!customMap[name]) customMap[name] = { totalAmount: 0, count: 0 };
      customMap[name].totalAmount += exp.amount;
      customMap[name].count += 1;
    }

    // Staff breakdown
    const staffUid = exp.createdBy;
    const staffName = exp.creatorName || 'Unknown';
    if (!staffMap[staffUid]) {
      staffMap[staffUid] = { staffName, totalAmount: 0, count: 0 };
    }
    staffMap[staffUid].totalAmount += exp.amount;
    staffMap[staffUid].count += 1;

    // Admin attribution breakdown
    if (exp.adminName) {
      const adminName = exp.adminName.trim();
      if (!adminMap[adminName]) adminMap[adminName] = { totalAmount: 0, count: 0 };
      adminMap[adminName].totalAmount += exp.amount;
      adminMap[adminName].count += 1;
    }
  });

  const categories: ExpenseCategoryBreakdown[] = PREDEFINED_EXPENSE_CATEGORIES.map((cat) => {
    const data = categoryMap[cat];
    const percentage = totalAmount > 0 ? Math.round((data.totalAmount / totalAmount) * 1000) / 10 : 0;
    return {
      category: cat,
      totalAmount: Math.round(data.totalAmount * 100) / 100,
      count: data.count,
      percentage,
    };
  });

  const customOtherExpenses: CustomExpenseBreakdown[] = Object.entries(customMap)
    .map(([customExpenseName, data]) => ({
      customExpenseName,
      totalAmount: Math.round(data.totalAmount * 100) / 100,
      count: data.count,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  const staffBreakdown: StaffExpenseBreakdown[] = Object.entries(staffMap)
    .map(([staffUid, data]) => ({
      staffUid,
      staffName: data.staffName,
      totalAmount: Math.round(data.totalAmount * 100) / 100,
      count: data.count,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  const adminAttributionBreakdown: AdminAttributionBreakdown[] = Object.entries(adminMap)
    .map(([adminName, data]) => ({
      adminName,
      totalAmount: Math.round(data.totalAmount * 100) / 100,
      count: data.count,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  return {
    totalAmount: Math.round(totalAmount * 100) / 100,
    totalCount: activeExpenses.length,
    activeBusinessDay: getBusinessDayKey(),
    dateRangeLabel,
    fromBusinessDay,
    toBusinessDay,
    categories,
    customOtherExpenses,
    staffBreakdown,
    adminAttributionBreakdown,
  };
}
