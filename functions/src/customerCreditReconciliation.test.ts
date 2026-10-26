import { describe, expect, it, vi } from 'vitest';
import { buildTrustedCreditReport, readTrustedCustomerCreditReview, type ReviewSources } from './customerCreditReconciliation';

const source = (): ReviewSources => ({
  clientId: 'c', client: { id: 'c', data: { generalCredit: 100 } },
  orders: [{ id: 'o1', data: { clientId: 'c', creditApplied: 0, primaryCreditApplied: 0, bakeryCreditApplied: 0 } }, { id: 'o2', data: { clientId: 'c', creditApplied: 0, primaryCreditApplied: 0, bakeryCreditApplied: 0 } }],
  payments: [{ id: 'p', data: { clientId: 'c', amount: 222, division: 'primary', appliedToOtherBill: 152, otherInvoiceId: 'o2' } }],
  ledger: [{ id: 'l1', data: { clientId: 'c', type: 'payment', paymentId: 'p', invoiceId: 'o1', division: 'primary', amount: 70 } }, { id: 'l2', data: { clientId: 'c', type: 'payment', paymentId: 'p', invoiceId: 'o2', division: 'bakery', amount: 152 } }],
  balance: { id: 'c', data: { clientId: 'c', state: 'verified', availableCredit: 0, revision: 1, reviewedAt: 'today', reviewedBy: 'admin', reviewBasis: { notes: 'reviewed' } } },
});
describe('trusted credit reconciliation', () => {
  it('preserves separate cross-division allocations without deriving spendable credit', () => {
    const report = buildTrustedCreditReport(source());
    expect(report.blockingFindings).toEqual([]);
    expect(report.proposedSpendableCredit).toBeNull();
    expect(report.legacyAggregates.generalCredit).toBe(100);
    expect(report.persistedFacts.ledger.map(e => e.data.amount)).toEqual([70, 152]);
  });
  it('blocks duplicate allocation, missing counterpart, and invalid or missing amounts', () => {
    const s = source(); s.ledger.push({ ...s.ledger[0]!, id: 'duplicate' }); s.ledger.splice(1, 1);
    delete s.payments[0]!.data.amount;
    const codes = buildTrustedCreditReport(s).blockingFindings.map(f => f.code);
    expect(codes).toContain('duplicate-allocation'); expect(codes).toContain('missing-cross-division-counterpart'); expect(codes).toContain('unresolved-payment-allocation');
  });
  it('flags unresolved legacy identifiers, ownership and unverified evidence', () => {
    const s = source(); s.balance = null; delete s.ledger[0]!.data.paymentId; s.orders[0]!.data.clientId = 'other';
    const codes = buildTrustedCreditReport(s).blockingFindings.map(f => f.code);
    expect(codes).toContain('missing-payment-id'); expect(codes).toContain('customer-ownership'); expect(codes).toContain('unverified-credit-evidence');
  });
  it('flags discrepancies in opening balances, invoice division and counterpart amounts', () => {
    const s = source(); s.client.data.openingBalanceAmount = 5; s.orders[0]!.data.division = 'bakery'; s.payments[0]!.data.appliedToOtherBill = 151;
    const codes = buildTrustedCreditReport(s).blockingFindings.map(f => f.code);
    expect(codes).toContain('opening-balance-discrepancy'); expect(codes).toContain('invoice-division-mismatch'); expect(codes).toContain('cross-division-mismatch');
  });
  it('fingerprints source data deterministically independent of ordering and changes on revision', () => {
    const a = source(), b = source(); b.orders.reverse(); b.ledger.reverse();
    expect(buildTrustedCreditReport(a).sourceFingerprint).toBe(buildTrustedCreditReport(b).sourceFingerprint);
    b.balance!.data.revision = 2;
    expect(buildTrustedCreditReport(a).sourceFingerprint).not.toBe(buildTrustedCreditReport(b).sourceFingerprint);
  });
  it('rejects staff and missing auth before accessing financial data', async () => {
    const transaction = vi.fn();
    const db = { collection: vi.fn(() => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ role: 'staff', status: 'active' }) }) }) })), runTransaction: transaction };
    await expect(readTrustedCustomerCreditReview(db as never, 'staff', 'c')).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(readTrustedCustomerCreditReview(db as never, undefined, 'c')).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(transaction).not.toHaveBeenCalled();
  });
});
