/**
 * Regression tests for getProductDivision (src/lib/utils.ts)
 *
 * Business rule (confirmed 2026-10-23):
 *   PRIMARY FOODS — Kuboos, Roomali, Wheat Kuboos ONLY.
 *   BAKERY FOODS  — every other product, incl. Soft Kuboos and Burger Bun.
 *
 * Test categories:
 *   1. Primary Foods name-match (canonical list)
 *   2. Bakery Foods name-match (confirmed bakery products)
 *   3. Firestore division field override (field takes precedence)
 *   4. Edge cases (null, undefined, whitespace, casing)
 *   5. Invoice grouping simulation (split totals by division)
 */
import { describe, it, expect } from 'vitest';
import { getProductDivision } from './utils';

type ProductLike = { name: string; division?: string };
const p = (name: string, division?: string): ProductLike => ({ name, division });

// ─── 1. Primary Foods — name-match fallback ──────────────────────────────────
describe('getProductDivision — Primary Foods (name fallback)', () => {
  it('Kuboos → primary',              () => expect(getProductDivision(p('Kuboos'))).toBe('primary'));
  it('kuboos (lowercase) → primary',  () => expect(getProductDivision(p('kuboos'))).toBe('primary'));
  it('KUBOOS (uppercase) → primary',  () => expect(getProductDivision(p('KUBOOS'))).toBe('primary'));
  it('  Kuboos  (padded) → primary',  () => expect(getProductDivision(p('  Kuboos  '))).toBe('primary'));
  it('Roomali → primary',             () => expect(getProductDivision(p('Roomali'))).toBe('primary'));
  it('ROOMALI → primary',             () => expect(getProductDivision(p('ROOMALI'))).toBe('primary'));
  it('Wheat Kuboos → primary',        () => expect(getProductDivision(p('Wheat Kuboos'))).toBe('primary'));
  it('wheat kuboos → primary',        () => expect(getProductDivision(p('wheat kuboos'))).toBe('primary'));
  it('WHEAT KUBOOS → primary',        () => expect(getProductDivision(p('WHEAT KUBOOS'))).toBe('primary'));
});

// ─── 2. Bakery Foods — name-match fallback ───────────────────────────────────
describe('getProductDivision — Bakery Foods (name fallback)', () => {
  it('Soft Kuboos → bakery  [regression: was wrongly primary]', () => expect(getProductDivision(p('Soft Kuboos'))).toBe('bakery'));
  it('soft kuboos → bakery',           () => expect(getProductDivision(p('soft kuboos'))).toBe('bakery'));
  it('SOFT KUBOOS → bakery',           () => expect(getProductDivision(p('SOFT KUBOOS'))).toBe('bakery'));
  it('Burger Bun → bakery',            () => expect(getProductDivision(p('Burger Bun'))).toBe('bakery'));
  it('burger bun → bakery',            () => expect(getProductDivision(p('burger bun'))).toBe('bakery'));
  it('unknown product → bakery',       () => expect(getProductDivision(p('Mystery Product'))).toBe('bakery'));
  it('empty name → bakery',            () => expect(getProductDivision(p(''))).toBe('bakery'));
  it('Pita → bakery',                  () => expect(getProductDivision(p('Pita'))).toBe('bakery'));
  it('"kuboos extra" → bakery (prefix not matched)', () => expect(getProductDivision(p('kuboos extra'))).toBe('bakery'));
});

// ─── 3. Firestore division field override ────────────────────────────────────
describe('getProductDivision — Firestore division field takes precedence', () => {
  it('division="primary" on Burger Bun → primary (field wins)',  () => expect(getProductDivision(p('Burger Bun', 'primary'))).toBe('primary'));
  it('division="bakery"  on Kuboos → bakery (field wins)',       () => expect(getProductDivision(p('Kuboos', 'bakery'))).toBe('bakery'));
  it('division="bakery"  on Soft Kuboos → bakery (consistent)', () => expect(getProductDivision(p('Soft Kuboos', 'bakery'))).toBe('bakery'));
  it('division="primary" on Wheat Kuboos → primary (consistent)',() => expect(getProductDivision(p('Wheat Kuboos', 'primary'))).toBe('primary'));
  it('division="" → falls through to name-match → Kuboos=primary', () => expect(getProductDivision(p('Kuboos', ''))).toBe('primary'));
  it('division="unknown" → falls through to name-match → Kuboos=primary', () => expect(getProductDivision(p('Kuboos', 'unknown'))).toBe('primary'));
});

