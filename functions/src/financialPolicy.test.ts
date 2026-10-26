import { describe, expect, it } from 'vitest';
import { allocatePaymentPolicy, allocatePrimaryFirstCredit, selectTrustedPrice, validateAtomicOrderPolicy, validateAuditedAdjustmentPolicy, type InvoiceObligation } from './financialPolicy';

const item = (invoiceId: string, division: 'primary' | 'bakery', deliveryDate: string, eligibleUnpaidPaise: number, orderedAt = '2026-01-01T00:00:00.000Z'): InvoiceObligation => ({ invoiceId, division, deliveryDate, eligibleUnpaidPaise, orderedAt });
const input = (obligations: InvoiceObligation[], paymentPaise: number) => ({ policyVersion: 1 as const, clientId: 'c', selectedDeliveryDate: '2026-01-03', paymentPaise, obligations, openingBalancesResolved: true });

describe('versioned payment and credit policies', () => {
  it('splits by dynamic dues and attributes within division by reliable oldest then ID', () => {
    const result = allocatePaymentPolicy(input([item('b', 'primary', '2026-01-03', 30000), item('a', 'primary', '2026-01-03', 30000), item('c', 'bakery', '2026-01-03', 40000)], 80000));
    expect(result).toEqual({ status: 'allocated', attributions: [
      { invoiceId: 'a', division: 'primary', deliveryDate: '2026-01-03', amountPaise: 30000 },
      { invoiceId: 'b', division: 'primary', deliveryDate: '2026-01-03', amountPaise: 18000 },
      { invoiceId: 'c', division: 'bakery', deliveryDate: '2026-01-03', amountPaise: 32000 },
    ], unifiedAdvancePaise: 0 });
  });
  it('settles selected date then older dates, grouping multiple previous invoices', () => {
    const result = allocatePaymentPolicy(input([item('later', 'bakery', '2026-01-02', 10), item('old2', 'bakery', '2026-01-01', 40), item('old1', 'primary', '2026-01-01', 60), item('current', 'primary', '2026-01-03', 50)], 175));
    expect(result).toMatchObject({ status: 'allocated', unifiedAdvancePaise: 15 });
    if (result.status !== 'allocated') throw new Error('unexpected');
    expect(result.attributions.map(x => x.invoiceId)).toEqual(['current', 'old1', 'old2', 'later']);
    expect(result.attributions.reduce((s, x) => s + x.amountPaise, result.unifiedAdvancePaise)).toBe(175);
  });
  it('allocates a partially paid older date proportionally before later debts', () => {
    const result = allocatePaymentPolicy(input([item('current', 'primary', '2026-01-03', 50), item('old-p', 'primary', '2026-01-01', 60), item('old-b', 'bakery', '2026-01-01', 40), item('later', 'bakery', '2026-01-02', 20)], 130));
    expect(result).toEqual({ status: 'allocated', attributions: [
      { invoiceId: 'current', division: 'primary', deliveryDate: '2026-01-03', amountPaise: 50 },
      { invoiceId: 'old-p', division: 'primary', deliveryDate: '2026-01-01', amountPaise: 48 },
      { invoiceId: 'old-b', division: 'bakery', deliveryDate: '2026-01-01', amountPaise: 32 },
    ], unifiedAdvancePaise: 0 });
  });
  it('rejects conflicting delivery dates for one invoice across divisions', () => {
    expect(() => allocatePaymentPolicy(input([item('same', 'primary', '2026-01-01', 10), item('same', 'bakery', '2026-01-02', 10)], 10))).toThrow('conflicting delivery dates');
  });
  it('rounds one paise deterministically and respects credit pool and division caps', () => {
    expect(allocatePaymentPolicy(input([item('p', 'primary', '2026-01-03', 1), item('b', 'bakery', '2026-01-03', 1)], 1))).toMatchObject({ attributions: [{ invoiceId: 'p', amountPaise: 1 }] });
    expect(allocatePrimaryFirstCredit(10000, 10000, 10000)).toEqual({ primaryPaise: 10000, bakeryPaise: 0 });
    expect(allocatePrimaryFirstCredit(10000, 3000, 10000)).toEqual({ primaryPaise: 3000, bakeryPaise: 7000 });
  });
  it('fails closed for opening ambiguity, missing ordering, duplicates and malformed values', () => {
    const o = item('x', 'primary', '2026-01-02', 10);
    expect(allocatePaymentPolicy({ ...input([o], 10), openingBalancesResolved: false })).toEqual({ status: 'review-required', reason: 'OPENING_BALANCE_UNRESOLVED' });
    expect(allocatePaymentPolicy(input([{ ...o, orderedAt: '' }], 10))).toEqual({ status: 'review-required', reason: 'ORDERING_EVIDENCE_MISSING' });
    expect(() => allocatePaymentPolicy(input([o, o], 10))).toThrow();
    expect(() => allocatePaymentPolicy(input([o], -1))).toThrow();
    expect(() => allocatePaymentPolicy(input([{ ...o, deliveryDate: '2026-02-30' }], 10))).toThrow();
  });
  it('requires price approval evidence and keeps customer and product prices in paise', () => {
    expect(selectTrustedPrice({ productId: 'x', productPricePaise: 100, customerPricePaise: 75 })).toBe(75);
    expect(selectTrustedPrice({ productId: 'x', productPricePaise: 100, override: { pricePaise: 50, approvalId: 'approval', approvedBy: 'admin' } })).toBe(50);
    expect(() => selectTrustedPrice({ productId: 'x', productPricePaise: 100, override: { pricePaise: 50, approvalId: '', approvedBy: 'admin' } })).toThrow();
    expect(() => selectTrustedPrice({ productId: 'x', productPricePaise: 0.5 })).toThrow();
  });
  it('validates atomic order and audited adjustment evidence without authorizing writes', () => {
    const order = { policyVersion: 1 as const, orderId: 'o', requestId: 'r', expectedRevision: 1, obligationIds: ['i'], stockDeductionIds: ['s'], creditReservationPaise: 0 };
    expect(() => validateAtomicOrderPolicy(order)).not.toThrow();
    expect(() => validateAtomicOrderPolicy({ ...order, stockDeductionIds: ['s', 's'] })).toThrow();
    expect(() => validateAuditedAdjustmentPolicy({ policyVersion: 1, kind: 'refund', originalPaymentId: 'p', reason: 'refund', adminUid: '', reversalId: 'r' })).toThrow();
  });
});
