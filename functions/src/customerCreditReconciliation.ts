import type * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { validateAndFetchActiveUser } from './authValidation';

type Data = Record<string, unknown>;
export interface ReviewDocument { id: string; data: Data }
export interface ReviewSources { clientId: string; client: ReviewDocument; orders: ReviewDocument[]; payments: ReviewDocument[]; ledger: ReviewDocument[]; balance: ReviewDocument | null }
export interface ReviewFinding { code: string; recordIds: string[]; detail: string }
export interface TrustedCreditReport {
  clientId: string;
  persistedFacts: { activeOrderCredits: { id: string; creditApplied: unknown; primaryCreditApplied: unknown; bakeryCreditApplied: unknown }[]; ledger: ReviewDocument[]; balance: ReviewDocument | null };
  legacyAggregates: Data;
  blockingFindings: ReviewFinding[];
  limitations: string[];
  proposedSpendableCredit: null;
  sourceFingerprint: string;
}

// Canonical full-document snapshot, including timestamps, sorted independently of query order.
function canonical(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value) {
    const obj = value as Data;
    if (typeof obj.toDate === 'function') return { '$timestamp': (obj.toDate as () => Date)().toISOString() };
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Unsupported Firestore value in reconciliation snapshot');
    return Object.fromEntries(Object.keys(obj).sort().map(k => [k, canonical(obj[k])]));
  }
  throw new Error('Unsupported value in reconciliation snapshot');
}
const validId = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const division = (v: unknown): boolean => v === 'primary' || v === 'bakery';
const paise = (v: unknown): number | null => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || !Number.isSafeInteger(Math.round(v * 100)) || Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) return null;
  return Math.round(v * 100);
};

/** Read-only review; persisted amounts are evidence, never an approval or spendable balance.
 * Payment policy is proportional by eligible division dues, selected delivery date first,
 * previous dates oldest first; invoice mapping is unresolved. Credit is Primary-first.
 * This report does not rewrite historical allocations or split payments across orders.
 */
