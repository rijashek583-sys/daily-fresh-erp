import { FINANCIAL_SCHEMA_VERSION, FinancialContractError, validatePaise, type DeliveryDateAllocation, type Paise, type UnresolvedPaymentAllocation } from './financialContracts';

/** Supplied totals must already be authoritative, unambiguous, and net of persisted credit and payments. */
export interface UnpaidDeliveryGroup { clientId: string; deliveryDate: string; invoiceId?: string; primaryUnpaidPaise: Paise; bakeryUnpaidPaise: Paise }
export interface ProportionalPaymentInput { schemaVersion: typeof FINANCIAL_SCHEMA_VERSION; clientId: string; selectedDeliveryDate: string; paymentPaise: Paise; groups: readonly UnpaidDeliveryGroup[] }
export type ProportionalPaymentResult = { status: 'allocated'; allocations: DeliveryDateAllocation[]; unifiedExcessPaise: Paise } | UnresolvedPaymentAllocation;

function validDate(date: unknown): date is string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/**
 * Pure payment calculation, not credit reservation. Selected-date rows are
 * grouped; previous invoices remain separate. Creation dates and the 2 AM IST
 * day do not determine membership. Primary wins equal fractional remainders.
 * This result does not assign money to individual orders or ledger entries.
 * Legacy ambiguity, opening balances without invoice identity, same-date invoice
 * mapping, backdated payments, corrections/refunds and atomic persistence must
 * be resolved before a future trusted writer can commit the result.
 */
export function allocateProportionalPayment(input: ProportionalPaymentInput): ProportionalPaymentResult {
  if (!input || input.schemaVersion !== FINANCIAL_SCHEMA_VERSION) throw new FinancialContractError('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported allocation schema');
  if (typeof input.clientId !== 'string' || !input.clientId.trim() || !validDate(input.selectedDeliveryDate) || !Array.isArray(input.groups)) {
    throw new FinancialContractError('INVALID_INPUT', 'Client, selected delivery date and groups are required');
  }
  validatePaise(input.paymentPaise, 'payment');
  const current = { primary: 0n, bakery: 0n };
  const previous: { deliveryDate: string; invoiceId?: string; primary: bigint; bakery: bigint }[] = [];
  const invoiceIds = new Set<string>();
  for (const group of input.groups) {
    if (!group || group.clientId !== input.clientId || !validDate(group.deliveryDate) || group.deliveryDate > input.selectedDeliveryDate) {
      throw new FinancialContractError('INVALID_INPUT', 'Each group must belong to the client and have a valid selected or previous delivery date');
    }
    validatePaise(group.primaryUnpaidPaise, 'primary unpaid');
    validatePaise(group.bakeryUnpaidPaise, 'bakery unpaid');
    const primary = BigInt(group.primaryUnpaidPaise);
    const bakery = BigInt(group.bakeryUnpaidPaise);
    if (primary + bakery > BigInt(Number.MAX_SAFE_INTEGER)) throw new FinancialContractError('INVALID_AMOUNT', 'Unpaid total exceeds safe integer range');
    if (group.deliveryDate === input.selectedDeliveryDate) {
      current.primary += primary;
      current.bakery += bakery;
      if (current.primary + current.bakery > BigInt(Number.MAX_SAFE_INTEGER)) throw new FinancialContractError('INVALID_AMOUNT', 'Grouped unpaid total exceeds safe integer range');
    } else {
      if (group.invoiceId !== undefined && (typeof group.invoiceId !== 'string' || !group.invoiceId.trim() || invoiceIds.has(group.invoiceId))) throw new FinancialContractError('INVALID_INPUT', 'Previous invoice IDs must be non-empty and unique');
      if (group.invoiceId !== undefined) invoiceIds.add(group.invoiceId);
      previous.push({ deliveryDate: group.deliveryDate, invoiceId: group.invoiceId, primary, bakery });
    }
  }
  previous.sort((a, b) => a.deliveryDate < b.deliveryDate ? -1 : a.deliveryDate > b.deliveryDate ? 1 : 0);
  const ordered = [{ deliveryDate: input.selectedDeliveryDate, ...current, invoiceId: undefined }, ...previous];
  let remaining = BigInt(input.paymentPaise);
  const allocations: DeliveryDateAllocation[] = [];
  for (const group of ordered) {
    if (remaining === 0n) break;
    const total = group.primary + group.bakery;
    if (total === 0n) continue;
    if (group.deliveryDate !== input.selectedDeliveryDate) {
      if (!group.invoiceId) return { status: 'unresolved', reason: 'MISSING_PREVIOUS_INVOICE_ID', unappliedPaise: input.paymentPaise };
      if (previous.some(other => other !== group && other.deliveryDate === group.deliveryDate && other.primary + other.bakery > 0n)) return { status: 'unresolved', reason: 'PREVIOUS_INVOICE_ORDER_AMBIGUOUS', unappliedPaise: input.paymentPaise };
    }
    const applied = remaining < total ? remaining : total;
    let primary = applied * group.primary / total;
    let bakery = applied * group.bakery / total;
    const remainder = applied - primary - bakery;
    if (remainder > 0n) {
      const primaryFraction = applied * group.primary % total;
      const bakeryFraction = applied * group.bakery % total;
      if (primaryFraction >= bakeryFraction) primary += remainder;
      else bakery += remainder;
    }
    allocations.push({ deliveryDate: group.deliveryDate, ...(group.invoiceId ? { invoiceId: group.invoiceId } : {}), primaryPaise: Number(primary), bakeryPaise: Number(bakery) });
    remaining -= applied;
  }
  return { status: 'allocated', allocations, unifiedExcessPaise: Number(remaining) };
}