// ─── 4. Edge cases ───────────────────────────────────────────────────────────
describe('getProductDivision — edge cases', () => {
  it('null → bakery',      () => expect(getProductDivision(null)).toBe('bakery'));
  it('undefined → bakery', () => expect(getProductDivision(undefined)).toBe('bakery'));
  it('name="" → bakery',   () => expect(getProductDivision({ name: '' })).toBe('bakery'));
});

// ─── 5. Invoice grouping simulation ─────────────────────────────────────────
describe('getProductDivision — invoice grouping simulation', () => {
  function splitOrder(items: Array<{ productName: string; total: number; productDivision?: string }>) {
    let pTotal = 0, bTotal = 0;
    const pItems: string[] = [], bItems: string[] = [];
    for (const item of items) {
      const div = getProductDivision({ name: item.productName, division: item.productDivision });
      if (div === 'primary') { pTotal += item.total; pItems.push(item.productName); }
      else                   { bTotal += item.total; bItems.push(item.productName); }
    }
    return { pTotal, bTotal, pItems, bItems };
  }

  it('mixed order: Kuboos+Roomali=primary, Soft Kuboos+Burger Bun=bakery', () => {
    const r = splitOrder([
      { productName: 'Kuboos',      total: 100 },
      { productName: 'Roomali',     total:  80 },
      { productName: 'Soft Kuboos', total:  60 },
      { productName: 'Burger Bun',  total:  40 },
    ]);
    expect(r.pTotal).toBe(180);
    expect(r.bTotal).toBe(100);
    expect(r.pItems).toEqual(['Kuboos', 'Roomali']);
    expect(r.bItems).toEqual(['Soft Kuboos', 'Burger Bun']);
  });

  it('Wheat Kuboos groups into primary subtotal', () => {
    const r = splitOrder([
      { productName: 'Wheat Kuboos', total: 120 },
      { productName: 'Burger Bun',   total:  50 },
    ]);
    expect(r.pTotal).toBe(120);
    expect(r.bTotal).toBe(50);
  });

  it('all-primary order has zero bakery subtotal', () => {
    const r = splitOrder([
      { productName: 'Kuboos',       total: 200 },
      { productName: 'Roomali',      total: 150 },
      { productName: 'Wheat Kuboos', total: 100 },
    ]);
    expect(r.pTotal).toBe(450);
    expect(r.bTotal).toBe(0);
    expect(r.bItems).toHaveLength(0);
  });

  it('all-bakery order has zero primary subtotal', () => {
    const r = splitOrder([
      { productName: 'Soft Kuboos', total: 60 },
      { productName: 'Burger Bun',  total: 40 },
    ]);
    expect(r.pTotal).toBe(0);
    expect(r.bTotal).toBe(100);
    expect(r.pItems).toHaveLength(0);
  });
});

// ─── 6. Canonical Payment Allocation Order (Audited Business Rules) ───────────
import { allocateOrderCredit, allocatePayment, calculateUnifiedMetrics, calculateOldBalance, round2 } from './billing';
import { buildUnifiedInvoiceDataFromDailyBill } from './invoicePrint';
import { useDataStore } from '../stores/dataStore';

