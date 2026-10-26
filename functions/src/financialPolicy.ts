import { FinancialContractError, validateFinancialRevision, validatePaise, type FinancialDivision, type Paise } from './financialContracts';
export type { FinancialDivision, Paise } from './financialContracts';

/** Pure policy contracts. Evidence must be read and checked by a future trusted transaction.
 * Required sources include product/customer pricing and approved override records,
 * active invoice obligations, ledger allocations, verified credit and stock records.
 * Legacy missing timestamps, opening balances without invoice identity, uncertain
 * prior allocations, backdated payments and reversal mapping require review. These
 * helpers cannot establish evidence completeness or authorization by themselves.
 */
export const FINANCIAL_POLICY_VERSION = 1 as const;
export interface InvoiceObligation {
  invoiceId: string; division: FinancialDivision; deliveryDate: string;
  /** Persisted reliable UTC creation timestamp, not the delivery date. */
  orderedAt: string; eligibleUnpaidPaise: Paise;
}
export interface PaymentPolicyInput {
  policyVersion: typeof FINANCIAL_POLICY_VERSION; clientId: string; selectedDeliveryDate: string;
  paymentPaise: Paise; obligations: readonly InvoiceObligation[];
  /** False or unknown requires review; callers must establish this from trusted records. */
  openingBalancesResolved: boolean;
}
export interface InvoiceAttribution { invoiceId: string; division: FinancialDivision; deliveryDate: string; amountPaise: Paise }
export type PaymentPolicyResult =
  | { status: 'allocated'; attributions: InvoiceAttribution[]; unifiedAdvancePaise: Paise }
  | { status: 'review-required'; reason: 'OPENING_BALANCE_UNRESOLVED' | 'ORDERING_EVIDENCE_MISSING' };
/** Design requirement only: order, obligations, credit and stock commit together or none commit. */
export interface AtomicOrderPolicy { policyVersion: typeof FINANCIAL_POLICY_VERSION; orderId: string; requestId: string; expectedRevision: number; obligationIds: readonly string[]; stockDeductionIds: readonly string[]; creditReservationPaise: Paise }
/** Corrections/refunds require trusted Admin authorization and immutable audited reversal entries. */
export interface AuditedAdjustmentPolicy { policyVersion: typeof FINANCIAL_POLICY_VERSION; kind: 'correction' | 'refund'; originalPaymentId: string; reason: string; adminUid: string; reversalId: string }
export interface TrustedPriceEvidence { productId: string; productPricePaise: Paise; customerPricePaise?: Paise; override?: { pricePaise: Paise; approvalId: string; approvedBy: string } }

const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.trim() === value;
const validDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const validTime = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;

/** Structural checks only; authorization and transactional completeness remain server duties. */
export function validateAtomicOrderPolicy(value: AtomicOrderPolicy): void {
  if (!value || value.policyVersion !== FINANCIAL_POLICY_VERSION) throw new FinancialContractError('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported policy version');
  if (!id(value.orderId) || !id(value.requestId) || !Array.isArray(value.obligationIds) || !Array.isArray(value.stockDeductionIds) || !value.obligationIds.length || !value.stockDeductionIds.length || [...value.obligationIds, ...value.stockDeductionIds].some(x => !id(x)) || new Set(value.obligationIds).size !== value.obligationIds.length || new Set(value.stockDeductionIds).size !== value.stockDeductionIds.length) throw new FinancialContractError('INVALID_INPUT', 'Missing or duplicate atomic order evidence');
  validateFinancialRevision(value.expectedRevision); validatePaise(value.creditReservationPaise);
}
/** Caller must separately verify Admin role and immutable audit persistence. */
export function validateAuditedAdjustmentPolicy(value: AuditedAdjustmentPolicy): void {
  if (!value || value.policyVersion !== FINANCIAL_POLICY_VERSION) throw new FinancialContractError('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported policy version');
  if (!['correction', 'refund'].includes(value.kind) || !id(value.originalPaymentId) || !id(value.reason) || !id(value.adminUid) || !id(value.reversalId)) throw new FinancialContractError('INVALID_INPUT', 'Incomplete adjustment evidence');
}

