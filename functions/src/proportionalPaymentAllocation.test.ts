import { describe, expect, it } from 'vitest';
import { allocateProportionalPayment, type UnpaidDeliveryGroup } from './proportionalPaymentAllocation';
import { canonicalFinancialPayload, compareIdempotentRequest, FinancialContractError, validateUnifiedCreditPoolCap, validateOrderQuantity, validateFinancialRequest, validateFinancialRevision, validatePaise } from './financialContracts';

const group = (deliveryDate: string, primaryUnpaidPaise: number, bakeryUnpaidPaise: number): UnpaidDeliveryGroup => ({ clientId: 'customer', deliveryDate, ...(deliveryDate === '2026-10-25' ? {} : { invoiceId: `invoice-${deliveryDate}` }), primaryUnpaidPaise, bakeryUnpaidPaise });
const rawAllocate = (paymentPaise: number, groups: UnpaidDeliveryGroup[]) => allocateProportionalPayment({ schemaVersion: 1, clientId: 'customer', selectedDeliveryDate: '2026-10-25', paymentPaise, groups });
const allocate = (paymentPaise: number, groups: UnpaidDeliveryGroup[]) => { const result = rawAllocate(paymentPaise, groups); if (result.status !== 'allocated') throw new Error(result.reason); return result; };

describe('proportional payment allocation', () => {
  it('allocates ₹800 dynamically against ₹600 Primary and ₹400 Bakery', () => {
    expect(allocate(80000, [group('2026-10-25', 60000, 40000)])).toEqual({ status: 'allocated', allocations: [{ deliveryDate: '2026-10-25', primaryPaise: 48000, bakeryPaise: 32000 }], unifiedExcessPaise: 0 });
  });
  it('groups multiple same-date orders and uses the remaining unpaid ratio', () => {
    expect(allocate(20000, [group('2026-10-25', 10000, 10000), group('2026-10-25', 20000, 0)]).allocations).toEqual([{ deliveryDate: '2026-10-25', primaryPaise: 15000, bakeryPaise: 5000 }]);
  });
  it('settles selected delivery date first, then previous dates oldest first', () => {
    const result = allocate(170, [group('2026-10-24', 40, 60), group('2026-10-25', 30, 20), group('2026-10-20', 30, 70)]);
    expect(result).toEqual({ status: 'allocated', allocations: [{ deliveryDate: '2026-10-25', primaryPaise: 30, bakeryPaise: 20 }, { deliveryDate: '2026-10-20', invoiceId: 'invoice-2026-10-20', primaryPaise: 30, bakeryPaise: 70 }, { deliveryDate: '2026-10-24', invoiceId: 'invoice-2026-10-24', primaryPaise: 8, bakeryPaise: 12 }], unifiedExcessPaise: 0 });
  });
  it('handles zero dues and classifies only one unified excess', () => {
    expect(allocate(105, [group('2026-10-25', 0, 40), group('2026-10-24', 10, 0)])).toEqual({ status: 'allocated', allocations: [{ deliveryDate: '2026-10-25', primaryPaise: 0, bakeryPaise: 40 }, { deliveryDate: '2026-10-24', invoiceId: 'invoice-2026-10-24', primaryPaise: 10, bakeryPaise: 0 }], unifiedExcessPaise: 55 });
    expect(allocate(10, [group('2026-10-25', 0, 0)])).toEqual({ status: 'allocated', allocations: [], unifiedExcessPaise: 10 });
  });
  it('uses largest remainder with Primary winning ties and conserves every paise', () => {
    expect(allocate(1, [group('2026-10-25', 1, 1)]).allocations[0]).toMatchObject({ primaryPaise: 1, bakeryPaise: 0 });
    expect(allocate(1, [group('2026-10-25', 1, 2)]).allocations[0]).toMatchObject({ primaryPaise: 0, bakeryPaise: 1 });
    for (let p = 0; p < 8; p++) for (let b = 0; b < 8; b++) for (let paid = 0; paid < 18; paid++) {
      const result = allocate(paid, [group('2026-10-25', p, b)]);
      const allocation = result.allocations[0];
      const primary = allocation?.primaryPaise ?? 0;
      const bakery = allocation?.bakeryPaise ?? 0;
      expect(primary + bakery + result.unifiedExcessPaise).toBe(paid);
      expect(primary).toBeLessThanOrEqual(p);
      expect(bakery).toBeLessThanOrEqual(b);
    }
  });
  it('leaves the entire payment unapplied when previous invoice order or identity is unresolved', () => {
    const first = group('2026-10-20', 60, 0);
    const second = { ...group('2026-10-20', 0, 40), invoiceId: 'second' };
    expect(rawAllocate(120, [group('2026-10-25', 10, 0), first, second])).toEqual({ status: 'unresolved', reason: 'PREVIOUS_INVOICE_ORDER_AMBIGUOUS', unappliedPaise: 120 });
    expect(rawAllocate(10, [group('2026-10-25', 10, 0), first, second])).toMatchObject({ status: 'allocated', unifiedExcessPaise: 0 });
    expect(rawAllocate(11, [group('2026-10-25', 10, 0), { ...first, invoiceId: undefined }])).toEqual({ status: 'unresolved', reason: 'MISSING_PREVIOUS_INVOICE_ID', unappliedPaise: 11 });
    expect(() => rawAllocate(100, [first, { ...second, invoiceId: first.invoiceId }])).toThrow(FinancialContractError);
  });
  it('handles safe integer multiplication without overflow and rejects unsafe totals', () => {
    const max = Number.MAX_SAFE_INTEGER;
    const result = allocate(max, [group('2026-10-25', max - 1, 1)]);
    expect(result.allocations[0]).toMatchObject({ primaryPaise: max - 1, bakeryPaise: 1 });
    expect(() => allocate(1, [group('2026-10-25', max, 1)])).toThrow(FinancialContractError);
    expect(() => allocate(max + 1, [])).toThrow(FinancialContractError);
  });
  it('rejects malformed amounts, dates, versions, clients, and future dates', () => {
    for (const invalid of [-1, 1.5, NaN, Infinity, '100', null]) expect(() => validatePaise(invalid)).toThrow(FinancialContractError);
    expect(() => allocate(1, [group('2026-02-30', 1, 1)])).toThrow(FinancialContractError);
    expect(() => allocate(1, [group('2026-10-26', 1, 1)])).toThrow(FinancialContractError);
    expect(() => allocate(1, [{ ...group('2026-10-25', 1, 1), clientId: 'other' }])).toThrow(FinancialContractError);
    expect(() => allocateProportionalPayment({ schemaVersion: 2, clientId: 'customer', selectedDeliveryDate: '2026-10-25', paymentPaise: 1, groups: [] } as never)).toThrow(FinancialContractError);
  });
});