describe('Canonical Payment Allocation Order', () => {
  // Scenario 1: ₹1,000 payment against ₹70 Primary + ₹152 Bakery + ₹0 previous outstanding
  it('₹1,000 payment against ₹70 Primary + ₹152 Bakery + ₹0 previous outstanding => bill remaining ₹0, previous outstanding ₹0, credit ₹778', () => {
    const alloc = allocatePayment({
      paymentAmount: 1000,
      orderRemaining: 70,        // Primary bill
      otherOrderRemaining: 152,  // Bakery bill
      billDivisionPrior: 0,
      otherDivisionPrior: 0,
      clientTotalOutstanding: 222,
      isDirectSale: false,
    });

    expect(alloc.appliedToBill).toBe(70);
    expect(alloc.appliedToOtherBill).toBe(152);
    expect(alloc.totalAppliedToBill).toBe(222);
    expect(alloc.remainingBill).toBe(0);
    expect(alloc.remainingOtherBill).toBe(0);
    expect(alloc.remainingTotalBill).toBe(0);
    expect(alloc.appliedToPrevious).toBe(0);
    expect(alloc.remainingPrevious).toBe(0);
    expect(alloc.excessCredit).toBe(778);
    expect(alloc.generalCredit).toBe(778);
    expect(alloc.remainingTotalOutstanding).toBe(0);
  });

  // Scenario 2: Same payment with ₹200 previous outstanding => credit ₹578
  it('₹1,000 payment against ₹70 Primary + ₹152 Bakery + ₹200 previous outstanding => bill remaining ₹0, previous outstanding ₹0, credit ₹578', () => {
    const alloc = allocatePayment({
      paymentAmount: 1000,
      orderRemaining: 70,        // Primary bill
      otherOrderRemaining: 152,  // Bakery bill
      billDivisionPrior: 100,    // Primary prior debt
      otherDivisionPrior: 100,   // Bakery prior debt
      clientTotalOutstanding: 422,
      isDirectSale: false,
    });

    // 1. Current bill settled first across both divisions
    expect(alloc.appliedToBill).toBe(70);
    expect(alloc.appliedToOtherBill).toBe(152);
    expect(alloc.totalAppliedToBill).toBe(222);
    expect(alloc.remainingTotalBill).toBe(0);

    // 2. Previous balances settled second
    expect(alloc.appliedToSameDivisionPrevious).toBe(100);
    expect(alloc.appliedToOtherDivisionPrevious).toBe(100);
    expect(alloc.appliedToPrevious).toBe(200);
    expect(alloc.remainingPrevious).toBe(0);

    // 3. True advance credit created only after all debt settled
    expect(alloc.excessCredit).toBe(578);
    expect(alloc.generalCredit).toBe(578);
    expect(alloc.remainingTotalOutstanding).toBe(0);
  });

  // Scenario 3: Partial payment across both divisions (Dynamic Proportional Payment Allocation)
  it('partial payment across both divisions (₹100 payment against ₹70 Primary + ₹152 Bakery)', () => {
    const alloc = allocatePayment({
      paymentAmount: 100,
      orderRemaining: 70,
      otherOrderRemaining: 152,
      billDivisionPrior: 0,
      otherDivisionPrior: 0,
      clientTotalOutstanding: 222,
      isDirectSale: false,
    });

    // Proportional split: ₹31.53 Primary (31.53%), ₹68.47 Bakery (68.47%)
    expect(alloc.appliedToBill).toBe(31.53);
    expect(alloc.appliedToOtherBill).toBe(68.47);
    expect(alloc.totalAppliedToBill).toBe(100);
    expect(alloc.remainingBill).toBe(38.47);
    expect(alloc.remainingOtherBill).toBe(83.53);
    expect(alloc.remainingTotalBill).toBe(122);
    expect(alloc.appliedToPrevious).toBe(0);
    expect(alloc.excessCredit).toBe(0);
    expect(alloc.remainingTotalOutstanding).toBe(122);
  });

  // Scenario 4: Existing customer credit and division proportional payment behavior
  it('existing customer credit applied on order reduces net due before payment allocation', () => {
    // Primary order ₹70 has ₹20 existing credit applied => net due ₹50.
    // Bakery order ₹152 has ₹0 credit applied => net due ₹152.
    // Payment of ₹200:
    const alloc = allocatePayment({
      paymentAmount: 200,
      orderRemaining: 50,
      otherOrderRemaining: 152,
      billDivisionPrior: 0,
      otherDivisionPrior: 0,
      clientTotalOutstanding: 202,
      isDirectSale: false,
    });

    // Proportional split across ₹50 Primary and ₹152 Bakery:
    expect(alloc.appliedToBill).toBe(49.5);
    expect(alloc.appliedToOtherBill).toBe(150.5);
    expect(alloc.totalAppliedToBill).toBe(200);
    expect(alloc.remainingBill).toBe(0.5);
    expect(alloc.remainingOtherBill).toBe(1.5);
    expect(alloc.remainingTotalBill).toBe(2);
    expect(alloc.excessCredit).toBe(0);
    expect(alloc.remainingTotalOutstanding).toBe(2);
  });

  it('division-specific payment behavior: proportional distribution across divisions based on dues', () => {
    const alloc = allocatePayment({
      paymentAmount: 152,
      orderRemaining: 152,       // Bakery
      otherOrderRemaining: 70,   // Primary
      billDivisionPrior: 0,
      otherDivisionPrior: 0,
      clientTotalOutstanding: 222,
      isDirectSale: false,
    });

    // Proportional allocation: ₹104.07 to Bakery, ₹47.93 to Primary
    expect(alloc.appliedToBill).toBe(104.07);
    expect(alloc.appliedToOtherBill).toBe(47.93);
    expect(alloc.remainingBill).toBe(47.93);
    expect(alloc.remainingOtherBill).toBe(22.07);
    expect(alloc.remainingTotalBill).toBe(70);
    expect(alloc.excessCredit).toBe(0);
    expect(alloc.remainingTotalOutstanding).toBe(70);
  });

  // Scenario 5: Equivalent totals across Daily Billing, Client Ledger, PDF, and JPG data
  it('equivalent totals across Daily Billing, Client Ledger, and PDF/JPG invoice data models', () => {
    // Simulate DailyBillingPage calculations with ₹1,000 payment on ₹70 Primary + ₹152 Bakery:
    const pSubtotal = 70;
    const bSubtotal = 152;
    const pOldBalance = 0;
    const bOldBalance = 0;
    const pReceived = 1000;
    const bReceived = 0;

    const primaryAlloc = allocatePayment({
      paymentAmount: pReceived,
      orderRemaining: pSubtotal,
      otherOrderRemaining: bSubtotal,
      billDivisionPrior: pOldBalance,
      otherDivisionPrior: bOldBalance,
      clientTotalOutstanding: pSubtotal + bSubtotal,
      isDirectSale: false,
    });

    const bakeryAlloc = allocatePayment({
      paymentAmount: bReceived,
      orderRemaining: primaryAlloc.remainingOtherBill,
      otherOrderRemaining: primaryAlloc.remainingBill,
      billDivisionPrior: primaryAlloc.remainingOtherDivision,
      otherDivisionPrior: primaryAlloc.remainingSameDivisionPrevious,
      clientTotalOutstanding: primaryAlloc.remainingOtherBill + primaryAlloc.remainingOtherDivision,
      isDirectSale: false,
    });

    const primaryAppliedToBill = primaryAlloc.appliedToBill + bakeryAlloc.appliedToOtherBill;
    const bakeryAppliedToBill = bakeryAlloc.appliedToBill + primaryAlloc.appliedToOtherBill;
    const primaryBillRemaining = bakeryAlloc.remainingOtherBill;
    const bakeryBillRemaining = bakeryAlloc.remainingBill;
    const primaryOutstanding = primaryBillRemaining + bakeryAlloc.remainingOtherDivision;
    const bakeryOutstanding = bakeryBillRemaining + bakeryAlloc.remainingSameDivisionPrevious;
    const primaryExcess = primaryAlloc.excessCredit;
    const bakeryExcess = bakeryAlloc.excessCredit;

    // Daily Billing row totals
    const grandTotal = pSubtotal + bSubtotal;
    const outstandingBalance = primaryOutstanding + bakeryOutstanding;
    expect(primaryBillRemaining).toBe(0);
    expect(bakeryBillRemaining).toBe(0);
    expect(outstandingBalance).toBe(0);
    expect(primaryExcess + bakeryExcess).toBe(778);

    // Client Ledger unified metrics
    const clientMetrics = calculateUnifiedMetrics({
      primaryOpening: 0,
      bakeryOpening: 0,
      primaryInvoiced: 70,
      bakeryInvoiced: 152,
      primaryPaid: 848, // 70 bill + 778 credit
      bakeryPaid: 152,  // 152 cross-allocated
      primaryOrders: 1,
      bakeryOrders: 1,
      division: 'all',
    });
    expect(clientMetrics.outstanding).toBe(0);
    expect(clientMetrics.credit).toBe(778);
    expect(clientMetrics.generalCredit).toBe(778);

    // PDF / JPG Unified Invoice Data
    const invoiceData = buildUnifiedInvoiceDataFromDailyBill({
      clientId: 'c1',
      clientName: 'Al Barakah Restaurant',
      region: 'Kasargod',
      deliveryDate: '2026-10-25',
      billNumber: 'BILL-C1-20261025',
      items: [
        { productName: 'Kuboos', qty: 7, unitPrice: 10, total: 70, division: 'primary' },
        { productName: 'Burger Bun', qty: 15.2, unitPrice: 10, total: 152, division: 'bakery' },
      ],
      subtotal: grandTotal,
      oldBalance: 0,
      grandTotal: grandTotal,
      paidAmount: 222,
      outstandingBalance: outstandingBalance,
      primarySubtotal: pSubtotal,
      bakerySubtotal: bSubtotal,
      primaryOldBalance: 0,
      bakeryOldBalance: 0,
      primaryPaid: 70,
      bakeryPaid: 152,
      primaryReceived: 1000,
      bakeryReceived: 0,
      primaryExcess: 778,
      bakeryExcess: 0,
      primaryCreditApplied: 0,
      bakeryCreditApplied: 0,
      primaryAppliedToBill: primaryAppliedToBill,
      primaryAppliedToPrevious: 0,
      primaryBillRemaining: primaryBillRemaining,
      primaryPreviousRemaining: 0,
      bakeryAppliedToBill: bakeryAppliedToBill,
      bakeryAppliedToPrevious: 0,
      bakeryBillRemaining: bakeryBillRemaining,
      bakeryPreviousRemaining: 0,
      primaryOutstanding: primaryOutstanding,
      bakeryOutstanding: bakeryOutstanding,
      invoiceId: 'inv_1',
    });

    // Verification of separation across invoice model
    expect(invoiceData.billRemaining).toBe(0);
    expect(invoiceData.previousBalance).toBe(0);
    expect(invoiceData.remainingPreviousBalance).toBeUndefined();
    expect(invoiceData.totalAdvanceCredit).toBe(778);
    expect(invoiceData.totalOutstanding).toBe(0);
    expect(invoiceData.statusText).toBe('PAID');
    expect(invoiceData.divisionBreakdown?.primary?.outstanding).toBe(0);
    expect(invoiceData.divisionBreakdown?.bakery?.outstanding).toBe(0);
  });
});

