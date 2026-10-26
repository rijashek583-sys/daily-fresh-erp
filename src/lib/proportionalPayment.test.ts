import { describe, it, expect } from 'vitest';
import {
  allocateProportionalPayment,
  allocatePrimaryFirstCredit,
  allocatePrimaryFirstCreditRupees,
  toPaise,
  toRupees,
  type InvoiceObligationInput,
} from './proportionalPayment';

describe('Proportional Payment Policy & Primary-First Credit Engine', () => {
  const item = (
    invoiceId: string,
    division: 'primary' | 'bakery',
    deliveryDate: string,
    unpaidPaise: number,
    orderedAt = '2026-01-01T00:00:00.000Z'
  ): InvoiceObligationInput => ({
    invoiceId,
    division,
    deliveryDate,
    unpaidPaise,
    orderedAt,
    clientId: 'test-client',
  });

  describe('1. Dynamic Primary / Bakery Proportional Division', () => {
    it('splits payment proportionally according to division dues on a single delivery date', () => {
      // Primary dues: 30000 + 30000 = 60000 paise (60%)
      // Bakery dues: 40000 paise (40%)
      // Total dues: 100000 paise
      // Payment: 80000 paise
      // Primary gets 60% = 48000 paise
      // Bakery gets 40% = 32000 paise
      const obligations: InvoiceObligationInput[] = [
        item('inv-b', 'primary', '2026-01-03', 30000, '2026-01-03T10:00:00.000Z'),
        item('inv-a', 'primary', '2026-01-03', 30000, '2026-01-03T09:00:00.000Z'),
        item('inv-c', 'bakery', '2026-01-03', 40000, '2026-01-03T09:30:00.000Z'),
      ];

      const res = allocateProportionalPayment({
        clientId: 'test-client',
        paymentAmount: 800,
        paymentPaise: 80000,
        selectedDeliveryDate: '2026-01-03',
        obligations,
      });

      expect(res.status).toBe('allocated');
      expect(res.primaryAllocatedPaise).toBe(48000);
      expect(res.bakeryAllocatedPaise).toBe(32000);
      expect(res.totalAllocatedPaise).toBe(80000);
      expect(res.unifiedAdvancePaise).toBe(0);

      // Oldest invoice within division attributed first
      // 'inv-a' was ordered at 09:00 (older than 'inv-b' at 10:00)
      expect(res.attributions).toEqual([
        { invoiceId: 'inv-a', orderId: undefined, division: 'primary', deliveryDate: '2026-01-03', amountPaise: 30000, amount: 300 },
        { invoiceId: 'inv-b', orderId: undefined, division: 'primary', deliveryDate: '2026-01-03', amountPaise: 18000, amount: 180 },
        { invoiceId: 'inv-c', orderId: undefined, division: 'bakery', deliveryDate: '2026-01-03', amountPaise: 32000, amount: 320 },
      ]);
    });

    it('attributes by invoiceId alphabetical tiebreaker when orderedAt timestamps are identical', () => {
      const obligations: InvoiceObligationInput[] = [
        item('b', 'primary', '2026-01-03', 30000, '2026-01-01T00:00:00.000Z'),
        item('a', 'primary', '2026-01-03', 30000, '2026-01-01T00:00:00.000Z'),
        item('c', 'bakery', '2026-01-03', 40000, '2026-01-01T00:00:00.000Z'),
      ];

      const res = allocateProportionalPayment({
        clientId: 'test-client',
        paymentAmount: 800,
        paymentPaise: 80000,
        selectedDeliveryDate: '2026-01-03',
        obligations,
      });

      expect(res.attributions).toEqual([
        { invoiceId: 'a', orderId: undefined, division: 'primary', deliveryDate: '2026-01-03', amountPaise: 30000, amount: 300 },
        { invoiceId: 'b', orderId: undefined, division: 'primary', deliveryDate: '2026-01-03', amountPaise: 18000, amount: 180 },
        { invoiceId: 'c', orderId: undefined, division: 'bakery', deliveryDate: '2026-01-03', amountPaise: 32000, amount: 320 },
      ]);
    });

    it('breaks 1-paise tiebreaker in favor of Primary Foods', () => {
      // 1 paise payment against 1 paise primary and 1 paise bakery
      const obligations: InvoiceObligationInput[] = [
        item('p', 'primary', '2026-01-03', 1),
        item('b', 'bakery', '2026-01-03', 1),
      ];

      const res = allocateProportionalPayment({
        clientId: 'test-client',
        paymentAmount: 0.01,
        paymentPaise: 1,
        selectedDeliveryDate: '2026-01-03',
        obligations,
      });

      expect(res.primaryAllocatedPaise).toBe(1);
      expect(res.bakeryAllocatedPaise).toBe(0);
      expect(res.attributions).toEqual([
        { invoiceId: 'p', orderId: undefined, division: 'primary', deliveryDate: '2026-01-03', amountPaise: 1, amount: 0.01 },
      ]);
    });
  });

  describe('2. Delivery Date Grouping & Ordering', () => {
    it('settles selected date first, then previous dates chronologically oldest-first', () => {
      // Dates:
      // Selected: 2026-01-03 (current: 50 paise)
      // Older 1:  2026-01-01 (old1: primary 60, old2: bakery 40, total: 100)
      // Older 2:  2026-01-02 (later: bakery 10)
      // Total dues: 50 + 100 + 10 = 160 paise
      // Payment: 175 paise
      // 2026-01-03 gets 50
      // 2026-01-01 gets 100 (60 primary, 40 bakery)
      // 2026-01-02 gets 10
      // Excess credit = 175 - 160 = 15 paise
      const obligations: InvoiceObligationInput[] = [
        item('later', 'bakery', '2026-01-02', 10),
        item('old2', 'bakery', '2026-01-01', 40),
        item('old1', 'primary', '2026-01-01', 60),
        item('current', 'primary', '2026-01-03', 50),
      ];

      const res = allocateProportionalPayment({
        clientId: 'test-client',
        paymentAmount: 1.75,
        paymentPaise: 175,
        selectedDeliveryDate: '2026-01-03',
        obligations,
      });

      expect(res.attributions.map(x => x.invoiceId)).toEqual(['current', 'old1', 'old2', 'later']);
      expect(res.totalAllocatedPaise).toBe(160);
      expect(res.unifiedAdvancePaise).toBe(15);
      expect(res.excessCredit).toBe(0.15);
      expect(res.isAdvance).toBe(false);
    });

    it('allocates partially paid older date proportionally before later dates receive payment', () => {
      // Selected date 2026-01-03: 50 paise
      // Older date 2026-01-01: primary 60, bakery 40 (total 100)
      // Older date 2026-01-02: bakery 20
      // Payment: 130 paise
      // 1. 2026-01-03 gets 50 paise. Remaining = 80 paise.
      // 2. 2026-01-01 has 100 paise due. 80 paise is split proportionally:
      //    primary = 80 * 60 / 100 = 48 paise
      //    bakery  = 80 * 40 / 100 = 32 paise
      // 3. 2026-01-02 gets 0 paise.
      const obligations: InvoiceObligationInput[] = [
        item('current', 'primary', '2026-01-03', 50),
        item('old-p', 'primary', '2026-01-01', 60),
        item('old-b', 'bakery', '2026-01-01', 40),
        item('later', 'bakery', '2026-01-02', 20),
      ];

      const res = allocateProportionalPayment({
        clientId: 'test-client',
        paymentAmount: 1.30,
        paymentPaise: 130,
        selectedDeliveryDate: '2026-01-03',
        obligations,
      });

      expect(res.attributions).toEqual([
        { invoiceId: 'current', orderId: undefined, division: 'primary', deliveryDate: '2026-01-03', amountPaise: 50, amount: 0.50 },
        { invoiceId: 'old-p', orderId: undefined, division: 'primary', deliveryDate: '2026-01-01', amountPaise: 48, amount: 0.48 },
        { invoiceId: 'old-b', orderId: undefined, division: 'bakery', deliveryDate: '2026-01-01', amountPaise: 32, amount: 0.32 },
      ]);
      expect(res.unifiedAdvancePaise).toBe(0);
    });

    it('settles all dates chronologically oldest-first when selectedDeliveryDate is not provided', () => {
      const obligations: InvoiceObligationInput[] = [
        item('d2', 'bakery', '2026-01-02', 100),
        item('d1', 'primary', '2026-01-01', 100),
      ];

      const res = allocateProportionalPayment({
        clientId: 'test-client',
        paymentAmount: 1.50,
        paymentPaise: 150,
        obligations,
      });

      expect(res.attributions.map(x => x.invoiceId)).toEqual(['d1', 'd2']);
      expect(res.attributions[0].amountPaise).toBe(100);
      expect(res.attributions[1].amountPaise).toBe(50);
      expect(res.unifiedAdvancePaise).toBe(0);
    });
  });

  describe('3. Customer Advance Credit & Direct Sales', () => {
    it('marks payment as pure advance when no obligations exist and client is not direct sale', () => {
      const res = allocateProportionalPayment({
        clientId: 'test-client',
        paymentAmount: 500,
        obligations: [],
      });

      expect(res.status).toBe('allocated');
      expect(res.totalAllocatedPaise).toBe(0);
      expect(res.unifiedAdvancePaise).toBe(50000);
      expect(res.excessCredit).toBe(500);
      expect(res.isAdvance).toBe(true);
      expect(res.attributions).toHaveLength(0);
    });

    it('never creates advance credit for direct cash sales', () => {
      const res = allocateProportionalPayment({
        clientId: 'direct',
        paymentAmount: 500,
        isDirectSale: true,
        obligations: [item('dir-1', 'primary', '2026-01-03', 30000)],
      });

      expect(res.totalAllocatedPaise).toBe(30000);
      expect(res.unifiedAdvancePaise).toBe(0);
      expect(res.excessCredit).toBe(0);
      expect(res.isAdvance).toBe(false);
    });
  });

  describe('4. Separate Rule: Primary-First Advance Credit Application', () => {
    it('consumes advance credit in canonical Primary-first order', () => {
      // 10000 paise available credit. Primary due: 10000, Bakery due: 10000
      // Primary receives 10000, Bakery receives 0
      const res1 = allocatePrimaryFirstCredit(10000, 10000, 10000);
      expect(res1).toEqual({ primaryPaise: 10000, bakeryPaise: 0 });

      // 10000 paise available credit. Primary due: 3000, Bakery due: 10000
      // Primary receives 3000, Bakery receives remaining 7000
      const res2 = allocatePrimaryFirstCredit(10000, 3000, 10000);
      expect(res2).toEqual({ primaryPaise: 3000, bakeryPaise: 7000 });

      // Credit exceeds total dues
      const res3 = allocatePrimaryFirstCredit(20000, 5000, 5000);
      expect(res3).toEqual({ primaryPaise: 5000, bakeryPaise: 5000 });
    });

    it('handles rupee-denominated credit application correctly', () => {
      const res = allocatePrimaryFirstCreditRupees(100, 30, 90);
      expect(res.primaryCredit).toBe(30);
      expect(res.bakeryCredit).toBe(70);
      expect(res.totalCreditApplied).toBe(100);
    });
  });

  describe('5. Monetary Helpers Precision', () => {
    it('converts between paise and rupees with zero floating point drift', () => {
      expect(toPaise(0.01)).toBe(1);
      expect(toPaise(10.55)).toBe(1055);
      expect(toRupees(1055)).toBe(10.55);
      expect(toRupees(1)).toBe(0.01);
      expect(toPaise(-5)).toBe(0);
    });
  });
});
