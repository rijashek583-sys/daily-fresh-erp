/**
 * Daily Fresh ERP — Trusted Expense Backend Functions
 *
 * Implements server-side expense creation and editing with:
 * 1. Trusted 2:00 AM IST Business-Day assignment and lockout.
 * 2. Concurrency control via Firestore runTransaction.
 * 3. Strict creator and attribution immutability.
 * 4. Append-only audit trailing.
 * 5. Strict zero deletion.
 */

import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { type AuthenticatedUser } from './authValidation';
import { getServerBusinessDayKey } from './businessDayServer';
import { ADMIN_NAMES_COLLECTION } from './adminNames';

export const EXPENSES_COLLECTION = 'expenses';

export type PredefinedExpenseCategory =
  | 'CNG'
  | 'Petrol'
  | 'Diesel'
  | 'Daily Food Expense'
  | 'Toll'
  | 'Bus Charge'
  | 'Other Expense';

export const PREDEFINED_EXPENSE_CATEGORIES: PredefinedExpenseCategory[] = [
  'CNG',
  'Petrol',
  'Diesel',
  'Daily Food Expense',
  'Toll',
  'Bus Charge',
  'Other Expense',
];

export interface RecordExpensePayload {
  amount: number;
  category: PredefinedExpenseCategory;
  customExpenseName?: string | null;
  notes?: string | null;
  adminName?: string | null;
  adminNameId?: string | null;
}

export interface UpdateExpensePayload {
  expenseId: string;
  amount?: number;
  category?: PredefinedExpenseCategory;
  customExpenseName?: string | null;
  notes?: string | null;
  editorAdminName?: string | null;
}

export interface VoidExpensePayload {
  expenseId: string;
  voidReason: string;
  adminName?: string | null;
  adminNameId?: string | null;
}

export interface ExpenseEditAuditRecord {
  editedByUid: string;
  editorRole: 'admin' | 'staff' | 'delivery_staff';
  editorAdminName?: string | null;
  editedAt: string;
  previousValues: {
    amount: number;
    category: PredefinedExpenseCategory;
    customExpenseName?: string | null;
    notes?: string | null;
  };
  newValues: {
    amount: number;
    category: PredefinedExpenseCategory;
    customExpenseName?: string | null;
    notes?: string | null;
  };
}

export interface ExpenseVoidAuditRecord {
  action: 'void';
  voidedByUid: string;
  voidedByName: string;
  voidedByRole: 'admin';
  voidedByAdminName?: string | null;
  voidedAt: string;
  voidReason: string;
  previousValues: {
    amount: number;
    category: PredefinedExpenseCategory;
    customExpenseName?: string | null;
    notes?: string | null;
  };
}

export interface ExpenseDocument {
  id: string;
  businessDay: string;
  category: PredefinedExpenseCategory;
  customExpenseName?: string | null;
  amount: number;
  notes?: string | null;
  createdBy: string;
  creatorName: string;
  creatorRole: 'admin' | 'staff' | 'delivery_staff';
  adminName?: string | null;
  adminNameId?: string | null;
  createdAt: string;
  createdServerTime?: admin.firestore.Timestamp;
  updatedAt?: string;
  updatedServerTime?: admin.firestore.Timestamp;
  isEdited: boolean;
  editCount: number;
  auditTrail: (ExpenseEditAuditRecord | ExpenseVoidAuditRecord)[];
  isVoided?: boolean;
  voidReason?: string;
  voidedAt?: string;
  voidedByUid?: string;
  voidedByName?: string;
  voidedByRole?: 'admin';
  voidedByAdminName?: string | null;
}

/**
 * Validates input parameters for creating an expense.
 */