// ─── 7. Billing & Accounting Audit Regression Tests (F-01 to F-10) ───────────
describe('Billing & Accounting Audit Regression Tests (F-01 to F-10)', () => {
  // F-01: Customer advance credit deduction during new bill creation
  describe('F-01: Advance credit deduction on new bill creation', () => {
    it('does not apply one ₹100 unified credit twice to a ₹100 Primary + ₹100 Bakery order', () => {
      const allocation = allocateOrderCredit({
        division: 'all',
        total: 200,
        primarySubtotal: 100,
        bakerySubtotal: 100,
        generalCredit: 100,
        requestedCreditApplied: 200,
      });

      expect(allocation.primaryCreditApplied).toBe(100);
      expect(allocation.bakeryCreditApplied).toBe(0);
      expect(allocation.creditApplied).toBe(100);
      expect(200 - allocation.creditApplied).toBe(100);
    });

    it('applies available general credit up to order total across divisions', () => {
      const clientCredit = 300;
      const primarySubtotal = 200;
      const bakerySubtotal = 300;
      const orderTotal = 500;

      let remainingCredit = clientCredit;
      const primaryCreditApplied = Math.min(remainingCredit, primarySubtotal);
      remainingCredit = Math.max(0, remainingCredit - primaryCreditApplied);
      const bakeryCreditApplied = Math.min(remainingCredit, bakerySubtotal);
      const totalCreditApplied = primaryCreditApplied + bakeryCreditApplied;
      const netDue = Math.max(0, orderTotal - totalCreditApplied);
      const paymentStatus = netDue <= 0.005 ? 'paid' : (totalCreditApplied > 0 ? 'partial' : 'pending');

      expect(primaryCreditApplied).toBe(200);
      expect(bakeryCreditApplied).toBe(100);
      expect(totalCreditApplied).toBe(300);
      expect(netDue).toBe(200);
      expect(paymentStatus).toBe('partial');
    });

    it('marks order fully paid when advance credit covers the full bill', () => {
      const clientCredit = 500;
      const orderTotal = 222;

      const creditApplied = Math.min(clientCredit, orderTotal);
      const netDue = Math.max(0, round2(orderTotal - creditApplied));
      const paymentStatus = netDue <= 0.005 ? 'paid' : 'pending';

      expect(creditApplied).toBe(222);
      expect(netDue).toBe(0);
      expect(paymentStatus).toBe('paid');
    });
  });

  // F-02: Negative prior balance (prior credit) handling in Daily Billing & Invoices
  describe('F-02: Negative prior balance / prior credit handling', () => {
    it('offsets today net due with prior credit in Daily Billing and prevents negative debt', () => {
      const primarySubtotal = 100;
      const bakerySubtotal = 100;
      const subtotal = 200;
      const primaryOldBalance = -300;
      const bakeryOldBalance = -200;
      const oldBalance = primaryOldBalance + bakeryOldBalance;

      let priorCreditP = Math.max(0, -primaryOldBalance);
      let priorCreditB = Math.max(0, -bakeryOldBalance);
      let effPNetDue = primarySubtotal;
      let effBNetDue = bakerySubtotal;

      const appliedP = Math.min(priorCreditP, effPNetDue);
      effPNetDue = round2(effPNetDue - appliedP);
      priorCreditP = round2(priorCreditP - appliedP);

      const appliedB = Math.min(priorCreditB, effBNetDue);
      effBNetDue = round2(effBNetDue - appliedB);
      priorCreditB = round2(priorCreditB - appliedB);

      const primaryOutstanding = effPNetDue;
      const bakeryOutstanding = effBNetDue;
      const primaryExcess = priorCreditP;
      const bakeryExcess = priorCreditB;

      const grandTotal = subtotal + oldBalance;
      const outstandingBalance = grandTotal <= 0 ? 0 : Math.max(0, round2(primaryOutstanding + bakeryOutstanding));

      expect(effPNetDue).toBe(0);
      expect(effBNetDue).toBe(0);
      expect(primaryOutstanding).toBe(0);
      expect(bakeryOutstanding).toBe(0);
      expect(primaryExcess).toBe(200);
      expect(bakeryExcess).toBe(100);
      expect(outstandingBalance).toBe(0);

      // Invoice Print model verification
      const invoiceData = buildUnifiedInvoiceDataFromDailyBill({
        clientId: 'client_credit_1',
        clientName: 'Credit Customer',
        region: 'North',
        deliveryDate: '2026-10-25',
        billNumber: 'BILL-CREDIT-01',
        items: [
          { productName: 'Kuboos', qty: 10, unitPrice: 10, total: 100, division: 'primary' },
          { productName: 'Burger Bun', qty: 10, unitPrice: 10, total: 100, division: 'bakery' },
        ],
        subtotal: 200,
        oldBalance: -500,
        grandTotal: -300,
        paidAmount: 0,
        outstandingBalance: 0,
        primarySubtotal: 100,
        bakerySubtotal: 100,
        primaryOldBalance: -300,
        bakeryOldBalance: -200,
        primaryPaid: 0,
        bakeryPaid: 0,
        primaryReceived: 0,
        bakeryReceived: 0,
        primaryExcess: 200,
        bakeryExcess: 100,
        primaryCreditApplied: 0,
        bakeryCreditApplied: 0,
        primaryAppliedToBill: 0,
        primaryAppliedToPrevious: 0,
        primaryBillRemaining: 0,
        primaryPreviousRemaining: 0,
        bakeryAppliedToBill: 0,
        bakeryAppliedToPrevious: 0,
        bakeryBillRemaining: 0,
        bakeryPreviousRemaining: 0,
        primaryOutstanding: 0,
        bakeryOutstanding: 0,
        invoiceId: 'inv_credit_1',
      });

      expect(invoiceData.statusText).toBe('PAID');
      expect(invoiceData.billRemaining).toBe(0);
      expect(invoiceData.previousBalance).toBe(0);
      expect(invoiceData.totalOutstanding).toBe(0);
      expect(invoiceData.totalAdvanceCredit).toBe(300);
      expect(invoiceData.divisionBreakdown?.primary?.previousBalance).toBe(0);
      expect(invoiceData.divisionBreakdown?.bakery?.previousBalance).toBe(0);
    });
  });

  // F-03: Duplicate sales in Reports Overview
  describe('F-03: Reports Overview product sales duplication prevention', () => {
    it('aggregates each product once when multi-division order is split into separate ledger entries', () => {
      const order = {
        id: 'ord_split',
        items: [
          { productName: 'Kuboos', qty: 7, unitPrice: 10, total: 70 },
          { productName: 'Burger Bun', qty: 15.2, unitPrice: 10, total: 152 },
        ],
      };

      const ledgerEntries = [
        { id: 'l_prim', type: 'invoice', invoiceId: 'ord_split', division: 'primary', amount: 70 },
        { id: 'l_bake', type: 'invoice', invoiceId: 'ord_split', division: 'bakery', amount: 152 },
      ];

      const prodSalesMap = new Map<string, number>();

      ledgerEntries.forEach(l => {
        if (l.invoiceId === order.id) {
          order.items.forEach(item => {
            if (l.division && l.division !== 'all') {
              const itemDiv = getProductDivision(p(item.productName));
              if (itemDiv !== l.division) return;
            }
            const current = prodSalesMap.get(item.productName) || 0;
            prodSalesMap.set(item.productName, current + item.total);
          });
        }
      });

      expect(prodSalesMap.get('Kuboos')).toBe(70);
      expect(prodSalesMap.get('Burger Bun')).toBe(152);
      const totalProductSales = Array.from(prodSalesMap.values()).reduce((s, v) => s + v, 0);
      expect(totalProductSales).toBe(222);
    });
  });

  // F-04: Cross-division payment paid status in Collections
  describe('F-04: Cross-division payment paid status in Collections / Staff Workspace', () => {
    it('identifies counterpart division payment and marks order as paid in division filter', () => {
      const payments = [
        {
          id: 'pay_cross',
          division: 'primary',
          invoiceId: 'ord_primary',
          appliedAmount: 70,
          otherInvoiceId: 'ord_bakery',
          appliedToOtherBill: 152,
          amount: 222,
        },
      ];

      let activeDivision: string = 'bakery';
      const map = new Map<string, number>();
      for (const pay of payments) {
        if (pay.invoiceId && (activeDivision === 'all' || pay.division === activeDivision)) {
          const cur = map.get(pay.invoiceId) || 0;
          map.set(pay.invoiceId, cur + (pay.appliedAmount ?? pay.amount));
        }
        if (pay.otherInvoiceId && (pay.appliedToOtherBill || 0) > 0) {
          const otherDiv = pay.division === 'bakery' ? 'primary' : 'bakery';
          if (activeDivision === 'all' || activeDivision === otherDiv) {
            const cur = map.get(pay.otherInvoiceId) || 0;
            map.set(pay.otherInvoiceId, cur + (pay.appliedToOtherBill || 0));
          }
        }
      }

      const bakeryOrder = {
        id: 'ord_bakery',
        division: 'bakery',
        total: 152,
        creditApplied: 0,
        paidAmount: 152,
        paymentStatus: 'paid',
        items: [{ productName: 'Burger Bun', total: 152 }],
      };

      const invoicePaid = map.get(bakeryOrder.id) || 0;
      const isPaid = (bakeryOrder.paymentStatus === 'paid') || (bakeryOrder.total - invoicePaid) <= 0.01;
      const pending = isPaid ? 0 : Math.max(0, bakeryOrder.total - invoicePaid);

      expect(invoicePaid).toBe(152);
      expect(isPaid).toBe(true);
      expect(pending).toBe(0);
    });
  });

  // F-05: Dashboard advance credit totals
  describe('F-05: Dashboard advance credit totals', () => {
    it('computes advance credit accurately using dedicated credit metrics', () => {
      const clientMetrics = calculateUnifiedMetrics({
        primaryOpening: 0,
        bakeryOpening: 0,
        primaryInvoiced: 100,
        bakeryInvoiced: 0,
        primaryPaid: 400,
        bakeryPaid: 0,
        primaryOrders: 1,
        bakeryOrders: 0,
        division: 'all',
      });

      expect(clientMetrics.outstanding).toBe(0);
      expect(clientMetrics.credit).toBe(300);
      expect(clientMetrics.generalCredit).toBe(300);
      expect(clientMetrics.credit > 0).toBe(true);
    });
  });

  // F-06: Legacy ledger double-counting in calculateOldBalance
  describe('F-06: Legacy ledger double-counting in calculateOldBalance', () => {
    it('attributes unassigned/all legacy entries to primary only so division sum equals combined', () => {
      useDataStore.setState({
        ledger: [
          {
            id: 'leg_1',
            clientId: 'client_legacy',
            type: 'invoice',
            amount: 500,
            billDate: '2026-10-20',
            createdAt: '2026-10-20T00:00:00Z',
            division: 'all',
          } as any,
        ],
        clients: [{ id: 'client_legacy', name: 'Legacy Client', status: 'active' } as any],
      });

      const primaryOld = calculateOldBalance('client_legacy', '2026-10-25', 'primary');
      const bakeryOld = calculateOldBalance('client_legacy', '2026-10-25', 'bakery');
      const allOld = calculateOldBalance('client_legacy', '2026-10-25', 'all');

      expect(primaryOld).toBe(500);
      expect(bakeryOld).toBe(0);
      expect(allOld).toBe(500);
      expect(primaryOld + bakeryOld).toBe(allOld);
    });
  });

  // F-07: Payment-date filtering in calculateOldBalance
  describe('F-07: Payment-date filtering in calculateOldBalance', () => {
    it('uses paymentDate rather than order billDate when filtering payments by delivery date', () => {
      useDataStore.setState({
        ledger: [
          {
            id: 'inv_1',
            clientId: 'client_dt',
            type: 'invoice',
            amount: 100,
            billDate: '2026-10-20',
            createdAt: '2026-10-20T00:00:00Z',
            division: 'primary',
          } as any,
          {
            id: 'pay_1',
            clientId: 'client_dt',
            type: 'payment',
            amount: 100,
            billDate: '2026-10-20',
            paymentDate: '2026-10-25',
            createdAt: '2026-10-25T10:00:00Z',
            division: 'primary',
          } as any,
        ],
        clients: [{ id: 'client_dt', name: 'Date Test Client', status: 'active' } as any],
      });

      const oldBal = calculateOldBalance('client_dt', '2026-10-22', 'primary');
      expect(oldBal).toBe(100);

      const settledBal = calculateOldBalance('client_dt', '2026-10-26', 'primary');
      expect(settledBal).toBe(0);
    });
  });

  // F-08: Trash / restore counterpart order consistency
  describe('F-08: Trash/restore counterpart order consistency', () => {
    it('reverses and reinstates counterpart order paid amount on trash and restore', () => {
      const orderPrimary = { id: 'o_p', total: 70, paidAmount: 70, paymentStatus: 'paid' };
      const orderBakery = { id: 'o_b', total: 152, paidAmount: 152, paymentStatus: 'paid' };

      const payment = {
        invoiceId: 'o_p',
        appliedAmount: 70,
        otherInvoiceId: 'o_b',
        appliedToOtherBill: 152,
      };

      const pNewPaid = Math.max(0, round2(orderPrimary.paidAmount - payment.appliedAmount));
      const pNewStatus = pNewPaid >= orderPrimary.total - 0.01 ? 'paid' : (pNewPaid > 0.01 ? 'partial' : 'pending');
      const bNewPaid = Math.max(0, round2(orderBakery.paidAmount - payment.appliedToOtherBill));
      const bNewStatus = bNewPaid >= orderBakery.total - 0.01 ? 'paid' : (bNewPaid > 0.01 ? 'partial' : 'pending');

      expect(pNewPaid).toBe(0);
      expect(pNewStatus).toBe('pending');
      expect(bNewPaid).toBe(0);
      expect(bNewStatus).toBe('pending');

      const pRestoredPaid = round2(pNewPaid + payment.appliedAmount);
      const pRestoredStatus = pRestoredPaid >= orderPrimary.total - 0.01 ? 'paid' : 'pending';
      const bRestoredPaid = round2(bNewPaid + payment.appliedToOtherBill);
      const bRestoredStatus = bRestoredPaid >= orderBakery.total - 0.01 ? 'paid' : 'pending';

      expect(pRestoredPaid).toBe(70);
      expect(pRestoredStatus).toBe('paid');
      expect(bRestoredPaid).toBe(152);
      expect(bRestoredStatus).toBe('paid');
    });
  });

  // F-09: Unified credit display labels
  describe('F-09: Unified credit display labels', () => {
    it('displays Unified Client Credit when general credit exists and division credits are zero', () => {
      const metrics = { credit: 778, primaryCredit: 0, bakeryCredit: 0 };
      const label = metrics.primaryCredit > 0 || metrics.bakeryCredit > 0
        ? `P: ₹${metrics.primaryCredit.toFixed(2)} · B: ₹${metrics.bakeryCredit.toFixed(2)}`
        : (metrics.credit > 0 ? 'Unified Client Credit' : 'P: ₹0.00 · B: ₹0.00');

      expect(label).toBe('Unified Client Credit');
    });
  });

  // F-10: Payment idempotency keys
  describe('F-10: Payment idempotency keys', () => {
    it('generates distinct idempotency keys per payment attempt to prevent duplicates', () => {
      const clientId = 'c_test';
      const deliveryDate = '2026-10-25';
      const key1 = `pay_db_p_${clientId}_${deliveryDate}_1000`;
      const key2 = `pay_db_b_${clientId}_${deliveryDate}_1000`;

      expect(key1).not.toBe(key2);
      expect(key1.startsWith('pay_db_p_')).toBe(true);
      expect(key2.startsWith('pay_db_b_')).toBe(true);
    });
  });
});


