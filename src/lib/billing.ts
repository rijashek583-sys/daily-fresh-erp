import { type FilterDivision } from '../types';
import { useDataStore } from '../stores/dataStore';
import { format } from 'date-fns';
import { recordPaymentAtomic, updatePayment as dbUpdatePayment } from '../services/db';
import {
  allocateProportionalPayment,
  allocatePrimaryFirstCredit,
  allocatePrimaryFirstCreditRupees,
  toPaise,
  toRupees,
  type FinancialDivision,
  type InvoiceObligationInput,
  type ProportionalPaymentPolicyInput,
  type ProportionalPaymentPolicyResult,
  type InvoicePaymentAttribution,
  type DeliveryDateAllocationSummary,
} from './proportionalPayment';
/**
 * Safely rounds a number to 2 decimal places to prevent floating-point inaccuracies.
 */
export function round2(val: number): number {
  return Math.round((Number(val || 0) + Number.EPSILON) * 100) / 100;
}

/**
 * Applies a customer's available credit to a new order exactly once.
 *
 * General credit is a single customer-wide balance, not one balance per
 * division. For mixed orders it is consumed in the canonical Primary then
 * Bakery order so the division amounts always reconcile to the total applied.
 */
export function allocateOrderCredit(input: {
  division?: FilterDivision;
  total: number;
  primarySubtotal?: number;
  bakerySubtotal?: number;
  generalCredit?: number;
  primaryCredit?: number;
  bakeryCredit?: number;
  /** Caller input is intentionally ignored; credit is always calculated from the authoritative pool. */
  requestedCreditApplied?: number;
}): { creditApplied: number; primaryCreditApplied: number; bakeryCreditApplied: number } {
  const total = Math.max(0, round2(input.total));
  const primarySubtotal = Math.max(0, round2(input.primarySubtotal || 0));
  const bakerySubtotal = Math.max(0, round2(input.bakerySubtotal || 0));
  const generalCredit = Math.max(0, round2(input.generalCredit || 0));
  const divisionCredit = Math.max(0, round2(input.primaryCredit || 0)) + Math.max(0, round2(input.bakeryCredit || 0));
  let remainingCredit = generalCredit > 0 ? generalCredit : divisionCredit;

  if (input.division === 'bakery') {
    const bakeryCreditApplied = Math.min(remainingCredit, total);
    return { creditApplied: bakeryCreditApplied, primaryCreditApplied: 0, bakeryCreditApplied };
  }

  if (input.division !== 'all') {
    const primaryCreditApplied = Math.min(remainingCredit, total);
    return { creditApplied: primaryCreditApplied, primaryCreditApplied, bakeryCreditApplied: 0 };
  }

  const primaryCreditApplied = Math.min(remainingCredit, primarySubtotal);
  remainingCredit = Math.max(0, round2(remainingCredit - primaryCreditApplied));
  const bakeryCreditApplied = Math.min(remainingCredit, bakerySubtotal);
  return {
    creditApplied: round2(primaryCreditApplied + bakeryCreditApplied),
    primaryCreditApplied,
    bakeryCreditApplied,
  };
}

export interface UnifiedMetricsInput {
  primaryOpening: number;
  bakeryOpening: number;
  primaryInvoiced: number;
  bakeryInvoiced: number;
  primaryPaid: number;
  bakeryPaid: number;
  primaryOrders: number;
  bakeryOrders: number;
  division?: FilterDivision;
}

export interface UnifiedMetricsResult {
  openingBalance: number;
  totalInvoiced: number;
  totalPaid: number;
  outstanding: number;
  rawBalance: number;
  receivable: number;
  credit: number;
  generalCredit: number;
  totalOrders: number;
  primaryOutstanding: number;
  bakeryOutstanding: number;
  primaryCredit: number;
  bakeryCredit: number;
  primaryRawBalance: number;
  bakeryRawBalance: number;
  primaryDebt: number;
  bakeryDebt: number;
  combinedRaw: number;
  combinedOutstanding: number;
}

/**
 * Authoritative customer metrics calculation across Primary and Bakery.
 * Enforces unified customer debtor balance, eliminating inverted credit attribution.
 */