export function buildTrustedCreditReport(source: ReviewSources): TrustedCreditReport {
  const findings: ReviewFinding[] = [];
  const add = (code: string, ids: string[], detail: string) => findings.push({ code, recordIds: [...ids].sort(), detail });
  const sorted = (docs: ReviewDocument[]) => [...docs].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const orders = sorted(source.orders), payments = sorted(source.payments), ledger = sorted(source.ledger);
  for (const [kind, docs] of [['client', [source.client]], ['order', orders], ['payment', payments], ['ledger', ledger], ['balance', source.balance ? [source.balance] : []]] as const) {
    const ids = new Set<string>();
    for (const d of docs) {
      if (!validId(d.id) || ids.has(d.id) || (d.data.id !== undefined && d.data.id !== d.id)) add('document-identity', [d.id], `${kind} document identity is missing, duplicated, or mismatched`);
      ids.add(d.id);
      if ((kind === 'client' || kind === 'balance') ? d.id !== source.clientId : d.data.clientId !== source.clientId) add('customer-ownership', [d.id], `${kind} does not belong to the reviewed customer`);
      if (kind === 'balance' && d.data.clientId !== source.clientId) add('customer-ownership', [d.id], 'Balance clientId does not match');
    }
  }
  const activeOrders = orders.filter(o => !o.data.deletedAt);
  const orderIds = new Set(activeOrders.map(o => o.id));
  const orderMap = new Map(activeOrders.map(o => [o.id, o]));
  const activePayments = payments.filter(p => !p.data.deletedAt);
  const paymentMap = new Map(activePayments.map(p => [p.id, p]));
  const paymentEntries = new Map<string, ReviewDocument[]>();
  const keys = new Set<string>();
  for (const e of ledger) {
    if (!['invoice', 'payment', 'opening_balance'].includes(String(e.data.type))) add('unknown-ledger-type', [e.id], 'Unknown ledger type');
    if (!division(e.data.division)) add('missing-division', [e.id], 'Ledger division is missing or invalid');
    if (paise(e.data.amount) === null) add('invalid-amount', [e.id], 'Ledger amount is missing or invalid');
    if (e.data.type === 'invoice' && (!validId(e.data.invoiceId) || !orderIds.has(e.data.invoiceId))) add('unresolved-invoice', [e.id], 'Invoice identity is missing or does not resolve to an active customer order');
    if (validId(e.data.invoiceId)) {
      const order = orderMap.get(e.data.invoiceId);
      if (order && division(order.data.division) && division(e.data.division) && order.data.division !== e.data.division) add('invoice-division-mismatch', [e.id, order.id], 'Ledger division conflicts with the linked order');
    }
    if (e.data.type !== 'payment') continue;
    if (!validId(e.data.paymentId)) { add('missing-payment-id', [e.id], 'Ledger payment has no stable payment identifier'); continue; }
    const list = paymentEntries.get(e.data.paymentId) ?? []; list.push(e); paymentEntries.set(e.data.paymentId, list);
    if (!paymentMap.has(e.data.paymentId)) add('orphan-payment-ledger', [e.id], 'No active payment document matches this ledger entry');
    if (!validId(e.data.invoiceId) || !orderIds.has(e.data.invoiceId)) add('unresolved-payment-invoice', [e.id], 'Allocation invoice identity is missing or unresolved, including possible legacy advance');
    const key = JSON.stringify([e.data.paymentId, e.data.invoiceId ?? null, e.data.division ?? null]);
    if (keys.has(key)) add('duplicate-allocation', [e.id], 'Repeated payment, invoice and division allocation');
    keys.add(key);
  }
  for (const p of activePayments) {
    if (!division(p.data.division)) add('missing-division', [p.id], 'Payment division is missing or invalid');
    const amount = paise(p.data.amount), entries = paymentEntries.get(p.id) ?? [];
    const values = entries.map(e => paise(e.data.amount));
    if (amount === null || entries.length === 0 || values.some(v => v === null)) add('unresolved-payment-allocation', [p.id], 'Payment or ledger allocation is missing or invalid');
    else if (values.reduce<bigint>((sum, v) => sum + BigInt(v!), 0n) !== BigInt(amount)) add('payment-ledger-mismatch', [p.id, ...entries.map(e => e.id)], 'Payment does not equal recorded ledger allocations');
    const other = paise(p.data.appliedToOtherBill);
    if (other !== null && other > 0) {
      const counterparts = entries.filter(e => e.data.invoiceId === p.data.otherInvoiceId);
      if (!validId(p.data.otherInvoiceId) || counterparts.length === 0) add('missing-cross-division-counterpart', [p.id], 'Cross-division counterpart allocation is missing');
      else if (counterparts.some(e => paise(e.data.amount) === null || !division(e.data.division) || e.data.division === p.data.division) || counterparts.reduce<bigint>((sum, e) => sum + BigInt(paise(e.data.amount) ?? 0), 0n) !== BigInt(other)) add('cross-division-mismatch', [p.id, ...counterparts.map(e => e.id)], 'Counterpart amount or division requires review');
    }
  }
  for (const o of activeOrders) {
    if (paise(o.data.creditApplied) === null || paise(o.data.primaryCreditApplied) === null || paise(o.data.bakeryCreditApplied) === null) add('missing-order-credit', [o.id], 'Persisted credit fields require review');
    else if (BigInt(paise(o.data.creditApplied)!) !== BigInt(paise(o.data.primaryCreditApplied)!) + BigInt(paise(o.data.bakeryCreditApplied)!)) add('order-credit-mismatch', [o.id], 'Order credit does not equal division allocations');
  }
  const opening = ledger.filter(e => e.data.type === 'opening_balance');
  const recordedOpening = paise(source.client.data.openingBalanceAmount);
  if (recordedOpening !== null && (opening.some(e => paise(e.data.amount) === null) || opening.reduce<bigint>((sum, e) => sum + BigInt(paise(e.data.amount) ?? 0), 0n) !== BigInt(recordedOpening))) add('opening-balance-discrepancy', [source.clientId, ...opening.map(e => e.id)], 'Client opening aggregate and ledger entries disagree or are incomplete');
  if (!source.balance || source.balance.data.state !== 'verified' || !validId(source.balance.data.reviewedBy) || !source.balance.data.reviewedAt || !source.balance.data.reviewBasis || !Number.isSafeInteger(source.balance.data.revision) || Number(source.balance.data.revision) < 0 || paise(source.balance.data.availableCredit) === null) add('unverified-credit-evidence', [source.clientId], 'Verified balance and review evidence are incomplete');
  const snapshot = { clientId: source.clientId, client: source.client, orders, payments, ledger, balance: source.balance };
  const sourceFingerprint = `sha256:${createHash('sha256').update(JSON.stringify(canonical(snapshot))).digest('hex')}`;
  const legacyAggregates = Object.fromEntries(['generalCredit', 'availableCredit', 'rawBalance', 'credit', 'primaryTotals', 'bakeryTotals', 'openingBalance', 'openingBalanceAmount'].filter(k => source.client.data[k] !== undefined).map(k => [k, source.client.data[k]]));
  return { clientId: source.clientId, persistedFacts: { activeOrderCredits: activeOrders.map(o => ({ id: o.id, creditApplied: o.data.creditApplied ?? null, primaryCreditApplied: o.data.primaryCreditApplied ?? null, bakeryCreditApplied: o.data.bakeryCreditApplied ?? null })), ledger, balance: source.balance }, legacyAggregates, blockingFindings: findings, limitations: ['Queries cannot discover documents with missing or incorrect clientId.', 'This snapshot does not authorize approval or prove a future transaction is current.', 'Opening balances and legacy allocation semantics require manual review.'], proposedSpendableCredit: null, sourceFingerprint };
}

/** Unregistered server service. Reads a transactional snapshot; never writes. */
export async function readTrustedCustomerCreditReview(db: admin.firestore.Firestore, authUid: string | undefined, clientId: string): Promise<TrustedCreditReport> {
  const caller = await validateAndFetchActiveUser(db, authUid);
  if (caller.role !== 'admin') throw new HttpsError('permission-denied', 'Admin access required');
  if (!validId(clientId) || clientId.includes('/')) throw new HttpsError('invalid-argument', 'Invalid customer ID');
  return db.runTransaction(async transaction => {
    const client = await transaction.get(db.collection('clients').doc(clientId));
    if (!client.exists) throw new HttpsError('not-found', 'Customer not found');
    const balance = await transaction.get(db.collection('clientCreditBalances').doc(clientId));
    const orders = await transaction.get(db.collection('orders').where('clientId', '==', clientId));
    const payments = await transaction.get(db.collection('payments').where('clientId', '==', clientId));
    const ledger = await transaction.get(db.collection('ledger').where('clientId', '==', clientId));
    const convert = (d: admin.firestore.QueryDocumentSnapshot): ReviewDocument => ({ id: d.id, data: d.data() });
    return buildTrustedCreditReport({ clientId, client: { id: client.id, data: client.data()! }, balance: balance.exists ? { id: balance.id, data: balance.data()! } : null, orders: orders.docs.map(convert), payments: payments.docs.map(convert), ledger: ledger.docs.map(convert) });
  }, { readOnly: true });
}
