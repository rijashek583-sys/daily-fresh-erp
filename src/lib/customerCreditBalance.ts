import type { CustomerCreditBalance } from '../types/customerCreditBalance.types';

/**
 * Planned document path for the dedicated transactional customer-credit state.
 * This helper is documentation/model-only in Phase 1; no Firestore access is
 * introduced until a separately approved implementation phase.
 */
export function getCustomerCreditBalancePath(clientId: string): string {
  return `clientCreditBalances/${clientId}`;
}

/**
 * Resolves the only credit amount that may be automatically applied to a new
 * order in the future transactional flow.
 *
 * Invariants:
 * - Missing balances are treated as unavailable, not as a legacy fallback.
 * - `reconciliation-required` balances are unavailable.
 * - Legacy client aggregate fields are deliberately not accepted as input.
 * - A verified balance is clamped to a non-negative, two-decimal amount.
 */
export function resolveSpendableCustomerCredit(
  balance: CustomerCreditBalance | null | undefined,
): number {
  if (!balance || balance.state !== 'verified') return 0;

  const value = Number(balance.availableCredit);
  if (!Number.isFinite(value) || value <= 0) return 0;

  return Math.round((value + Number.EPSILON) * 100) / 100;
}
