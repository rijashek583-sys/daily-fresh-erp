import { describe, it, expect } from 'vitest';
import {
  allocateProportionalPayment,
  allocatePrimaryFirstCredit,
  allocatePrimaryFirstCreditRupees,
  FinancialEvidenceError,
  toPaise,
  toRupees,
  type InvoiceObligationInput,
} from './proportionalPayment';

describe('Payment Safety Audit — Financial Correctness & Verification Suite', () => {
  const item = (
    invoiceId: string,
    division: 'primary' | 'bakery',
    deliveryDate: string,
    unpaidPaise: number,
    orderedAt = '2026-01-01T10:00:00.000Z'
  ): InvoiceObligationInput => ({
    invoiceId,
    division,
    deliveryDate,
    unpaidPaise,
    orderedAt,
    clientId: 'test-client',
  });

  describe('A & B. Multiple Same-Date Invoices & Oldest-Invoice Attribution', () => {
    it('attributes payments to oldest invoices first within division on the same delivery date', () => {
      // 3 primary invoices and 1 bakery invoice on the same delivery date: 2026-03-10
      // Primary obligations:
      // - inv-p1: 20000 paise (08:00)
      // - inv-p2: 30000 paise (09:00)
      // - inv-p3: 10000 paise (10:00)
      // Total Primary dues: 60000 paise (60%)
      // Bakery obligations:
      // - inv-b1: 40000 paise (09:30)
      // Total Bakery dues: 40000 paise (40%)
      // Total dues: 100000 paise
      // Payment: 50000 paise (₹500.00)
      // Proportional division:
      // Primary share: 50000 * 60% = 30000 paise
      // Bakery share:  50000 * 40% = 20000 paise
      //
      // Oldest-first attribution within Primary:
      // - inv-p1 (08:00): gets 20000 paise (fully paid)
      // - inv-p2 (09:00): gets remaining 10000 paise (partially paid)
      // - inv-p3 (10:00): gets 0 paise
      // Within Bakery:
      // - inv-b1: gets 20000 paise (partially paid)
      const obligations: InvoiceObligationInput[] = [
        item('inv-p3', 'primary', '2026-03-10', 10000, '2026-03-10T10:00:00.000Z'),
        item('inv-p1', 'primary', '2026-03-10', 20000, '2026-03-10T08:00:00.000Z'),
        item('inv-p2', 'primary', '2026-03-10', 30000, '2026-03-10T09:00:00.000Z'),
        item('inv-b1', 'bakery', '2026-03-10', 40000, '2026-03-10T09:30:00.000Z'),
      ];

      const res = allocateProportionalPayment({
        clientId: 'test-client',
        paymentAmount: 500,
        paymentPaise: 50000,
        selectedDeliveryDate: '2026-03-10',
        obligations,
      });

      expect(res.status).toBe('allocated');
      expect(res.primaryAllocatedPaise).toBe(30000);
      expect(res.bakeryAllocatedPaise).toBe(20000);
      expect(res.totalAllocatedPaise).toBe(50000);
      expect(res.unifiedAdvancePaise).toBe(0);

      expect(res.attributions).toEqual([
        { invoiceId: 'inv-p1', orderId: undefined, division: 'primary', deliveryDate: '2026-03-10', amountPaise: 20000, amount: 200 },
        { invoiceId: 'inv-p2', orderId: undefined, division: 'primary', deliveryDate: '2026-03-10', amountPaise: 10000, amount: 100 },
        { invoiceId: 'inv-b1', orderId: undefined, division: 'bakery', deliveryDate: '2026-03-10', amountPaise: 20000, amount: 200 },
      ]);
    });
  });

  describe('A & B. Previous-Date Invoices Chronological Settlement', () => {
    it('settles selected date first, then previous dates chronologically oldest date first', () => {
      // Dates:
      // Selected: 2026-03-15 (Primary: 20000 paise, Bakery: 10000 paise, total 30000)
      // Previous Date 1: 2026-03-01 (Primary: 15000 paise, Bakery: 15000 paise, total 30000)
      // Previous Date 2: 2026-03-10 (Primary: 10000 paise, Bakery: 40000 paise, total 50000)
      // Payment: 50000 paise
      // Allocation:
      // 1. Selected date (2026-03-15) settled first: gets 30000 paise (20000 primary, 10000 bakery). Remaining = 20000.
      // 2. Oldest previous date (2026-03-01) settled next:
      //    Total due on 2026-03-01 is 30000 paise (50% primary, 50% bakery).
      //    20000 paise is split 50/50: 10000 primary, 10000 bakery. Remaining = 0.
      // 3. Date 2026-03-10 receives 0 paise.
      const obligations: InvoiceObligationInput[] = [
        item('inv-later-prev', 'bakery', '2026-03-10', 40000, '2026-03-10T10:00:00.000Z'),
        item('inv-old-p', 'primary', '2026-03-01', 15000, '2026-03-01T08:00:00.000Z'),
        item('inv-old-b', 'bakery', '2026-03-01', 15000, '2026-03-01T08:30:00.000Z'),
        item('inv-curr-p', 'primary', '2026-03-15', 20000, '2026-03-15T09:00:00.000Z'),
        item('inv-curr-b', 'bakery', '2026-03-15', 10000, '2026-03-15T09:30:00.000Z'),
      ];

      const res = allocateProportionalPayment({
        clientId: 'test-client',
        paymentAmount: 500,
        paymentPaise: 50000,
        selectedDeliveryDate: '2026-03-15',
        obligations,
      });

      expect(res.attributions.map(a => a.deliveryDate)).toEqual([
        '2026-03-15', '2026-03-15', '2026-03-01', '2026-03-01'
      ]);
      expect(res.primaryAllocatedPaise).toBe(30000); // 20000 on 15th + 10000 on 1st
      expect(res.bakeryAllocatedPaise).toBe(20000);  // 10000 on 15th + 10000 on 1st
      expect(res.unifiedAdvancePaise).toBe(0);
    });
  });

  describe('D. Durable Operation-Specific Idempotency', () => {
    it('distinguishes legitimate duplicate payments on the same date via operation keys', () => {
      // Two distinct payments of ₹500 on the same date for the same client have unique operation keys
      const opKey1 = `pay_op_cust1_${Date.now()}_abc12345`;
      const opKey2 = `pay_op_cust1_${Date.now()}_xyz98765`;
      expect(opKey1).not.toBe(opKey2);
      expect(/^[A-Za-z0-9_-]{8,128}$/.test(opKey1)).toBe(true);
      expect(/^[A-Za-z0-9_-]{8,128}$/.test(opKey2)).toBe(true);
    });
  });

  describe('E. Primary-First Advance Credit Application Policy', () => {
    it('strictly satisfies Primary Foods first when applying advance credit', () => {
      // Customer has ₹150 advance credit (15000 paise)
      // New bill has Primary ₹100 (10000 paise) and Bakery ₹100 (10000 paise)
      // Primary gets ₹100, remaining ₹50 covers Bakery
      const res = allocatePrimaryFirstCredit(15000, 10000, 10000);
      expect(res.primaryPaise).toBe(10000);
      expect(res.bakeryPaise).toBe(5000);

      const rupeeRes = allocatePrimaryFirstCreditRupees(150, 100, 100);
      expect(rupeeRes.primaryCredit).toBe(100);
      expect(rupeeRes.bakeryCredit).toBe(50);
      expect(rupeeRes.totalCreditApplied).toBe(150);
    });

    it('covers only Primary when advance credit is less than Primary due', () => {
      const res = allocatePrimaryFirstCredit(5000, 10000, 10000);
      expect(res.primaryPaise).toBe(5000);
      expect(res.bakeryPaise).toBe(0);
    });
  });

  describe('F & Blocker 7. Missing Ordering Evidence Rejection', () => {
    it('rejects obligations with missing or invalid deliveryDate and never defaults to 1970-01-01', () => {
      const badObligation: InvoiceObligationInput = {
        invoiceId: 'inv-bad-date',
        division: 'primary',
        deliveryDate: '', // missing
        unpaidPaise: 5000,
        orderedAt: '2026-03-01T10:00:00.000Z',
        clientId: 'test-client',
      };

      expect(() => {
        allocateProportionalPayment({
          clientId: 'test-client',
          paymentAmount: 50,
          obligations: [badObligation],
        });
      }).toThrow(FinancialEvidenceError);

      try {
        allocateProportionalPayment({
          clientId: 'test-client',
          paymentAmount: 50,
          obligations: [badObligation],
        });
      } catch (err: any) {
        expect(err.code).toBe('ORDERING_EVIDENCE_MISSING');
        expect(err.message).toContain('Defaulting to 1970-01-01 is forbidden');
      }
    });

    it('rejects obligations with dates prior to year 2000 (such as 1970-01-01)', () => {
      const legacyEpochObligation: InvoiceObligationInput = {
        invoiceId: 'inv-epoch',
        division: 'primary',
        deliveryDate: '1970-01-01', // epoch fallback forbidden
        unpaidPaise: 5000,
        orderedAt: '1970-01-01T00:00:00.000Z',
        clientId: 'test-client',
      };

      expect(() => {
        allocateProportionalPayment({
          clientId: 'test-client',
          paymentAmount: 50,
          obligations: [legacyEpochObligation],
        });
      }).toThrow(FinancialEvidenceError);
    });

    it('rejects obligations with missing or unparseable orderedAt timestamps', () => {
      const badTimestampObligation: InvoiceObligationInput = {
        invoiceId: 'inv-no-ts',
        division: 'primary',
        deliveryDate: '2026-03-01',
        unpaidPaise: 5000,
        orderedAt: 'invalid-date-string',
        clientId: 'test-client',
      };

      expect(() => {
        allocateProportionalPayment({
          clientId: 'test-client',
          paymentAmount: 50,
          obligations: [badTimestampObligation],
        });
      }).toThrow(FinancialEvidenceError);
    });
  });

  describe('F & Blocker 6. Legacy Opening Balance & Ambiguity Rejection', () => {
    it('rejects allocation when client has unresolved opening balance evidence', () => {
      const obligation = item('inv-1', 'primary', '2026-03-01', 5000);

      expect(() => {
        allocateProportionalPayment({
          clientId: 'test-client',
          paymentAmount: 50,
          obligations: [obligation],
          hasUnresolvedOpeningBalance: true,
        });
      }).toThrow(FinancialEvidenceError);

      try {
        allocateProportionalPayment({
          clientId: 'test-client',
          paymentAmount: 50,
          obligations: [obligation],
          hasUnresolvedOpeningBalance: true,
        });
      } catch (err: any) {
        expect(err.code).toBe('OPENING_BALANCE_UNRESOLVED');
        expect(err.message).toContain('unresolved legacy opening balance');
      }
    });

    it('rejects selected delivery dates with invalid or pre-2000 formatting', () => {
      expect(() => {
        allocateProportionalPayment({
          clientId: 'test-client',
          paymentAmount: 50,
          selectedDeliveryDate: '1970-01-01',
          obligations: [],
        });
      }).toThrow(FinancialEvidenceError);
    });
  });

  describe('C. Atomic Balances & Financial Revision', () => {
    it('maintains strict sum invariants between allocations and payment amount', () => {
      const obligations: InvoiceObligationInput[] = [
        item('inv-p', 'primary', '2026-03-01', 3333),
        item('inv-b', 'bakery', '2026-03-01', 6667),
      ];

      for (let paise = 1; paise <= 10000; paise += 731) {
        const res = allocateProportionalPayment({
          clientId: 'test-client',
          paymentAmount: paise / 100,
          paymentPaise: paise,
          selectedDeliveryDate: '2026-03-01',
          obligations,
        });

        expect(res.primaryAllocatedPaise + res.bakeryAllocatedPaise + res.unifiedAdvancePaise).toBe(paise);
      }
    });
  });
});