export function calculateUnifiedMetrics(input: UnifiedMetricsInput): UnifiedMetricsResult {
  const pOpening = round2(input.primaryOpening);
  const bOpening = round2(input.bakeryOpening);
  const pInvoiced = round2(input.primaryInvoiced);
  const bInvoiced = round2(input.bakeryInvoiced);
  const pPaid = round2(input.primaryPaid);
  const bPaid = round2(input.bakeryPaid);
  const division = input.division || 'all';

  const primaryRawBalance = round2((pOpening + pInvoiced) - pPaid);
  const bakeryRawBalance = round2((bOpening + bInvoiced) - bPaid);
  const combinedRaw = round2(primaryRawBalance + bakeryRawBalance);

  // Business Rule 8:
  // outstanding = max(0, rawBalance)
  // credit = max(0, -rawBalance)
  const combinedOutstanding = Math.max(0, combinedRaw);
  const generalCredit = Math.max(0, -combinedRaw);

  let effPrimaryOutstanding = 0;
  let effBakeryOutstanding = 0;

  if (combinedRaw > 0) {
    if (primaryRawBalance > 0 && bakeryRawBalance <= 0) {
      effPrimaryOutstanding = combinedRaw;
      effBakeryOutstanding = 0;
    } else if (bakeryRawBalance > 0 && primaryRawBalance <= 0) {
      effPrimaryOutstanding = 0;
      effBakeryOutstanding = combinedRaw;
    } else {
      effPrimaryOutstanding = primaryRawBalance;
      effBakeryOutstanding = bakeryRawBalance;
    }
  } else {
    effPrimaryOutstanding = 0;
    effBakeryOutstanding = 0;
  }

  // Business Rule 6: Never assign surplus credit incorrectly to Primary or Bakery.
  // Any remaining credit must be general customer credit.
  const effPrimaryCredit = 0;
  const effBakeryCredit = 0;

  const totalOpening = round2(pOpening + bOpening);
  const totalInvoiced = round2(pInvoiced + bInvoiced);
  const totalPaid = round2(pPaid + bPaid);
  const totalOrders = input.primaryOrders + input.bakeryOrders;

  let viewOpening = totalOpening;
  let viewInvoiced = totalInvoiced;
  let viewPaid = totalPaid;
  let viewOrders = totalOrders;
  let viewRaw = combinedRaw;
  let viewOutstanding = combinedOutstanding;
  let viewCredit = generalCredit;

  if (division === 'primary') {
    viewOpening = pOpening;
    viewInvoiced = pInvoiced;
    viewPaid = pPaid;
    viewOrders = input.primaryOrders;
    viewRaw = primaryRawBalance;
    viewOutstanding = effPrimaryOutstanding;
    viewCredit = generalCredit;
  } else if (division === 'bakery') {
    viewOpening = bOpening;
    viewInvoiced = bInvoiced;
    viewPaid = bPaid;
    viewOrders = input.bakeryOrders;
    viewRaw = bakeryRawBalance;
    viewOutstanding = effBakeryOutstanding;
    viewCredit = generalCredit;
  }

  return {
    openingBalance: viewOpening,
    totalInvoiced: viewInvoiced,
    totalPaid: viewPaid,
    outstanding: viewOutstanding,
    rawBalance: viewRaw,
    receivable: viewOutstanding,
    credit: viewCredit,
    generalCredit,
    totalOrders: viewOrders,
    primaryOutstanding: effPrimaryOutstanding,
    bakeryOutstanding: effBakeryOutstanding,
    primaryCredit: effPrimaryCredit,
    bakeryCredit: effBakeryCredit,
    primaryRawBalance,
    bakeryRawBalance,
    primaryDebt: effPrimaryOutstanding,
    bakeryDebt: effBakeryOutstanding,
    combinedRaw,
    combinedOutstanding,
  };
}

/**
 * Calculates a client's old balance strictly BEFORE the provided date.
 * Old Balance = (Sum of all ledger debits BEFORE date) - (Sum of all ledger credits BEFORE date)
 */
