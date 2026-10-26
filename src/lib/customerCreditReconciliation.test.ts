import { describe, expect, it } from 'vitest';
import type { Client, LedgerTransaction, Order, Payment } from '../types';
import type { CustomerCreditBalance } from '../types/customerCreditBalance.types';
import { buildCustomerCreditReconciliationReport } from './customerCreditReconciliation';

const client = (overrides: Partial<Client> = {}): Client => ({
  id: 'client-1', name: 'Customer', region: 'North', status: 'active',
  totalOrders: 0, totalRevenue: 0, outstanding: 0, ...overrides,
});

const order = (overrides: Partial<Order> = {}): Order => ({
  id: 'order-1', clientId: 'client-1', clientName: 'Customer', deliveryDate: '2026-10-25',
  items: [], subtotal: 100, tax: 0, total: 100, createdAt: '2026-10-25T00:00:00.000Z',
  updatedAt: '2026-10-25T00:00:00.000Z', ...overrides,
});

const payment = (overrides: Partial<Payment> = {}): Payment => ({
  id: 'payment-1', clientId: 'client-1', clientName: 'Customer', amount: 100,
  method: 'cash', division: 'primary', createdAt: '2026-10-25T00:00:00.000Z', ...overrides,
});

const ledger = (overrides: Partial<LedgerTransaction> = {}): LedgerTransaction => ({
  id: 'ledger-1', type: 'invoice', clientId: 'client-1', amount: 100,
  division: 'primary', createdAt: '2026-10-25T00:00:00.000Z', ...overrides,
});

const baseInput = () => ({
  client: client({ rawBalance: 100 }),
  activeOrders: [order({ creditApplied: 0 })],
  payments: [],
  ledger: [ledger()],
  balance: null,
});

const codes = (input: ReturnType<typeof baseInput>) =>
  buildCustomerCreditReconciliationReport(input).blockingFindings
    .concat(buildCustomerCreditReconciliationReport(input).ambiguityFindings)
    .map(finding => finding.code);