export async function validateRecordExpenseInput(
  firestore: admin.firestore.Firestore,
  caller: AuthenticatedUser,
  payload: RecordExpensePayload
): Promise<{
  validatedAmount: number;
  validatedCategory: PredefinedExpenseCategory;
  validatedCustomName: string | null;
  validatedNotes: string | null;
  validatedAdminName: string | null;
  validatedAdminNameId: string | null;
}> {
  // 1. Amount validation
  if (typeof payload.amount !== 'number' || isNaN(payload.amount) || payload.amount <= 0) {
    throw new HttpsError('invalid-argument', 'Expense amount must be a positive number greater than 0.');
  }
  const validatedAmount = Math.round(payload.amount * 100) / 100;

  // 2. Category validation
  if (!payload.category || !PREDEFINED_EXPENSE_CATEGORIES.includes(payload.category)) {
    throw new HttpsError(
      'invalid-argument',
      `Invalid category. Must be one of: ${PREDEFINED_EXPENSE_CATEGORIES.join(', ')}`
    );
  }
  const validatedCategory = payload.category;

  // 3. Custom expense name requirement for 'Other Expense'
  let validatedCustomName: string | null = null;
  if (validatedCategory === 'Other Expense') {
    if (!payload.customExpenseName || typeof payload.customExpenseName !== 'string') {
      throw new HttpsError('invalid-argument', 'A specific expense name is required when category is "Other Expense".');
    }
    const trimmed = payload.customExpenseName.trim();
    if (trimmed.length < 2 || trimmed.length > 50) {
      throw new HttpsError('invalid-argument', 'Specific expense name must be between 2 and 50 characters.');
    }
    validatedCustomName = trimmed;
  }

  // 4. Notes validation
  let validatedNotes: string | null = null;
  if (payload.notes) {
    if (typeof payload.notes !== 'string') {
      throw new HttpsError('invalid-argument', 'Notes must be a string.');
    }
    const trimmed = payload.notes.trim();
    if (trimmed.length > 500) {
      throw new HttpsError('invalid-argument', 'Notes cannot exceed 500 characters.');
    }
    validatedNotes = trimmed || null;
  }

  // 5. Admin Attribution vs Staff validation
  let validatedAdminName: string | null = null;
  let validatedAdminNameId: string | null = null;

  if (caller.role === 'admin') {
    if (!payload.adminName || !payload.adminNameId) {
      throw new HttpsError(
        'invalid-argument',
        'Admin operator attribution (adminName and adminNameId) is mandatory for expenses recorded under the Admin account.'
      );
    }

    // Verify active record in /adminNames
    const adminDocRef = firestore.collection(ADMIN_NAMES_COLLECTION).doc(payload.adminNameId);
    const adminSnap = await adminDocRef.get();

    if (!adminSnap.exists) {
      throw new HttpsError('not-found', `Selected Admin Name ID "${payload.adminNameId}" does not exist in registry.`);
    }

    const adminData = adminSnap.data();
    if (adminData?.status !== 'active') {
      throw new HttpsError('failed-precondition', `Selected Admin Name "${adminData?.name}" is currently deactivated.`);
    }

    validatedAdminName = adminData.name;
    validatedAdminNameId = adminSnap.id;
  } else {
    // Staff cannot attach adminName
    if (payload.adminName || payload.adminNameId) {
      throw new HttpsError('invalid-argument', 'Staff members cannot record expenses under an Admin display name.');
    }
  }

  return {
    validatedAmount,
    validatedCategory,
    validatedCustomName,
    validatedNotes,
    validatedAdminName,
    validatedAdminNameId,
  };
}

/**
 * Handles backend creation of an expense document using trusted server time.
 */
