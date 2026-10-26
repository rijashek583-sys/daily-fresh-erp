/**
 * Daily Fresh ERP — Daily Expense Tracker Type Definitions
 *
 * Isolated domain models for operational expense tracking and admin attribution.
 * Strictly decoupled from orders, billing, payments, customer ledgers, and stock.
 */

import { type Timestamp } from 'firebase/firestore';

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

export interface ExpenseEditAuditRecord {
  editedByUid: string;
  editorRole: 'admin' | 'staff' | 'delivery_staff';
  editorAdminName?: string;
  editedAt: string; // ISO 8601 string
  previousValues: {
    amount: number;
    category: PredefinedExpenseCategory;
    customExpenseName?: string;
    notes?: string;
    adminName?: string;
  };
  newValues: {
    amount: number;
    category: PredefinedExpenseCategory;
    customExpenseName?: string;
    notes?: string;
    adminName?: string;
  };
}

export interface ExpenseVoidAuditRecord {
  action: 'void';
  voidedByUid: string;
  voidedByName: string;
  voidedByRole: 'admin';
  voidedByAdminName?: string;
  voidedAt: string; // ISO 8601 string
  voidReason: string;
  previousValues: {
    amount: number;
    category: PredefinedExpenseCategory;
    customExpenseName?: string;
    notes?: string;
  };
}

export interface ExpenseDocument {
  id: string;

  // Business day partition (YYYY-MM-DD based on Asia/Kolkata 2:00 AM - 1:59:59 AM IST window)
  businessDay: string;

  // Expense details
  category: PredefinedExpenseCategory;
  customExpenseName?: string; // Required when category === 'Other Expense'
  amount: number; // Positive number > 0, rounded to 2 decimals
  notes?: string; // Optional context

  // Creator identity & attribution
  createdBy: string; // Firebase Auth UID
  creatorName: string; // User profile display name
  creatorRole: 'admin' | 'staff' | 'delivery_staff';
  adminName?: string; // Mandatory when creatorRole === 'admin'
  adminNameId?: string; // Firestore document ID in /adminNames

  // Timestamps
  createdAt: string; // ISO 8601 string
  createdServerTime?: Timestamp;
  updatedAt?: string;
  updatedServerTime?: Timestamp;

  // Immutability & audit trail
  isEdited: boolean;
  editCount: number;
  auditTrail: (ExpenseEditAuditRecord | ExpenseVoidAuditRecord)[];

  // Soft-delete / Void state (Admin-only action)
  isVoided?: boolean;
  voidReason?: string;
  voidedAt?: string;
  voidedByUid?: string;
  voidedByName?: string;
  voidedByRole?: 'admin';
  voidedByAdminName?: string;
}

export interface AdminNameDocument {
  id: string;
  name: string; // Display name (e.g. 'Rijash', 'Farooq')
  nameLower: string; // Lowercase for case-insensitive uniqueness
  status: 'active' | 'inactive'; // Soft deactivation protects historical references
  createdAt: string;
  createdByUid: string;
  updatedAt?: string;
}

export type ExpenseDatePreset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last7' | 'all' | 'custom';

export interface ExpenseFilter {
  preset: ExpenseDatePreset;
  customFromBusinessDay?: string; // YYYY-MM-DD
  customToBusinessDay?: string; // YYYY-MM-DD
  category?: PredefinedExpenseCategory | 'all';
  staffUid?: string | 'all';
  adminName?: string | 'all';
  search?: string;
}

export interface ExpenseCategoryBreakdown {
  category: PredefinedExpenseCategory;
  totalAmount: number;
  count: number;
  percentage: number;
}

export interface CustomExpenseBreakdown {
  customExpenseName: string;
  totalAmount: number;
  count: number;
}

export interface StaffExpenseBreakdown {
  staffUid: string;
  staffName: string;
  totalAmount: number;
  count: number;
}

export interface AdminAttributionBreakdown {
  adminName: string;
  totalAmount: number;
  count: number;
}

export interface ExpenseSummaryReport {
  totalAmount: number;
  totalCount: number;
  activeBusinessDay: string;
  dateRangeLabel: string;
  fromBusinessDay: string;
  toBusinessDay: string;
  categories: ExpenseCategoryBreakdown[];
  customOtherExpenses: CustomExpenseBreakdown[];
  staffBreakdown: StaffExpenseBreakdown[];
  adminAttributionBreakdown: AdminAttributionBreakdown[];
}
