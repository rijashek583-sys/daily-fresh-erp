/**
 * Daily Fresh ERP — Firebase Cloud Functions
 *
 * Exported Callable Backend Functions for Daily Expense Tracker:
 * - recordExpense: Trusted expense creation with server business-day assignment
 * - updateExpense: Transactional expense modification with concurrency control
 * - manageAdminName: Admin Name Registry management (Admin only, zero deletion)
 */

import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';
import { validateAndFetchActiveUser } from './authValidation';
import {
  handleRecordExpense,
  handleUpdateExpense,
  handleVoidExpense,
  type RecordExpensePayload,
  type UpdateExpensePayload,
  type VoidExpensePayload,
} from './expenses';
import {
  handleManageAdminName,
  type ManageAdminNamePayload,
} from './adminNames';
import {
  handleRecordPayment,
  handleCorrectPayment,
  type RecordPaymentPayload,
  type CorrectPaymentPayload,
} from './payments';

// Initialize Firebase Admin app if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export const FUNCTION_REGION = 'asia-south1';

export const FUNCTION_OPTIONS = {
  region: FUNCTION_REGION,
  maxInstances: 5,
  timeoutSeconds: 15,
  memory: '256MiB' as const,
};

/**
 * Callable Function: recordExpense
 * Creates an expense with server-stamped business day and creator identity.
 */
export const recordExpense = onCall(FUNCTION_OPTIONS, async (request) => {
  const caller = await validateAndFetchActiveUser(db, request.auth?.uid);
  return await handleRecordExpense(db, caller, request.data as RecordExpensePayload);
});

/**
 * Callable Function: updateExpense
 * Updates an expense within an active business day using Firestore transaction.
 */
export const updateExpense = onCall(FUNCTION_OPTIONS, async (request) => {
  const caller = await validateAndFetchActiveUser(db, request.auth?.uid);
  return await handleUpdateExpense(db, caller, request.data as UpdateExpensePayload);
});

/**
 * Callable Function: voidExpense
 * Admin-only soft-delete (VOID) of an expense with mandatory reason and immutable audit trail.
 */
export const voidExpense = onCall(FUNCTION_OPTIONS, async (request) => {
  const caller = await validateAndFetchActiveUser(db, request.auth?.uid);
  return await handleVoidExpense(db, caller, request.data as VoidExpensePayload);
});

/**
 * Callable Function: manageAdminName
 * Manages operator display names for the shared Admin account.
 */
export const manageAdminName = onCall(FUNCTION_OPTIONS, async (request) => {
  const caller = await validateAndFetchActiveUser(db, request.auth?.uid);
  return await handleManageAdminName(db, caller, request.data as ManageAdminNamePayload);
});

/**
 * Callable Function: recordPayment
 * Authoritative transactional payment creation and proportional allocation.
 */
export const recordPayment = onCall(FUNCTION_OPTIONS, async (request) => {
  const caller = await validateAndFetchActiveUser(db, request.auth?.uid);
  return await handleRecordPayment(db, caller, request.data as RecordPaymentPayload);
});

/**
 * Callable Function: correctPayment
 * Authoritative transactional payment correction and attribution reversal (Admin only).
 */
export const correctPayment = onCall(FUNCTION_OPTIONS, async (request) => {
  const caller = await validateAndFetchActiveUser(db, request.auth?.uid);
  return await handleCorrectPayment(db, caller, request.data as CorrectPaymentPayload);
});