export function calculateOldBalance(clientId: string, deliveryDate: string, division: FilterDivision, excludeInvoiceIds: string[] = []): number {
  const { ledger, clients } = useDataStore.getState();
  
  const previousEntries = ledger.filter(l => {
    if (l.clientId !== clientId) return false;
    if (division !== 'all') {
      // Attribute unassigned/all legacy entries to 'primary' only to prevent double-counting when summing divisions
      const entryDiv = l.division;
      if (!entryDiv || entryDiv === 'all') {
        if (division !== 'primary') return false;
      } else if (entryDiv !== division) {
        return false;
      }
    }
    
    // Explicitly exclude any ledger entry (invoice or payment) linked to the current invoices being billed
    if (l.invoiceId && excludeInvoiceIds.includes(l.invoiceId)) return false;

    // Filter out future entries based on deliveryDate.
    // Use the logical date: billDate for invoices/opening_balance, paymentDate for payments.
    const txDate = (
      l.type === 'payment'
        ? (l.paymentDate || l.createdAt)
        : (l.billDate || l.createdAt)
    ).substring(0, 10);
    // Opening balance represents balance prior to orders on or after that date
    if (l.type === 'opening_balance') {
      return txDate <= deliveryDate;
    }
    return txDate < deliveryDate;
  });

  const totalDebits = previousEntries
    .filter(l => l.type === 'invoice' || l.type === 'opening_balance')
    .reduce((sum, l) => sum + (l.amount || 0), 0);
  
  const totalCredits = previousEntries
    .filter(l => l.type === 'payment')
    .reduce((sum, l) => sum + (l.amount || 0), 0);

  let balance = round2(totalDebits - totalCredits);

  // Check legacy clients with openingBalance but no opening_balance ledger entry.
  // Do NOT add opening balance if an opening_balance ledger entry already exists for this client and division.
  const hasOpeningLedgerEntry = ledger.some(l => 
    l.clientId === clientId && 
    l.type === 'opening_balance' &&
    (division === 'all' || l.division === division || (division === 'primary' && (!l.division || l.division === 'all')))
  );

  if (!hasOpeningLedgerEntry) {
    const client = clients?.find(c => c.id === clientId);
    if (client) {
      let legacyOpening = 0;
      if (division === 'primary') {
        legacyOpening = client.primaryTotals?.openingBalance || (client.openingBalance?.division !== 'bakery' ? (client.openingBalance?.amount || client.openingBalanceAmount || 0) : 0);
      } else if (division === 'bakery') {
        legacyOpening = client.bakeryTotals?.openingBalance || (client.openingBalance?.division === 'bakery' ? (client.openingBalance?.amount || 0) : 0);
      } else {
        const prim = client.primaryTotals?.openingBalance || (client.openingBalance?.division !== 'bakery' ? (client.openingBalance?.amount || client.openingBalanceAmount || 0) : 0);
        const bak = client.bakeryTotals?.openingBalance || (client.openingBalance?.division === 'bakery' ? (client.openingBalance?.amount || 0) : 0);
        legacyOpening = prim + bak;
      }

      const legacyDate = client.openingBalance?.asOfDate;
      if (legacyOpening > 0 && (!legacyDate || legacyDate <= deliveryDate)) {
        balance = round2(balance + legacyOpening);
      }
    }
  }

  return balance;
}

export function calculatePaymentsOnDate(clientId: string, date: string, division: FilterDivision): number {
  const { ledger } = useDataStore.getState();
  
  const dayCredits = ledger.filter(l => 
    l.clientId === clientId && 
    l.type === 'payment' &&
    (division === 'all' || l.division === division) &&
    (l.paymentDate || l.createdAt).substring(0, 10) === date
  );
  return round2(dayCredits.reduce((sum, p) => sum + (p.amount || 0), 0));
}

export function getClientMetrics(clientId: string, division: FilterDivision) {
  const { ledger, orders, payments, clients } = useDataStore.getState();
  
  const allClientLedger = ledger.filter(l => l.clientId === clientId);
  const client = clients?.find(c => c.id === clientId);

  if (allClientLedger.length > 0) {
    const primaryEntries = allClientLedger.filter(l => l.division !== 'bakery');
    const bakeryEntries = allClientLedger.filter(l => l.division === 'bakery');

    const primaryOpeningLedger = primaryEntries.filter(l => l.type === 'opening_balance').reduce((sum, l) => sum + (l.amount || 0), 0);
    const hasPrimaryOpeningLedger = primaryEntries.some(l => l.type === 'opening_balance');
    const primaryOpening = hasPrimaryOpeningLedger
      ? primaryOpeningLedger
      : (client?.primaryTotals?.openingBalance || (client?.openingBalance?.division !== 'bakery' ? (client?.openingBalance?.amount || client?.openingBalanceAmount || 0) : 0));

    const primaryInvoiced = primaryEntries.filter(l => l.type === 'invoice').reduce((sum, l) => sum + (l.amount || 0), 0);
    const primaryPaid = primaryEntries.filter(l => l.type === 'payment').reduce((sum, l) => sum + (l.amount || 0), 0);
    const primaryOrders = primaryEntries.filter(l => l.type === 'invoice').length;

    const bakeryOpeningLedger = bakeryEntries.filter(l => l.type === 'opening_balance').reduce((sum, l) => sum + (l.amount || 0), 0);
    const hasBakeryOpeningLedger = bakeryEntries.some(l => l.type === 'opening_balance');
    const bakeryOpening = hasBakeryOpeningLedger
      ? bakeryOpeningLedger
      : (client?.bakeryTotals?.openingBalance || (client?.openingBalance?.division === 'bakery' ? client?.openingBalance?.amount || 0 : 0));

    const bakeryInvoiced = bakeryEntries.filter(l => l.type === 'invoice').reduce((sum, l) => sum + (l.amount || 0), 0);
    const bakeryPaid = bakeryEntries.filter(l => l.type === 'payment').reduce((sum, l) => sum + (l.amount || 0), 0);
    const bakeryOrders = bakeryEntries.filter(l => l.type === 'invoice').length;

    return calculateUnifiedMetrics({
      primaryOpening,
      bakeryOpening,
      primaryInvoiced,
      bakeryInvoiced,
      primaryPaid,
      bakeryPaid,
      primaryOrders,
      bakeryOrders,
      division,
    });
  }

  // Fallback if ledger entries are not yet populated for this client:
  const primaryOpening = client?.primaryTotals?.openingBalance || (client?.openingBalance?.division !== 'bakery' ? (client?.openingBalance?.amount || client?.openingBalanceAmount || 0) : 0);
  const bakeryOpening = client?.bakeryTotals?.openingBalance || (client?.openingBalance?.division === 'bakery' ? client?.openingBalance?.amount || 0 : 0);

  const clientOrders = orders.filter(o => o.clientId === clientId);
  const clientPayments = payments.filter(p => p.clientId === clientId && !p.deletedAt);

  const primaryOrdersList = clientOrders.filter(o => o.division !== 'bakery');
  const bakeryOrdersList = clientOrders.filter(o => o.division === 'bakery');

  const primaryInvoiced = primaryOrdersList.reduce((sum, o) => sum + (o.total || 0), 0);
  const bakeryInvoiced = bakeryOrdersList.reduce((sum, o) => sum + (o.total || 0), 0);

  const primaryPaymentsList = clientPayments.filter(p => p.division !== 'bakery');
  const bakeryPaymentsList = clientPayments.filter(p => p.division === 'bakery');

  const primaryPaid = primaryPaymentsList.reduce((sum, p) => sum + (p.amount || 0), 0);
  const bakeryPaid = bakeryPaymentsList.reduce((sum, p) => sum + (p.amount || 0), 0);

  return calculateUnifiedMetrics({
    primaryOpening,
    bakeryOpening,
    primaryInvoiced,
    bakeryInvoiced,
    primaryPaid,
    bakeryPaid,
    primaryOrders: primaryOrdersList.length,
    bakeryOrders: bakeryOrdersList.length,
    division,
  });
}

