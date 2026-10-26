import type { Client, LedgerTransaction, Order, Payment } from '../types';
import type { CustomerCreditBalance } from '../types/customerCreditBalance.types';

/**
 * Input for a read-only customer-credit reconciliation review.
 *
 * Callers must provide a single customer's records. This module deliberately
 * performs no Firestore access and never derives spendable credit from client
 * aggregate fields.
 */
export interface CustomerCreditReconciliationInput {
  client: Client;
  activeOrders: readonly Order[];
  payments: readonly Payment[];
  ledger: readonly LedgerTransaction[];
  balance?: CustomerCreditBalance | null;
}

export type CustomerCreditFindingCode =
  | 'duplicate-payment-id'
  | 'missing-payment-id'
  | 'missing-cross-division-counterpart-allocation'
  | 'payment-ledger-allocation-mismatch'
  | 'opening-balance-discrepancy'
  | 'missing-persisted-order-credit'
  | 'legacy-aggregate-discrepancy';

export interface CustomerCreditReconciliationFinding {
  code: CustomerCreditFindingCode;
  severity: 'ambiguity' | 'blocking';
  message: string;
  recordIds: string[];
  details?: Record<string, number | string | null>;
}

export interface PersistedOrderCreditFact {
  orderId: string;
  /** The persisted order-level value, when present. */
  creditApplied: number | null;
  /** Legacy division values are facts only; they are never a credit source. */
  primaryCreditApplied: number | null;
  bakeryCreditApplied: number | null;
}

export interface LedgerDerivedBalance {
  openingBalance: number;
  invoiced: number;
  payments: number;
  rawBalance: number;
}

export interface LegacyAggregateComparison {
  field: string;
  aggregateValue: number;
  ledgerValue: number;
  matches: boolean;
}

export interface CustomerCreditReconciliationReport {
  clientId: string;
  /** Facts read from active orders; kept separate from ledger-derived facts. */
  activeOrderCreditFacts: PersistedOrderCreditFact[];
  ledgerDerivedBalance: LedgerDerivedBalance;
  legacyAggregateComparisons: LegacyAggregateComparison[];
  ambiguityFindings: CustomerCreditReconciliationFinding[];
  blockingFindings: CustomerCreditReconciliationFinding[];
  /** Approval is intentionally outside this read-only report. */
  proposedSpendableCredit: null;
  /** Deterministic serialization of every reviewed source record and revision. */
  sourceFingerprint: string;
}

const money = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round((numeric + Number.EPSILON) * 100) / 100 : null;
};

const amountOrZero = (value: unknown): number => money(value) ?? 0;
const sameMoney = (left: number, right: number): boolean => Math.abs(left - right) < 0.005;
const byId = <T extends { id: string }>(left: T, right: T): number => left.id.localeCompare(right.id);

function addFinding(
  findings: CustomerCreditReconciliationFinding[],
  code: CustomerCreditFindingCode,
  severity: CustomerCreditReconciliationFinding['severity'],
  message: string,
  recordIds: string[],
  details?: CustomerCreditReconciliationFinding['details'],
): void {
  findings.push({ code, severity, message, recordIds: [...recordIds].sort(), details });
}

function activeClientOrders(input: CustomerCreditReconciliationInput): Order[] {
  return input.activeOrders
    .filter(order => order.clientId === input.client.id && !order.deletedAt)
    .slice()
    .sort(byId);
}

function activeClientPayments(input: CustomerCreditReconciliationInput): Payment[] {
  return input.payments
    .filter(payment => payment.clientId === input.client.id && !payment.deletedAt)
    .slice()
    .sort(byId);
}

function clientLedger(input: CustomerCreditReconciliationInput): LedgerTransaction[] {
  return input.ledger
    .filter(entry => entry.clientId === input.client.id)
    .slice()
    .sort(byId);
}

function fingerprintValue(input: CustomerCreditReconciliationInput): string {
  const snapshot = {
    client: {
      id: input.client.id,
      rawBalance: input.client.rawBalance ?? null,
      generalCredit: input.client.generalCredit ?? null,
      availableCredit: input.client.availableCredit ?? null,
      credit: input.client.credit ?? null,
      primaryCredit: input.client.primaryCredit ?? null,
      bakeryCredit: input.client.bakeryCredit ?? null,
      openingBalance: input.client.openingBalance ?? null,
      openingBalanceAmount: input.client.openingBalanceAmount ?? null,
      primaryTotals: input.client.primaryTotals ?? null,
      bakeryTotals: input.client.bakeryTotals ?? null,
    },
    activeOrders: activeClientOrders(input),
    payments: activeClientPayments(input),
    ledger: clientLedger(input),
    balance: input.balance ?? null,
  };
  return `customer-credit-reconciliation-v1:${JSON.stringify(snapshot)}`;
}