describe('buildCustomerCreditReconciliationReport', () => {
  it('reports clean persisted facts without proposing spendable credit', () => {
    const report = buildCustomerCreditReconciliationReport(baseInput());

    expect(report.ledgerDerivedBalance).toEqual({ openingBalance: 0, invoiced: 100, payments: 0, rawBalance: 100 });
    expect(report.activeOrderCreditFacts).toEqual([
      { orderId: 'order-1', creditApplied: 0, primaryCreditApplied: null, bakeryCreditApplied: null },
    ]);
    expect(report.ambiguityFindings).toEqual([]);
    expect(report.blockingFindings).toEqual([]);
    expect(report.proposedSpendableCredit).toBeNull();
  });

  it('flags a duplicate stable payment allocation only when payment and invoice both match', () => {
    const input = baseInput();
    input.payments = [payment({ invoiceId: 'order-1' })];
    input.ledger = [
      ledger({ id: 'payment-ledger-a', type: 'payment', paymentId: 'payment-1', invoiceId: 'order-1', amount: 50, appliedAmount: 50 }),
      ledger({ id: 'payment-ledger-b', type: 'payment', paymentId: 'payment-1', invoiceId: 'order-1', amount: 50, appliedAmount: 50 }),
    ];

    expect(codes(input)).toContain('duplicate-payment-id');
  });

  it('does not treat valid cross-division allocations with separate invoice IDs as duplicates', () => {
    const input = baseInput();
    input.payments = [payment({ invoiceId: 'primary-order', otherInvoiceId: 'bakery-order', amount: 222, appliedToOtherBill: 152 })];
    input.ledger = [
      ledger({ id: 'primary-ledger', type: 'payment', paymentId: 'payment-1', invoiceId: 'primary-order', amount: 70, appliedAmount: 70 }),
      ledger({ id: 'bakery-ledger', type: 'payment', paymentId: 'payment-1', invoiceId: 'bakery-order', amount: 152, appliedAmount: 152, division: 'bakery' }),
    ];

    expect(codes(input)).not.toContain('duplicate-payment-id');
    expect(codes(input)).not.toContain('missing-cross-division-counterpart-allocation');
  });

  it('flags payment records and ledger postings without stable payment IDs', () => {
    const input = baseInput();
    input.payments = [payment({ id: '' })];
    input.ledger = [ledger({ type: 'payment', paymentId: undefined, amount: 100 })];

    expect(codes(input)).toContain('missing-payment-id');
  });

  it('flags missing legacy cross-division counterparts', () => {
    const input = baseInput();
    input.payments = [payment({ appliedToOtherBill: 30 })];
    input.ledger = [ledger({ type: 'payment', paymentId: 'payment-1', amount: 100 })];

    expect(codes(input)).toContain('missing-cross-division-counterpart-allocation');
  });

  it('flags mismatched payment and ledger allocations', () => {
    const input = baseInput();
    input.payments = [payment({ invoiceId: 'order-1', amount: 100 })];
    input.ledger = [ledger({ type: 'payment', paymentId: 'payment-1', invoiceId: 'order-1', amount: 80, appliedAmount: 80 })];

    expect(codes(input)).toContain('payment-ledger-allocation-mismatch');
  });

  it('flags opening-balance discrepancies without modifying the legacy value', () => {
    const input = baseInput();
    input.client = client({ primaryTotals: { totalOrders: 0, totalRevenue: 0, totalPaid: 0, outstanding: 0, openingBalance: 100 } });
    input.ledger = [ledger({ type: 'opening_balance', amount: 70 })];

    expect(codes(input)).toContain('opening-balance-discrepancy');
  });

  it('flags active orders that do not persist any credit allocation field', () => {
    const input = baseInput();
    input.activeOrders = [order()];

    expect(codes(input)).toContain('missing-persisted-order-credit');
  });

  it('keeps legacy aggregate credit as a comparison, never as a proposal', () => {
    const input = baseInput();
    input.client = client({ generalCredit: 100, availableCredit: 100, credit: 100, rawBalance: 0 });
    input.ledger = [];
    const report = buildCustomerCreditReconciliationReport(input);

    expect(report.proposedSpendableCredit).toBeNull();
    expect(report.legacyAggregateComparisons.map(comparison => comparison.field)).toEqual(
      expect.arrayContaining(['client.generalCredit', 'client.availableCredit', 'client.credit']),
    );
    expect(report.ambiguityFindings.map(finding => finding.code)).toContain('legacy-aggregate-discrepancy');
  });

  it('keeps persisted active-order credit separate from ledger-derived balance', () => {
    const input = baseInput();
    input.activeOrders = [order({ creditApplied: 25, primaryCreditApplied: 25, bakeryCreditApplied: 0 })];
    const report = buildCustomerCreditReconciliationReport(input);

    expect(report.activeOrderCreditFacts[0]).toMatchObject({ creditApplied: 25, primaryCreditApplied: 25, bakeryCreditApplied: 0 });
    expect(report.ledgerDerivedBalance.rawBalance).toBe(100);
  });

  it('changes the source fingerprint for reviewed order, payment, ledger, and balance revisions', () => {
    const verifiedBalance: CustomerCreditBalance = {
      clientId: 'client-1', state: 'verified', availableCredit: 10, revision: 1,
      updatedAt: '2026-10-25T00:00:00.000Z', reviewedAt: '2026-10-25T00:00:00.000Z',
      reviewedBy: 'admin-1', reviewBasis: {},
    };
    const input = { ...baseInput(), balance: verifiedBalance, payments: [payment()], ledger: [ledger()] };
    const original = buildCustomerCreditReconciliationReport(input).sourceFingerprint;
    const orderChanged = buildCustomerCreditReconciliationReport({ ...input, activeOrders: [order({ creditApplied: 1 })] }).sourceFingerprint;
    const paymentChanged = buildCustomerCreditReconciliationReport({ ...input, payments: [payment({ amount: 101 })] }).sourceFingerprint;
    const ledgerChanged = buildCustomerCreditReconciliationReport({ ...input, ledger: [ledger({ amount: 101 })] }).sourceFingerprint;
    const balanceChanged = buildCustomerCreditReconciliationReport({ ...input, balance: { ...verifiedBalance, revision: 2 } }).sourceFingerprint;

    expect(orderChanged).not.toBe(original);
    expect(paymentChanged).not.toBe(original);
    expect(ledgerChanged).not.toBe(original);
    expect(balanceChanged).not.toBe(original);
  });
});