export function getClientOutstanding(clientId: string, division: FilterDivision): number {
  return getClientMetrics(clientId, division).outstanding;
}

export function getClientReceivable(clientId: string, division: FilterDivision): number {
  return getClientMetrics(clientId, division).outstanding;
}

export function getClientCredit(clientId: string, division: FilterDivision): number {
  return getClientMetrics(clientId, division).credit;
}

export function getClientRawBalance(clientId: string, division: FilterDivision): number {
  return getClientMetrics(clientId, division).rawBalance;
}

export async function recordPayment(paymentData: any) {
  await recordPaymentAtomic(paymentData);
}

export async function updatePayment(paymentId: string, updates: any) {
  await dbUpdatePayment(paymentId, updates);
}

export function getPaymentUpdateInfo(clientId: string, date: string, division: FilterDivision) {
  const { payments } = useDataStore.getState();
  
  // Find a payment created/billed on this date
  const payment = payments.find(p => p.clientId === clientId && (division === 'all' || p.division === division) && (p.billDate === date || p.createdAt.split('T')[0] === date) && !p.deletedAt);
  if (payment && payment.updatedBy) {
    return `Updated by ${payment.updatedBy} on ${format(new Date(payment.createdAt), 'MMM d')}`;
  }
  return null;
}

export interface PendingCollectionRow {
  /** Unique key: clientId + ':' + division + ':' + invoiceId */
  key: string;
  clientId: string;
  clientName: string;
  division: 'primary' | 'bakery' | 'multiple';
  invoiceId: string;
  invoiceAmount: number;
  paidAmount: number;
  pendingAmount: number;
}

/**
 * Returns pending collection rows for today only.
 *
 * Algorithm:
 *  1. Find all ledger invoice entries where billDate === todayStr and division matches.
 *  2. For each such entry, sum all ledger payment entries that share the same invoiceId
 *     and the same division (to avoid cross-division payment double-counting).
 *  3. pendingAmount = invoiceAmount - paidAmount.
 *  4. Only rows where pendingAmount > 0 are returned.
 *  5. Rows are sorted by pendingAmount descending.
 *
 * Previous balances are NEVER included — only today's invoice entries are the starting point.
 * Multiple invoices for the same client on the same day each appear as separate rows.
 * Multiple payments on the same invoice are all summed against that invoice row.
 */
