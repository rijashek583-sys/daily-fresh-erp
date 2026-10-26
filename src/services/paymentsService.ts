/**
 * Daily Fresh ERP — Trusted Server-Side Payments Service Bridge
 *
 * Provides client-side invocations for trusted callable Cloud Functions:
 * 1. recordPayment: Authoritative server-side transactional payment recording.
 * 2. correctPayment: Authoritative server-side transactional payment correction and attribution reversal (Admin only).
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../lib/firebase';

export const FUNCTIONS_REGION = 'asia-south1';

const functions = getFunctions(app, FUNCTIONS_REGION);

export interface DirectSaleItemPayload {
  productId: string;
  productName: string;
  qty: number;
  unitPrice: number;
  total: number;
}

export interface DirectSalePayload {
  items: DirectSaleItemPayload[];
  date: string;
  division?: 'primary' | 'bakery';
  notes?: string | null;
  reference?: string | null;
}

export interface RecordPaymentServerPayload {
  clientId: string;
  amount: number;
  paymentDate?: string;
  billDate?: string;
  deliveryDate?: string;
  invoiceId?: string | null;
  otherInvoiceId?: string | null;
  division?: 'primary' | 'bakery';
  method: 'cash' | 'upi' | 'bank_transfer' | 'card';
  reference?: string | null;
  notes?: string | null;
  idempotencyKey: string;
  orderType?: 'client' | 'direct';
  directSale?: DirectSalePayload;
}

export interface CorrectPaymentServerPayload {
  paymentId: string;
  newAmount: number;
  correctionReason: string;
  division?: 'primary' | 'bakery';
  paymentDate?: string;
  method?: 'cash' | 'upi' | 'bank_transfer' | 'card';
  reference?: string | null;
  notes?: string | null;
  expectedFinancialRevision?: number;
}

export interface RecordPaymentServerResponse {
  success: boolean;
  paymentId?: string;
  orderId?: string;
  duplicate: boolean;
  message?: string;
  primaryAllocated: number;
  bakeryAllocated: number;
  excessCredit: number;
  financialRevision?: number;
}

export interface CorrectPaymentServerResponse {
  success: boolean;
  paymentId: string;
  originalAmount: number;
  newAmount: number;
  financialRevision: number;
}

/**
 * Invokes trusted backend Cloud Function: recordPayment
 */
export async function callRecordPayment(
  payload: RecordPaymentServerPayload
): Promise<RecordPaymentServerResponse> {
  const fn = httpsCallable<RecordPaymentServerPayload, RecordPaymentServerResponse>(
    functions,
    'recordPayment'
  );
  const res = await fn(payload);
  return res.data;
}

/**
 * Invokes trusted backend Cloud Function: correctPayment (Admin only)
 */
export async function callCorrectPayment(
  payload: CorrectPaymentServerPayload
): Promise<CorrectPaymentServerResponse> {
  const fn = httpsCallable<CorrectPaymentServerPayload, CorrectPaymentServerResponse>(
    functions,
    'correctPayment'
  );
  const res = await fn(payload);
  return res.data;
}