describe('financial request and reservation contracts', () => {
  it('validates schema, request IDs, and revisions', () => {
    expect(() => validateFinancialRequest({ schemaVersion: 1, requestId: 'request_1' })).not.toThrow();
    expect(() => validateFinancialRequest({ schemaVersion: 2, requestId: 'request_1' })).toThrow(FinancialContractError);
    expect(() => validateFinancialRequest({ schemaVersion: 1, requestId: '../bad' })).toThrow(FinancialContractError);
    expect(() => validateFinancialRevision(-1)).toThrow(FinancialContractError);
    expect(() => validateFinancialRevision(Number.MAX_SAFE_INTEGER + 1)).toThrow(FinancialContractError);
  });
  it('compares canonical payloads and detects conflicting duplicate request IDs', () => {
    const payload = { schemaVersion: 1, requestId: 'x', amountPaise: 100, nested: { b: 2, a: 1 } };
    const canonical = canonicalFinancialPayload(payload);
    expect(compareIdempotentRequest(null, payload)).toBe('new');
    expect(compareIdempotentRequest(canonical, { nested: { a: 1, b: 2 }, amountPaise: 100, requestId: 'x', schemaVersion: 1 })).toBe('replay');
    expect(() => compareIdempotentRequest(canonical, { ...payload, amountPaise: 101 })).toThrowError(expect.objectContaining({ code: 'DUPLICATE_REQUEST_ID' }));
    expect(() => canonicalFinancialPayload({ amount: undefined })).toThrow(FinancialContractError);
  });
  it('validates fractional quantities independently of paise and rejects sparse arrays', () => {
    for (const quantity of [0.5, 1.25, 2]) expect(() => validateOrderQuantity(quantity)).not.toThrow();
    for (const quantity of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1.5']) expect(() => validateOrderQuantity(quantity)).toThrow(FinancialContractError);
    expect(canonicalFinancialPayload({ quantity: 1.25 })).toBe('{"quantity":1.25}');
    expect(() => validatePaise(1.25)).toThrow(FinancialContractError);
    const sparse = new Array(1);
    expect(() => canonicalFinancialPayload(sparse)).toThrow(FinancialContractError);
    expect(() => compareIdempotentRequest(canonicalFinancialPayload([null]), sparse)).toThrow(FinancialContractError);
    expect(() => canonicalFinancialPayload({ items: [, 1] })).toThrow(FinancialContractError);
  });
  it('checks only the unified pool cap, not full reservation authorization', () => {
    expect(() => validateUnifiedCreditPoolCap(10000, 7000, 3000)).not.toThrow();
    expect(() => validateUnifiedCreditPoolCap(10000, 7000, 3001)).toThrow(FinancialContractError);
  });
});