export function getPendingCollections(
  division: FilterDivision,
  dateStr: string,
  clients: { id: string; name: string }[]
): { rows: PendingCollectionRow[]; totalPending: number; totalInvoiced: number; totalPaid: number } {
  const { ledger } = useDataStore.getState();

  // Step 1: Find today's invoice ledger entries filtered by division
  const todayInvoiceEntries = ledger.filter(l => {
    if (l.type !== 'invoice') return false;
    const entryBillDate = (l.billDate || l.createdAt || '').substring(0, 10);
    if (entryBillDate !== dateStr) return false;
    if (division !== 'all') {
      const entryDiv = l.division;
      if (entryDiv && entryDiv !== 'all' && entryDiv !== division) return false;
    }
    return true;
  });

  if (todayInvoiceEntries.length === 0) {
    return { rows: [], totalPending: 0, totalInvoiced: 0, totalPaid: 0 };
  }

  // Step 2: Build a map of invoiceId:division → total payments
  // Only count payment entries whose invoiceId is in today's invoice set
  const todayInvoiceIds = new Set(todayInvoiceEntries.map(l => l.invoiceId).filter(Boolean));

  const paymentsByKey = new Map<string, number>();
  const paymentsByInvoiceId = new Map<string, number>();

  ledger.forEach(l => {
    if (l.type !== 'payment') return;
    if (!l.invoiceId || !todayInvoiceIds.has(l.invoiceId)) return;
    const applied = l.appliedAmount !== undefined ? l.appliedAmount : (l.amount || 0);

    paymentsByInvoiceId.set(l.invoiceId, (paymentsByInvoiceId.get(l.invoiceId) || 0) + applied);

    if (division !== 'all') {
      const entryDiv = l.division;
      if (entryDiv && entryDiv !== 'all' && entryDiv !== division) return;
    }
    
    // Composite key ensures bakery payments strictly subtract from bakery invoices
    const key = `${l.invoiceId}:${l.division || 'all'}`;
    const existing = paymentsByKey.get(key) || 0;
    paymentsByKey.set(key, existing + applied);
  });

  // Step 3: Build temporary rows per invoice entry
  const { orders } = useDataStore.getState();
  const clientMap = new Map(clients.map(c => [c.id, c.name]));
  const tempRows: PendingCollectionRow[] = [];
  let totalInvoiced = 0;
  let totalPaid = 0;

  for (const entry of todayInvoiceEntries) {
    const invoiceAmount = entry.amount || 0;
    const pKey = `${entry.invoiceId}:${entry.division || 'all'}`;
    const order = entry.invoiceId ? orders.find(o => o.id === entry.invoiceId) : null;

    let paidAmount = entry.invoiceId ? (paymentsByKey.get(pKey) || 0) : 0;
    if (division === 'all' && entry.invoiceId && paidAmount === 0) {
      paidAmount = paymentsByInvoiceId.get(entry.invoiceId) || 0;
    }

    const isOrderFullyPaid = order?.paymentStatus === 'paid' && (division === 'all' || order?.division === division);
    const effectivePaid = isOrderFullyPaid
      ? invoiceAmount
      : Math.max(paidAmount, (division === 'all' || order?.division === division) ? (order?.paidAmount || 0) : paidAmount);

    const creditApplied = order
      ? (entry.division === 'bakery'
          ? (order.bakeryCreditApplied || 0)
          : entry.division === 'primary'
            ? (order.primaryCreditApplied || 0)
            : (order.creditApplied || ((order.primaryCreditApplied || 0) + (order.bakeryCreditApplied || 0)) || 0))
      : 0;

    const pendingAmount = isOrderFullyPaid ? 0 : Math.max(0, invoiceAmount - creditApplied - effectivePaid);

    totalInvoiced += invoiceAmount;
    totalPaid += (effectivePaid + creditApplied);

    // Only keep rows with remaining balance
    if (pendingAmount <= 0.01) continue;

    const clientName = clientMap.get(entry.clientId) || entry.clientId;
    tempRows.push({
      key: `${entry.clientId}:${entry.division}:${entry.invoiceId || entry.id}`,
      clientId: entry.clientId,
      clientName,
      division: (entry.division || 'all') as 'primary' | 'bakery' | 'multiple',
      invoiceId: entry.invoiceId || entry.id,
      invoiceAmount,
      paidAmount: effectivePaid,
      pendingAmount,
    });
  }

  // Step 4: Group rows by client if viewing "All" division
  let finalRows = tempRows;
  if (division === 'all') {
    const grouped = new Map<string, PendingCollectionRow>();
    for (const row of tempRows) {
      const existing = grouped.get(row.clientId);
      if (existing) {
        existing.invoiceAmount += row.invoiceAmount;
        existing.paidAmount += row.paidAmount;
        existing.pendingAmount += row.pendingAmount;
        if (existing.division !== row.division) {
           existing.division = 'multiple';
        }
      } else {
        grouped.set(row.clientId, { ...row, key: row.clientId });
      }
    }
    finalRows = Array.from(grouped.values());
  }

  finalRows.sort((a, b) => b.pendingAmount - a.pendingAmount);
  const totalPending = finalRows.reduce((s, r) => s + r.pendingAmount, 0);

  return { rows: finalRows, totalPending, totalInvoiced, totalPaid };
}