export async function handleRecordExpense(
  firestore: admin.firestore.Firestore,
  caller: AuthenticatedUser,
  payload: RecordExpensePayload,
  nowMs: number = Date.now()
): Promise<{ success: boolean; expenseId: string; businessDay: string }> {
  const {
    validatedAmount,
    validatedCategory,
    validatedCustomName,
    validatedNotes,
    validatedAdminName,
    validatedAdminNameId,
  } = await validateRecordExpenseInput(firestore, caller, payload);

  // Authoritative server business day
  const businessDay = getServerBusinessDayKey(nowMs);
  const docId = `exp_${nowMs}_${Math.random().toString(36).slice(2, 7)}`;
  const docRef = firestore.collection(EXPENSES_COLLECTION).doc(docId);

  const newRecord: ExpenseDocument = {
    id: docId,
    businessDay,
    category: validatedCategory,
    customExpenseName: validatedCustomName,
    amount: validatedAmount,
    notes: validatedNotes,
    createdBy: caller.uid,
    creatorName: caller.displayName,
    creatorRole: caller.role,
    adminName: validatedAdminName,
    adminNameId: validatedAdminNameId,
    createdAt: new Date(nowMs).toISOString(),
    isEdited: false,
    editCount: 0,
    auditTrail: [],
  };

  await docRef.set({
    ...newRecord,
    createdServerTime: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    success: true,
    expenseId: docId,
    businessDay,
  };
}

/**
 * Handles transactional editing of an existing expense document.
 * Enforces server business-day cutoff, concurrency re-checks, and immutable creator attribution.
 */
export async function handleUpdateExpense(
  firestore: admin.firestore.Firestore,
  caller: AuthenticatedUser,
  payload: UpdateExpensePayload,
  nowMsProvider?: number | (() => number)
): Promise<{ success: boolean; updatedBusinessDay: string }> {
  if (!payload.expenseId) {
    throw new HttpsError('invalid-argument', 'expenseId is required for editing an expense.');
  }

  const docRef = firestore.collection(EXPENSES_COLLECTION).doc(payload.expenseId);

  // Validate editorAdminName if caller is Admin
  let validatedEditorAdminName: string | null = null;
  if (caller.role === 'admin') {
    if (!payload.editorAdminName || typeof payload.editorAdminName !== 'string' || !payload.editorAdminName.trim()) {
      throw new HttpsError('invalid-argument', 'Admin operator attribution (editorAdminName) is required when an Admin edits an expense.');
    }
    validatedEditorAdminName = payload.editorAdminName.trim();
  }

  let committedBusinessDay: string = '';

  // Execute in Firestore transaction for optimistic concurrency control
  await firestore.runTransaction(async (transaction) => {
    // Re-evaluate trusted server time fresh on EVERY transaction attempt
    const txNowMs =
      typeof nowMsProvider === 'function'
        ? nowMsProvider()
        : typeof nowMsProvider === 'number'
        ? nowMsProvider
        : Date.now();

    // 1. Transactional re-read of current document state
    const expenseSnap = await transaction.get(docRef);
    if (!expenseSnap.exists) {
      throw new HttpsError('not-found', 'Expense record not found.');
    }

    const existing = expenseSnap.data() as ExpenseDocument;

    // Check if expense has already been voided
    if (existing.isVoided) {
      throw new HttpsError(
        'failed-precondition',
        'Voided expenses cannot be edited.'
      );
    }

    // 2. Concurrency re-check: verify current server business day at commit instant
    const currentServerBusinessDay = getServerBusinessDayKey(txNowMs);
    if (existing.businessDay !== currentServerBusinessDay) {
      throw new HttpsError(
        'failed-precondition',
        'Editing closed: Expenses from previous business days are permanently locked.'
      );
    }

    // 3. Authorization check inside transaction
    if (caller.role !== 'admin' && existing.createdBy !== caller.uid) {
      throw new HttpsError(
        'permission-denied',
        'Unauthorized: Staff members can only edit their own expense records.'
      );
    }

    // 4. Validate updated mutable fields
    const newAmount = payload.amount !== undefined ? Math.round(payload.amount * 100) / 100 : existing.amount;
    if (newAmount <= 0 || isNaN(newAmount)) {
      throw new HttpsError('invalid-argument', 'Expense amount must be a positive number greater than 0.');
    }

    const newCategory = payload.category !== undefined ? payload.category : existing.category;
    if (!PREDEFINED_EXPENSE_CATEGORIES.includes(newCategory)) {
      throw new HttpsError('invalid-argument', `Invalid category: ${newCategory}`);
    }

    let newCustomName = existing.customExpenseName;
    if (newCategory === 'Other Expense') {
      newCustomName = payload.customExpenseName !== undefined ? payload.customExpenseName?.trim() || null : existing.customExpenseName;
      if (!newCustomName || newCustomName.length < 2 || newCustomName.length > 50) {
        throw new HttpsError('invalid-argument', 'Specific expense name must be between 2 and 50 characters.');
      }
    } else {
      newCustomName = null;
    }

    const newNotes = payload.notes !== undefined ? (payload.notes?.trim() || null) : existing.notes;
    if (newNotes && newNotes.length > 500) {
      throw new HttpsError('invalid-argument', 'Notes cannot exceed 500 characters.');
    }

    // 5. Construct immutable audit record snapshot
    const auditRecord: ExpenseEditAuditRecord = {
      editedByUid: caller.uid,
      editorRole: caller.role,
      editorAdminName: validatedEditorAdminName,
      editedAt: new Date(txNowMs).toISOString(),
      previousValues: {
        amount: existing.amount,
        category: existing.category,
        customExpenseName: existing.customExpenseName || null,
        notes: existing.notes || null,
      },
      newValues: {
        amount: newAmount,
        category: newCategory,
        customExpenseName: newCustomName || null,
        notes: newNotes,
      },
    };

    // 6. Strict Immutability of Creator and Root Attribution Fields:
    // Root fields (createdBy, creatorRole, creatorName, createdAt, createdServerTime, adminName, adminNameId)
    // are EXCLUDED from the update payload. For Staff expenses edited by Admin, root attribution remains unchanged.
    transaction.update(docRef, {
      amount: newAmount,
      category: newCategory,
      customExpenseName: newCustomName,
      notes: newNotes,
      isEdited: true,
      editCount: (existing.editCount || 0) + 1,
      updatedAt: new Date(txNowMs).toISOString(),
      updatedServerTime: admin.firestore.FieldValue.serverTimestamp(),
      auditTrail: admin.firestore.FieldValue.arrayUnion(auditRecord),
    });

    committedBusinessDay = currentServerBusinessDay;
  });

  return {
    success: true,
    updatedBusinessDay: committedBusinessDay,
  };
}

/**
 * Handles non-destructive soft-delete (VOID) of an expense document.
 *
 * SAFETY INVARIANTS:
 * 1. Strict Admin Authorization: Only users with role === 'admin' can void expenses.
 * 2. Required Reason: A non-empty reason (at least 3 characters) is strictly mandatory.
 * 3. In-Record Preservation: Original document, amount, category, and creator attribution remain intact.
 * 4. Idempotency & Concurrency: Firestore transaction ensures an already voided expense cannot be voided twice.
 * 5. Immutable Audit Trail: Appends an audit entry recording the void reason, timestamp, and admin identity.
 */
export async function handleVoidExpense(
  firestore: admin.firestore.Firestore,
  caller: AuthenticatedUser,
  payload: VoidExpensePayload,
  nowMsProvider?: number | (() => number)
): Promise<{ success: boolean; expenseId: string; voidedAt: string }> {
  // 1. Authorization: Only Admins can void expenses
  if (caller.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Unauthorized: Only administrators can void expenses.');
  }

  // 2. Validation: Expense ID
  if (!payload.expenseId || typeof payload.expenseId !== 'string') {
    throw new HttpsError('invalid-argument', 'expenseId is required to void an expense.');
  }

  // 3. Validation: Non-empty void reason
  if (!payload.voidReason || typeof payload.voidReason !== 'string' || payload.voidReason.trim().length < 3) {
    throw new HttpsError('invalid-argument', 'A valid void reason (at least 3 characters) is required to void an expense.');
  }

  const trimmedReason = payload.voidReason.trim();
  if (trimmedReason.length > 500) {
    throw new HttpsError('invalid-argument', 'Void reason cannot exceed 500 characters.');
  }

  const docRef = firestore.collection(EXPENSES_COLLECTION).doc(payload.expenseId);
  let committedVoidedAt: string = '';

  await firestore.runTransaction(async (transaction) => {
    const txNowMs =
      typeof nowMsProvider === 'function'
        ? nowMsProvider()
        : typeof nowMsProvider === 'number'
        ? nowMsProvider
        : Date.now();

    const expenseSnap = await transaction.get(docRef);
    if (!expenseSnap.exists) {
      throw new HttpsError('not-found', 'Expense record not found.');
    }

    const existing = expenseSnap.data() as ExpenseDocument;

    // Reject repeated void safely (idempotent / failed-precondition)
    if (existing.isVoided) {
      throw new HttpsError('failed-precondition', 'Expense has already been voided.');
    }

    const voidedAt = new Date(txNowMs).toISOString();
    const adminName = payload.adminName?.trim() || existing.adminName || 'Admin';

    const auditRecord: ExpenseVoidAuditRecord = {
      action: 'void',
      voidedByUid: caller.uid,
      voidedByName: caller.displayName,
      voidedByRole: 'admin',
      voidedByAdminName: adminName,
      voidedAt,
      voidReason: trimmedReason,
      previousValues: {
        amount: existing.amount,
        category: existing.category,
        customExpenseName: existing.customExpenseName || null,
        notes: existing.notes || null,
      },
    };

    transaction.update(docRef, {
      isVoided: true,
      voidReason: trimmedReason,
      voidedAt,
      voidedByUid: caller.uid,
      voidedByName: caller.displayName,
      voidedByRole: 'admin',
      voidedByAdminName: adminName,
      updatedAt: voidedAt,
      updatedServerTime: admin.firestore.FieldValue.serverTimestamp(),
      auditTrail: admin.firestore.FieldValue.arrayUnion(auditRecord),
    });

    committedVoidedAt = voidedAt;
  });

  return {
    success: true,
    expenseId: payload.expenseId,
    voidedAt: committedVoidedAt,
  };
}

