import { describe, expect, it } from 'vitest';
import { allocateOrderCredit } from './billing';
import {
  getCustomerCreditBalancePath,
  resolveSpendableCustomerCredit,
} from './customerCreditBalance';
import type { CustomerCreditBalance } from '../types/customerCreditBalance.types';

const verifiedBalance = (availableCredit: number): CustomerCreditBalance => ({
  clientId: 'client-1',
  state: 'verified',
  availableCredit,
  revision: 1,
  reviewedAt: '2026-10-25T00:00:00.000Z',
  reviewedBy: 'admin-1',
  reviewBasis: { reviewedLedgerThrough: '2026-10-25' },
  updatedAt: '2026-10-25T00:00:00.000Z',
});

describe('customer credit balance compatibility model', () => {
  it('documents the planned dedicated balance path', () => {
    expect(getCustomerCreditBalancePath('client-1')).toBe('clientCreditBalances/client-1');
  });

  it('treats a missing balance document as zero spendable credit', () => {
    expect(resolveSpendableCustomerCredit(undefined)).toBe(0);
    expect(resolveSpendableCustomerCredit(null)).toBe(0);
  });

  it('treats a reconciliation-required balance as zero spendable credit', () => {
    expect(resolveSpendableCustomerCredit({
      clientId: 'client-1',
      state: 'reconciliation-required',
      availableCredit: 100,
      revision: 1,
      updatedAt: '2026-10-25T00:00:00.000Z',
    })).toBe(0);
  });

  it('uses a verified ₹100 balance as at most ₹100 spendable credit', () => {
    expect(resolveSpendableCustomerCredit(verifiedBalance(100))).toBe(100);
    expect(resolveSpendableCustomerCredit(verifiedBalance(100.009))).toBe(100.01);
  });

  it('allocates one verified unified pool Primary first across a mixed order', () => {
    const allocation = allocateOrderCredit({
      division: 'all',
      total: 200,
      primarySubtotal: 100,
      bakerySubtotal: 100,
      generalCredit: resolveSpendableCustomerCredit(verifiedBalance(100)),
    });

    expect(allocation).toEqual({
      creditApplied: 100,
      primaryCreditApplied: 100,
      bakeryCreditApplied: 0,
    });
  });

  it('never accepts legacy aggregate fields as a spendable-credit source', () => {
    const legacyClientAggregate = {
      generalCredit: 100,
      availableCredit: 100,
      credit: 100,
      primaryCredit: 100,
      bakeryCredit: 100,
      primaryTotals: { rawBalance: -100 },
      bakeryTotals: { rawBalance: -100 },
    };

    expect(
      resolveSpendableCustomerCredit(legacyClientAggregate as unknown as CustomerCreditBalance),
    ).toBe(0);
    expect(legacyClientAggregate.generalCredit).toBe(100);
  });
});