export interface PaymentAllocationInput {
  paymentAmount: number;
  /** Net remaining amount due on the specific bill/invoice in the target division (0 if paying on account) */
  orderRemaining?: number;
  /** Net remaining amount due on the other division's bill/invoice on the same bill (0 if single division) */
  otherOrderRemaining?: number;
  /** Total client outstanding balance across ALL divisions before this payment */
  clientTotalOutstanding: number;
  /** Outstanding balance in the specific division of this bill before this payment */
  billDivisionOutstanding?: number;
  /** Outstanding balance in the other division before this payment */
  otherDivisionOutstanding?: number;
  /** Prior debt in the same division (excluding today's orderRemaining) */
  billDivisionPrior?: number;
  /** Prior debt in the other division (excluding today's otherOrderRemaining) */
  otherDivisionPrior?: number;
  /** Optional list of granular unpaid obligations */
  obligations?: readonly import('./proportionalPayment').InvoiceObligationInput[];
  /** Optional selected delivery date */
  selectedDeliveryDate?: string | null;
  /** Optional client ID */
  clientId?: string;
  /** Division perspective of the payment (defaults to 'primary') */
  division?: FinancialDivision;
  /** Whether the payment is for a direct sale */
  isDirectSale?: boolean;
}

export interface PaymentAllocationResult {
  /** Amount applied to the specific bill/invoice in the target division */
  appliedToBill: number;
  /** Amount applied to the other division's bill/invoice on the same bill */
  appliedToOtherBill: number;
  /** Total amount applied across both divisions to today's bill (appliedToBill + appliedToOtherBill) */
  totalAppliedToBill: number;
  /** Amount allocated to previous outstanding balance in the SAME division */
  appliedToSameDivisionPrevious: number;
  /** Amount allocated to outstanding balance in the OTHER division */
  appliedToOtherDivisionPrevious: number;
  /** Total amount applied to previous balance across both divisions (same + other) */
  appliedToPrevious: number;
  /** Total amount applied toward the customer's debt (totalAppliedToBill + appliedToPrevious) */
  totalApplied: number;
  /** True advance credit created (only when payment exceeds entire customer debt across both divisions) */
  excessCredit: number;
  /** Alias for excessCredit representing unified customer general credit */
  generalCredit: number;
  /** True if payment is an advance with no debt to settle */
  isAdvance: boolean;
  /** Remaining amount due on this specific bill in the target division */
  remainingBill: number;
  /** Remaining amount due on other division's bill */
  remainingOtherBill: number;
  /** Remaining total bill across both divisions */
  remainingTotalBill: number;
  /** Remaining previous outstanding balance across both divisions */
  remainingPrevious: number;
  /** Remaining previous debt in the same division */
  remainingSameDivisionPrevious: number;
  /** Remaining debt in the other division */
  remainingOtherDivision: number;
  /** Remaining total client outstanding balance after this payment */
  remainingTotalOutstanding: number;
}

/**
 * Computes exact payment allocation between a specific bill/order and previous outstanding balance.
 *
 * APPROVED PROPORTIONAL PAYMENT POLICY & CANONICAL ALLOCATION ORDER:
 * 1. Settle the current bill proportionally across Primary Foods and Bakery Foods based on division dues.
 * 2. Apply any remaining payment to previous outstanding balances proportionally across divisions.
 * 3. Only the amount remaining after all applicable debt is settled becomes customer advance credit.
 */