/**
 * Produces facts and review blockers from supplied records only. It does not
 * approve a balance, infer a legacy credit amount, or write any data.
 */
export function buildCustomerCreditReconciliationReport(
  input: CustomerCreditReconciliationInput,
): CustomerCreditReconciliationReport {
  const findings: CustomerCreditReconciliationFinding[] = [];
  const orders = activeClientOrders(input);
  const payments = activeClientPayments(input);
  const ledger = clientLedger(input);

  const activeOrderCreditFacts = orders.map(order => {
    const creditApplied = money(order.creditApplied);
    const primaryCreditApplied = money(order.primaryCreditApplied);
    const bakeryCreditApplied = money(order.bakeryCreditApplied);
    if (creditApplied === null && primaryCreditApplied === null && bakeryCreditApplied === null) {
      addFinding(
        findings,
        'missing-persisted-order-credit',
        'blocking',
        'An active order has no persisted credit allocation fields to review.',
        [order.id],
      );
    }
    return { orderId: order.id, creditApplied, primaryCreditApplied, bakeryCreditApplied };
  });

  const openingEntries = ledger.filter(entry => entry.type === 'opening_balance');
  const invoiceEntries = ledger.filter(entry => entry.type === 'invoice');
  const paymentEntries = ledger.filter(entry => entry.type === 'payment');
  const ledgerDerivedBalance = {
    openingBalance: openingEntries.reduce((sum, entry) => sum + amountOrZero(entry.amount), 0),
    invoiced: invoiceEntries.reduce((sum, entry) => sum + amountOrZero(entry.amount), 0),
    payments: paymentEntries.reduce((sum, entry) => sum + amountOrZero(entry.amount), 0),
    rawBalance: 0,
  };
  ledgerDerivedBalance.openingBalance = amountOrZero(ledgerDerivedBalance.openingBalance);
  ledgerDerivedBalance.invoiced = amountOrZero(ledgerDerivedBalance.invoiced);
  ledgerDerivedBalance.payments = amountOrZero(ledgerDerivedBalance.payments);
  ledgerDerivedBalance.rawBalance = amountOrZero(
    ledgerDerivedBalance.openingBalance + ledgerDerivedBalance.invoiced - ledgerDerivedBalance.payments,
  );

  const paymentEntriesById = new Map<string, LedgerTransaction[]>();
  for (const entry of paymentEntries) {
    const paymentId = entry.paymentId?.trim();
    if (!paymentId) {
      addFinding(
        findings,
        'missing-payment-id',
        'blocking',
        'A payment ledger entry has no stable payment identifier.',
        [entry.id],
      );
      continue;
    }
    const entries = paymentEntriesById.get(paymentId) ?? [];
    entries.push(entry);
    paymentEntriesById.set(paymentId, entries);
  }

  for (const [paymentId, entries] of paymentEntriesById) {
    const byInvoice = new Map<string, LedgerTransaction[]>();
    for (const entry of entries) {
      const invoiceKey = entry.invoiceId?.trim() || '__missing-invoice__';
      const sameInvoiceEntries = byInvoice.get(invoiceKey) ?? [];
      sameInvoiceEntries.push(entry);
      byInvoice.set(invoiceKey, sameInvoiceEntries);
    }
    for (const [invoiceId, sameInvoiceEntries] of byInvoice) {
      if (sameInvoiceEntries.length > 1) {
        addFinding(
          findings,
          'duplicate-payment-id',
          'blocking',
          'The same payment identifier is allocated to the same invoice more than once.',
          sameInvoiceEntries.map(entry => entry.id),
          { paymentId, invoiceId: invoiceId === '__missing-invoice__' ? null : invoiceId },
        );
      }
    }
  }

  for (const payment of payments) {
    if (!payment.id?.trim()) {
      addFinding(
        findings,
        'missing-payment-id',
        'blocking',
        'A payment record has no stable payment identifier.',
        [],
      );
      continue;
    }
    const entries = paymentEntriesById.get(payment.id) ?? [];
    const ledgerAmount = amountOrZero(entries.reduce((sum, entry) => sum + amountOrZero(entry.amount), 0));
    const expectedAmount = amountOrZero(payment.amount);
    if (entries.length === 0 || !sameMoney(ledgerAmount, expectedAmount)) {
      addFinding(
        findings,
        'payment-ledger-allocation-mismatch',
        'blocking',
        'Payment amount does not reconcile to its payment-ledger allocations.',
        [payment.id, ...entries.map(entry => entry.id)],
        { paymentId: payment.id, paymentAmount: expectedAmount, ledgerAmount },
      );
    }

    const crossDivisionAmount = amountOrZero(payment.appliedToOtherBill);
    if (crossDivisionAmount > 0 && !payment.otherInvoiceId) {
      addFinding(
        findings,
        'missing-cross-division-counterpart-allocation',
        'blocking',
        'A cross-division payment has no counterpart invoice identifier.',
        [payment.id],
        { paymentId: payment.id, crossDivisionAmount },
      );
    } else if (crossDivisionAmount > 0 && payment.otherInvoiceId) {
      const counterpartAmount = amountOrZero(
        entries
          .filter(entry => entry.invoiceId === payment.otherInvoiceId)
          .reduce((sum, entry) => sum + amountOrZero(entry.appliedAmount ?? entry.amount), 0),
      );
      if (!sameMoney(counterpartAmount, crossDivisionAmount)) {
        addFinding(
          findings,
          'missing-cross-division-counterpart-allocation',
          'blocking',
          'The cross-division counterpart invoice does not have the expected ledger allocation.',
          [payment.id, ...entries.map(entry => entry.id)],
          {
            paymentId: payment.id,
            counterpartInvoiceId: payment.otherInvoiceId,
            expectedAllocation: crossDivisionAmount,
            ledgerAllocation: counterpartAmount,
          },
        );
      }
    }
  }

  const legacyAggregateComparisons: LegacyAggregateComparison[] = [];
  const compareAggregate = (field: string, value: unknown, ledgerValue: number, opening = false): void => {
    const aggregateValue = money(value);
    if (aggregateValue === null) return;
    const comparison = { field, aggregateValue, ledgerValue, matches: sameMoney(aggregateValue, ledgerValue) };
    legacyAggregateComparisons.push(comparison);
    if (!comparison.matches) {
      addFinding(
        findings,
        opening ? 'opening-balance-discrepancy' : 'legacy-aggregate-discrepancy',
        'ambiguity',
        `${field} does not match the corresponding ledger-derived value.`,
        [],
        { field, aggregateValue, ledgerValue },
      );
    }
  };

  compareAggregate('client.rawBalance', input.client.rawBalance, ledgerDerivedBalance.rawBalance);
  compareAggregate('client.credit', input.client.credit, Math.max(0, -ledgerDerivedBalance.rawBalance));
  compareAggregate('client.availableCredit', input.client.availableCredit, Math.max(0, -ledgerDerivedBalance.rawBalance));
  compareAggregate('client.generalCredit', input.client.generalCredit, Math.max(0, -ledgerDerivedBalance.rawBalance));
  compareAggregate('client.openingBalanceAmount', input.client.openingBalanceAmount, ledgerDerivedBalance.openingBalance, true);
  if (input.client.openingBalance) {
    const openingDivision = input.client.openingBalance.division;
    const openingLedger = openingDivision
      ? openingEntries.filter(entry => entry.division === openingDivision).reduce((sum, entry) => sum + amountOrZero(entry.amount), 0)
      : ledgerDerivedBalance.openingBalance;
    compareAggregate('client.openingBalance.amount', input.client.openingBalance.amount, openingLedger, true);
  }
  compareAggregate('client.primaryTotals.openingBalance', input.client.primaryTotals?.openingBalance,
    openingEntries.filter(entry => entry.division === 'primary').reduce((sum, entry) => sum + amountOrZero(entry.amount), 0), true);
  compareAggregate('client.bakeryTotals.openingBalance', input.client.bakeryTotals?.openingBalance,
    openingEntries.filter(entry => entry.division === 'bakery').reduce((sum, entry) => sum + amountOrZero(entry.amount), 0), true);

  const ambiguityFindings = findings.filter(finding => finding.severity === 'ambiguity');
  const blockingFindings = findings.filter(finding => finding.severity === 'blocking');
  return {
    clientId: input.client.id,
    activeOrderCreditFacts,
    ledgerDerivedBalance,
    legacyAggregateComparisons,
    ambiguityFindings,
    blockingFindings,
    proposedSpendableCredit: null,
    sourceFingerprint: fingerprintValue(input),
  };
}