/** Authoritative, net-of-credit-and-prior-payment obligations only; no legacy inference. */
export function allocatePaymentPolicy(input: PaymentPolicyInput): PaymentPolicyResult {
  if (!input || input.policyVersion !== FINANCIAL_POLICY_VERSION) throw new FinancialContractError('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported policy version');
  if (!id(input.clientId) || !validDate(input.selectedDeliveryDate) || !Array.isArray(input.obligations)) throw new FinancialContractError('INVALID_INPUT', 'Invalid customer, date or obligations');
  validatePaise(input.paymentPaise, 'payment');
  if (input.openingBalancesResolved !== true) return { status: 'review-required', reason: 'OPENING_BALANCE_UNRESOLVED' };
  const keys = new Set<string>();
  const invoiceDates = new Map<string, string>();
  const dates = new Map<string, InvoiceObligation[]>();
  for (const o of input.obligations) {
    if (!o || !id(o.invoiceId) || !validDate(o.deliveryDate) || o.deliveryDate > input.selectedDeliveryDate || !['primary', 'bakery'].includes(o.division)) throw new FinancialContractError('INVALID_INPUT', 'Invalid obligation');
    validatePaise(o.eligibleUnpaidPaise, 'unpaid');
    const key = JSON.stringify([o.invoiceId, o.division]);
    if (keys.has(key)) throw new FinancialContractError('INVALID_INPUT', 'Duplicate invoice division obligation');
    const existingDate = invoiceDates.get(o.invoiceId);
    if (existingDate !== undefined && existingDate !== o.deliveryDate) throw new FinancialContractError('INVALID_INPUT', 'Invoice has conflicting delivery dates');
    invoiceDates.set(o.invoiceId, o.deliveryDate);
    keys.add(key);
    if (!validTime(o.orderedAt)) return { status: 'review-required', reason: 'ORDERING_EVIDENCE_MISSING' };
    const group = dates.get(o.deliveryDate) ?? []; group.push(o); dates.set(o.deliveryDate, group);
  }
  const orderedDates = [input.selectedDeliveryDate, ...[...dates.keys()].filter(d => d !== input.selectedDeliveryDate).sort(compare)];
  let remaining = BigInt(input.paymentPaise);
  const attributions: InvoiceAttribution[] = [];
  for (const date of orderedDates) {
    const group = dates.get(date) ?? [];
    const primary = group.filter(o => o.division === 'primary').reduce((n, o) => n + BigInt(o.eligibleUnpaidPaise), 0n);
    const bakery = group.filter(o => o.division === 'bakery').reduce((n, o) => n + BigInt(o.eligibleUnpaidPaise), 0n);
    const total = primary + bakery;
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new FinancialContractError('INVALID_AMOUNT', 'Group exceeds safe range');
    if (!total || !remaining) continue;
    const applied = remaining < total ? remaining : total;
    let p = applied * primary / total, b = applied * bakery / total;
    if (p + b < applied) { if (applied * primary % total >= applied * bakery % total) p++; else b++; }
    for (const [div, amount] of [['primary', p], ['bakery', b]] as const) {
      let left = amount;
      for (const o of group.filter(x => x.division === div).sort((a, b2) => compare(a.orderedAt, b2.orderedAt) || compare(a.invoiceId, b2.invoiceId))) {
        const allocated = left < BigInt(o.eligibleUnpaidPaise) ? left : BigInt(o.eligibleUnpaidPaise);
        if (allocated > 0n) attributions.push({ invoiceId: o.invoiceId, division: div, deliveryDate: date, amountPaise: Number(allocated) });
        left -= allocated;
      }
      if (left !== 0n) throw new FinancialContractError('INVALID_INPUT', 'Attribution does not conserve allocation');
    }
    remaining -= applied;
  }
  return { status: 'allocated', attributions, unifiedAdvancePaise: Number(remaining) };
}

/** Verified pool and authoritative division dues only; not a transaction authorization. */
export function allocatePrimaryFirstCredit(availablePaise: Paise, primaryDuePaise: Paise, bakeryDuePaise: Paise): { primaryPaise: Paise; bakeryPaise: Paise } {
  validatePaise(availablePaise); validatePaise(primaryDuePaise); validatePaise(bakeryDuePaise);
  const primaryPaise = Math.min(availablePaise, primaryDuePaise);
  return { primaryPaise, bakeryPaise: Math.min(availablePaise - primaryPaise, bakeryDuePaise) };
}

/** This selects supplied trusted evidence; future server must verify source, revision and approval. */
export function selectTrustedPrice(evidence: TrustedPriceEvidence): Paise {
  if (!evidence || !id(evidence.productId)) throw new FinancialContractError('INVALID_INPUT', 'Product identity required');
  validatePaise(evidence.productPricePaise);
  if (evidence.customerPricePaise !== undefined) validatePaise(evidence.customerPricePaise);
  if (evidence.override) {
    if (!id(evidence.override.approvalId) || !id(evidence.override.approvedBy)) throw new FinancialContractError('ALLOCATION_REVIEW_REQUIRED', 'Override approval evidence required');
    validatePaise(evidence.override.pricePaise); return evidence.override.pricePaise;
  }
  return evidence.customerPricePaise ?? evidence.productPricePaise;
}
