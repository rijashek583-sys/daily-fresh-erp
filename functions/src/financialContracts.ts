/** Preliminary Phase 1 contracts only: no callable, persistence, or authorization is wired.
 * Order pricing/division, delivery and direct-sale details, payment metadata and
 * invoice/ledger mapping remain to be specified against existing workflows.
 * Corrections, refunds, opening balances and restore behavior require policy review.
 */
export const FINANCIAL_SCHEMA_VERSION = 1 as const;
export type Paise = number;
export type FinancialRevision = number;
export type FinancialDivision = 'primary' | 'bakery';
export type FinancialErrorCode =
  | 'UNSUPPORTED_SCHEMA_VERSION' | 'INVALID_REQUEST_ID' | 'INVALID_AMOUNT'
  | 'INVALID_REVISION' | 'INVALID_INPUT' | 'DUPLICATE_REQUEST_ID'
  | 'STALE_REVISION' | 'ALLOCATION_REVIEW_REQUIRED' | 'UNAUTHORIZED';

export class FinancialContractError extends Error {
  constructor(public readonly code: FinancialErrorCode, message: string) {
    super(message);
    this.name = 'FinancialContractError';
  }
}

/** Request IDs are durable idempotency keys, scoped to an operation and actor. */
export interface FinancialRequest { schemaVersion: typeof FINANCIAL_SCHEMA_VERSION; requestId: string }
export interface FinancialResponse { schemaVersion: typeof FINANCIAL_SCHEMA_VERSION; requestId: string; financialRevision: FinancialRevision }
export interface OrderItemInput { productId: string; quantity: number; unitPricePaise: Paise }
export interface CreateCustomerOrderRequest extends FinancialRequest { clientId: string; deliveryDate: string; items: OrderItemInput[] }
export interface CreateCustomerOrderResponse extends FinancialResponse { orderId: string; creditAppliedPaise: Paise; primaryCreditAppliedPaise: Paise; bakeryCreditAppliedPaise: Paise; netDuePaise: Paise }
export interface EditCustomerOrderRequest extends FinancialRequest { orderId: string; expectedFinancialRevision: FinancialRevision; items: OrderItemInput[] }
export interface EditCustomerOrderResponse extends FinancialResponse { orderId: string; netDuePaise: Paise }
export interface RecordCustomerPaymentRequest extends FinancialRequest { clientId: string; deliveryDate: string; amountPaise: Paise; method: 'cash' | 'upi' | 'bank_transfer' | 'card' }
export interface DivisionAllocation { primaryPaise: Paise; bakeryPaise: Paise }
export interface DeliveryDateAllocation extends DivisionAllocation { deliveryDate: string; invoiceId?: string }
/** Nothing in an unresolved result authorizes persistence or classifies an advance. */
export interface UnresolvedPaymentAllocation {
  status: 'unresolved';
  reason: 'MISSING_PREVIOUS_INVOICE_ID' | 'PREVIOUS_INVOICE_ORDER_AMBIGUOUS';
  unappliedPaise: Paise;
}
export interface RecordCustomerPaymentResponse extends FinancialResponse { paymentId: string; allocations: DeliveryDateAllocation[]; unifiedExcessPaise: Paise }
export interface CorrectCustomerPaymentRequest extends FinancialRequest { paymentId: string; expectedFinancialRevision: FinancialRevision; newAmountPaise: Paise; reason: string }
export interface CorrectCustomerPaymentResponse extends FinancialResponse { paymentId: string; correctionAuditId: string }
export interface SetOpeningBalanceRequest extends FinancialRequest { clientId: string; division: FinancialDivision; amountPaise: Paise; asOfDate: string; expectedFinancialRevision: FinancialRevision; reason: string }
export interface SetOpeningBalanceResponse extends FinancialResponse { auditId: string }
export interface TrashFinancialRecordRequest extends FinancialRequest { recordType: 'order' | 'payment'; recordId: string; expectedFinancialRevision: FinancialRevision; reason: string }
export interface TrashFinancialRecordResponse extends FinancialResponse { trashId: string }
export interface RestoreFinancialRecordRequest extends FinancialRequest { trashId: string; expectedFinancialRevision: FinancialRevision }
export interface RestoreFinancialRecordResponse extends FinancialResponse { restoredRecordId: string }
export interface PrepareCreditReviewRequest extends FinancialRequest { clientId: string }
export interface PrepareCreditReviewResponse extends FinancialResponse { reviewId: string; sourceFingerprint: string; balanceRevision: FinancialRevision | null; findings: string[] }
export interface ApproveCreditReviewRequest extends FinancialRequest { clientId: string; reviewId: string; expectedFinancialRevision: FinancialRevision; expectedBalanceRevision: FinancialRevision | null; reviewedAmountPaise: Paise; reviewBasis: string; sourceFingerprint: string }
export interface ApproveCreditReviewResponse extends FinancialResponse { balanceRevision: FinancialRevision; auditId: string }