export function allocatePayment(input: PaymentAllocationInput): PaymentAllocationResult {
  const { paymentAmount, isDirectSale } = input;
  const amount = Math.max(0, round2(Number(paymentAmount) || 0));

  // If detailed obligations are supplied, delegate directly to the pure proportional payment engine
  if (input.obligations && input.obligations.length > 0) {
    const prop = allocateProportionalPayment({
      clientId: input.clientId || '',
      paymentAmount: amount,
      selectedDeliveryDate: input.selectedDeliveryDate,
      obligations: input.obligations,
      isDirectSale,
    });

    return {
      appliedToBill: prop.appliedToBill,
      appliedToOtherBill: prop.appliedToOtherBill,
      totalAppliedToBill: prop.totalAppliedToBill,
      appliedToSameDivisionPrevious: prop.appliedToSameDivisionPrevious,
      appliedToOtherDivisionPrevious: prop.appliedToOtherDivisionPrevious,
      appliedToPrevious: prop.appliedToPrevious,
      totalApplied: prop.totalAllocated,
      excessCredit: prop.excessCredit,
      generalCredit: prop.excessCredit,
      isAdvance: prop.isAdvance,
      remainingBill: prop.remainingBill,
      remainingOtherBill: prop.remainingOtherBill,
      remainingTotalBill: prop.remainingTotalBill,
      remainingPrevious: prop.remainingPrevious,
      remainingSameDivisionPrevious: prop.appliedToSameDivisionPrevious,
      remainingOtherDivision: prop.appliedToOtherDivisionPrevious,
      remainingTotalOutstanding: prop.remainingTotalOutstanding,
    };
  }

  const isBakeryDivision = input.division === 'bakery';
  const orderRemaining = Math.max(0, round2(Number(input.orderRemaining) || 0));
  const otherOrderRemaining = Math.max(0, round2(Number(input.otherOrderRemaining) || 0));
  const totalBill = round2(orderRemaining + otherOrderRemaining);

  const primaryBillDue = isBakeryDivision ? otherOrderRemaining : orderRemaining;
  const bakeryBillDue = isBakeryDivision ? orderRemaining : otherOrderRemaining;

  if (isDirectSale) {
    const appliedToBillGroup = Math.min(amount, totalBill);
    let primaryBillShare = 0;
    let bakeryBillShare = 0;

    if (totalBill > 0 && appliedToBillGroup > 0) {
      const groupPaise = toPaise(appliedToBillGroup);
      const pPaise = toPaise(primaryBillDue);
      const bPaise = toPaise(bakeryBillDue);
      const billPaise = pPaise + bPaise;

      let pShare = Math.floor((groupPaise * pPaise) / billPaise);
      let bShare = Math.floor((groupPaise * bPaise) / billPaise);
      const rem = groupPaise - (pShare + bShare);
      if (rem > 0) {
        if ((groupPaise * pPaise) % billPaise >= (groupPaise * bPaise) % billPaise) {
          pShare += rem;
        } else {
          bShare += rem;
        }
      }
      primaryBillShare = toRupees(pShare);
      bakeryBillShare = toRupees(bShare);
    }

    const appliedToBill = isBakeryDivision ? bakeryBillShare : primaryBillShare;
    const appliedToOtherBill = isBakeryDivision ? primaryBillShare : bakeryBillShare;
    const totalAppliedToBill = round2(appliedToBill + appliedToOtherBill);
    const remBill = Math.max(0, round2(orderRemaining - appliedToBill));
    const remOtherBill = Math.max(0, round2(otherOrderRemaining - appliedToOtherBill));
    const remTotalBill = round2(remBill + remOtherBill);

    return {
      appliedToBill,
      appliedToOtherBill,
      totalAppliedToBill,
      appliedToSameDivisionPrevious: 0,
      appliedToOtherDivisionPrevious: 0,
      appliedToPrevious: 0,
      totalApplied: totalAppliedToBill,
      excessCredit: 0,
      generalCredit: 0,
      isAdvance: false,
      remainingBill: remBill,
      remainingOtherBill: remOtherBill,
      remainingTotalBill: remTotalBill,
      remainingPrevious: 0,
      remainingSameDivisionPrevious: 0,
      remainingOtherDivision: 0,
      remainingTotalOutstanding: remTotalBill,
    };
  }

  const clientTotal = Math.max(0, round2(Number(input.clientTotalOutstanding) || 0));

  // Determine prior debts (excluding today's bills)
  let sameDivisionPrior = 0;
  let otherDivisionPrior = 0;

  if (input.billDivisionPrior !== undefined) {
    sameDivisionPrior = Math.max(0, round2(Number(input.billDivisionPrior) || 0));
  } else if (input.billDivisionOutstanding !== undefined) {
    const billDivOut = Math.max(0, round2(Number(input.billDivisionOutstanding) || 0));
    sameDivisionPrior = Math.max(0, round2(billDivOut - orderRemaining));
  } else {
    sameDivisionPrior = Math.max(0, round2(clientTotal - orderRemaining - otherOrderRemaining));
  }

  if (input.otherDivisionPrior !== undefined) {
    otherDivisionPrior = Math.max(0, round2(Number(input.otherDivisionPrior) || 0));
  } else if (input.otherDivisionOutstanding !== undefined) {
    const otherDivOut = Math.max(0, round2(Number(input.otherDivisionOutstanding) || 0));
    otherDivisionPrior = Math.max(0, round2(otherDivOut - otherOrderRemaining));
  } else {
    otherDivisionPrior = 0;
  }

  // ── CANONICAL PROPORTIONAL ALLOCATION ORDER ──
  // Stage 1: Settle the current bill proportionally across Primary Foods and Bakery Foods
  const appliedToBillGroup = Math.min(amount, totalBill);
  let primaryBillShare = 0;
  let bakeryBillShare = 0;

  if (totalBill > 0 && appliedToBillGroup > 0) {
    const groupPaise = toPaise(appliedToBillGroup);
    const pPaise = toPaise(primaryBillDue);
    const bPaise = toPaise(bakeryBillDue);
    const billPaise = pPaise + bPaise;

    let pShare = Math.floor((groupPaise * pPaise) / billPaise);
    let bShare = Math.floor((groupPaise * bPaise) / billPaise);
    const rem = groupPaise - (pShare + bShare);
    if (rem > 0) {
      if ((groupPaise * pPaise) % billPaise >= (groupPaise * bPaise) % billPaise) {
        pShare += rem;
      } else {
        bShare += rem;
      }
    }
    primaryBillShare = toRupees(pShare);
    bakeryBillShare = toRupees(bShare);
  }

  const appliedToBill = isBakeryDivision ? bakeryBillShare : primaryBillShare;
  const appliedToOtherBill = isBakeryDivision ? primaryBillShare : bakeryBillShare;
  const totalAppliedToBill = round2(appliedToBill + appliedToOtherBill);
  const remainingBill = Math.max(0, round2(orderRemaining - appliedToBill));
  const remainingOtherBill = Math.max(0, round2(otherOrderRemaining - appliedToOtherBill));
  const remainingTotalBill = round2(remainingBill + remainingOtherBill);

  // Stage 2: Apply any remaining payment to previous outstanding balances proportionally across divisions
  const excessAfterBill = Math.max(0, round2(amount - totalAppliedToBill));
  const totalPrior = round2(sameDivisionPrior + otherDivisionPrior);
  const appliedToPriorGroup = Math.min(excessAfterBill, totalPrior);

  const primaryPriorDue = isBakeryDivision ? otherDivisionPrior : sameDivisionPrior;
  const bakeryPriorDue = isBakeryDivision ? sameDivisionPrior : otherDivisionPrior;
  let primaryPriorShare = 0;
  let bakeryPriorShare = 0;

  if (totalPrior > 0 && appliedToPriorGroup > 0) {
    const groupPaise = toPaise(appliedToPriorGroup);
    const pPriorPaise = toPaise(primaryPriorDue);
    const bPriorPaise = toPaise(bakeryPriorDue);
    const priorPaise = pPriorPaise + bPriorPaise;

    let pShare = Math.floor((groupPaise * pPriorPaise) / priorPaise);
    let bShare = Math.floor((groupPaise * bPriorPaise) / priorPaise);
    const rem = groupPaise - (pShare + bShare);
    if (rem > 0) {
      if ((groupPaise * pPriorPaise) % priorPaise >= (groupPaise * bPriorPaise) % priorPaise) {
        pShare += rem;
      } else {
        bShare += rem;
      }
    }
    primaryPriorShare = toRupees(pShare);
    bakeryPriorShare = toRupees(bShare);
  }

  const appliedToSameDivisionPrevious = isBakeryDivision ? bakeryPriorShare : primaryPriorShare;
  const appliedToOtherDivisionPrevious = isBakeryDivision ? primaryPriorShare : bakeryPriorShare;
  const appliedToPrevious = round2(appliedToSameDivisionPrevious + appliedToOtherDivisionPrevious);
  const remainingSameDivisionPrevious = Math.max(0, round2(sameDivisionPrior - appliedToSameDivisionPrevious));
  const remainingOtherDivision = Math.max(0, round2(otherDivisionPrior - appliedToOtherDivisionPrevious));
  const remainingPrevious = round2(remainingSameDivisionPrevious + remainingOtherDivision);

  // Stage 3: Only the amount remaining after all applicable debt is settled becomes customer advance credit
  const excessAfterPrior = Math.max(0, round2(excessAfterBill - appliedToPrevious));
  const excessCredit = excessAfterPrior;
  const totalApplied = round2(totalAppliedToBill + appliedToPrevious);
  const remainingTotalOutstanding = round2(remainingTotalBill + remainingPrevious);

  const isAdvance = totalApplied === 0 && excessCredit > 0;

  return {
    appliedToBill,
    appliedToOtherBill,
    totalAppliedToBill,
    appliedToSameDivisionPrevious,
    appliedToOtherDivisionPrevious,
    appliedToPrevious,
    totalApplied,
    excessCredit,
    generalCredit: excessCredit,
    isAdvance,
    remainingBill,
    remainingOtherBill,
    remainingTotalBill,
    remainingPrevious,
    remainingSameDivisionPrevious,
    remainingOtherDivision,
    remainingTotalOutstanding,
  };
}

export {
  allocateProportionalPayment,
  allocatePrimaryFirstCredit,
  allocatePrimaryFirstCreditRupees,
  toPaise,
  toRupees,
} from './proportionalPayment';
export type {
  InvoiceObligationInput,
  ProportionalPaymentPolicyInput,
  ProportionalPaymentPolicyResult,
  InvoicePaymentAttribution,
  DeliveryDateAllocationSummary,
} from './proportionalPayment';



