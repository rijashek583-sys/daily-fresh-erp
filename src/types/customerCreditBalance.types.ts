/**
 * Transactional, customer-wide spendable credit state.
 *
 * Planned Firestore location: `clientCreditBalances/{clientId}`.
 * This Phase 1 model intentionally has no Firestore dependency and does not
 * create, read, or write the document yet.
 *
 * Compatibility rule: a missing document, or a document that has not been
 * reconciled and approved, never grants automatic credit to a new order.
 */
export type CustomerCreditBalanceState = 'verified' | 'reconciliation-required';

export interface CustomerCreditBalanceReviewBasis {
  /** Human-readable ledger cut-off or other reviewed accounting basis. */
  reviewedLedgerThrough?: string;
  /** Duplicate or cross-division allocation issues found during review. */
  allocationAmbiguities?: string[];
  notes?: string;
}

interface CustomerCreditBalanceBase {
  clientId: string;
  /** Customer-wide amount available for future, transactionally reserved credit. */
  availableCredit: number;
  /** Incremented by future balance transactions to detect stale review decisions. */
  revision: number;
  updatedAt: string;
}

/** Only Admin-reviewed balances may be used by automatic order credit allocation. */
export interface VerifiedCustomerCreditBalance extends CustomerCreditBalanceBase {
  state: 'verified';
  reviewedAt: string;
  reviewedBy: string;
  reviewBasis: CustomerCreditBalanceReviewBasis;
}

/** A balance awaiting reconciliation is explicitly non-spendable. */
export interface ReconciliationRequiredCustomerCreditBalance extends CustomerCreditBalanceBase {
  state: 'reconciliation-required';
  reviewedAt?: never;
  reviewedBy?: never;
  reviewBasis?: never;
}

export type CustomerCreditBalance =
  | VerifiedCustomerCreditBalance
  | ReconciliationRequiredCustomerCreditBalance;