export function validatePaise(value: unknown, field = 'amount'): asserts value is Paise {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new FinancialContractError('INVALID_AMOUNT', `${field} must be a non-negative safe integer in paise`);
  }
}

/** Quantity is a finite positive JSON number; money must still be validated in paise. */
export function validateOrderQuantity(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new FinancialContractError('INVALID_INPUT', 'Quantity must be a finite positive number within the safe range');
  }
}

export function validateFinancialRevision(value: unknown): asserts value is FinancialRevision {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new FinancialContractError('INVALID_REVISION', 'Revision must be a non-negative safe integer');
  }
}

export function validateFinancialRequest(value: unknown): asserts value is FinancialRequest {
  if (!value || typeof value !== 'object') throw new FinancialContractError('INVALID_INPUT', 'Request must be an object');
  const request = value as Record<string, unknown>;
  if (request.schemaVersion !== FINANCIAL_SCHEMA_VERSION) throw new FinancialContractError('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported financial schema version');
  if (typeof request.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(request.requestId)) {
    throw new FinancialContractError('INVALID_REQUEST_ID', 'Request ID must contain 1–128 letters, digits, underscores, or hyphens');
  }
}

/** Canonical JSON for operation-validated payloads; validate monetary fields with validatePaise and quantities with validateOrderQuantity first. Array order is meaningful. */
export function canonicalFinancialPayload(value: unknown): string {
  const ancestors = new Set<object>();
  const normalize = (item: unknown): unknown => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= Number.MAX_SAFE_INTEGER) return item;
    if (!item || typeof item !== 'object') throw new FinancialContractError('INVALID_INPUT', 'Payload must contain only JSON values and finite numbers within the safe range');
    if (ancestors.has(item)) throw new FinancialContractError('INVALID_INPUT', 'Cyclic payload');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new FinancialContractError('INVALID_INPUT', 'Payload must contain plain objects');
    }
    ancestors.add(item);
    let result: unknown;
    if (Array.isArray(item)) {
      for (let i = 0; i < item.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(item, i)) throw new FinancialContractError('INVALID_INPUT', 'Sparse arrays are not valid financial payloads');
      }
      result = item.map(normalize);
    } else {
      const record = item as Record<string, unknown>;
      result = Object.fromEntries(Object.keys(record).sort().map(key => [key, normalize(record[key])]));
    }
    ancestors.delete(item);
    return result;
  };
  return JSON.stringify(normalize(value));
}

/** Compare against a durably stored actor/operation/request key within a future transaction. */
export function compareIdempotentRequest(existingCanonicalPayload: string | null, payload: unknown): 'new' | 'replay' {
  const canonical = canonicalFinancialPayload(payload);
  if (existingCanonicalPayload === null) return 'new';
  if (existingCanonicalPayload === canonical) return 'replay';
  throw new FinancialContractError('DUPLICATE_REQUEST_ID', 'Request ID already belongs to a different payload');
}

/** Pool cap only, NOT reservation authorization: a trusted transaction must also
 * check verified balance and authoritative division dues/caps, Primary-first
 * application, revision and atomic persistence. Legacy aggregates are not credit.
 */
export function validateUnifiedCreditPoolCap(availablePaise: unknown, primaryPaise: unknown, bakeryPaise: unknown): void {
  validatePaise(availablePaise, 'available credit');
  validatePaise(primaryPaise, 'primary reservation');
  validatePaise(bakeryPaise, 'bakery reservation');
  if (BigInt(primaryPaise) + BigInt(bakeryPaise) > BigInt(availablePaise)) {
    throw new FinancialContractError('INVALID_AMOUNT', 'Reservation exceeds the single verified credit pool');
  }
}
