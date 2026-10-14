import { type PaymentMethod, type Payment, type FilterDivision } from '../types';
import { useDataStore } from '../stores/dataStore';
import { format } from 'date-fns';
import { recordPaymentAtomic, updatePayment as dbUpdatePayment } from '../services/db';
import { getProductDivision } from './utils';
/**
 * Calculates a client's old balance strictly BEFORE the provided date.
 * Old Balance = (Sum of all ledger debits BEFORE date) - (Sum of all ledger credits BEFORE date)
 */
export function calculateOldBalance(clientId: string, deliveryDate: string, division: FilterDivision, excludeInvoiceIds: string[] = []): number {
  const { ledger } = useDataStore.getState();
  
  const previousEntries = ledger.filter(l => {
    if (l.clientId !== clientId) return false;
    if (division !== 'all') {
      // Legacy entries tagged 'all' or with no division are treated as cross-division
      // and included in both primary and bakery balance queries until migration corrects them.
      const entryDiv = l.division;
      if (entryDiv && entryDiv !== 'all' && entryDiv !== division) return false;
    }
    
    // Explicitly exclude any ledger entry (invoice or payment) linked to the current invoices being billed
    if (l.invoiceId && excludeInvoiceIds.includes(l.invoiceId)) return false;

    // Filter out future entries based on deliveryDate.
    // Use the logical date: billDate for invoices/opening_balance, paymentDate for payments.
    const txDate = (l.billDate || l.paymentDate || l.createdAt).substring(0, 10);
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

  return totalDebits - totalCredits;
}

export function calculatePaymentsOnDate(clientId: string, date: string, division: FilterDivision): number {
  const { ledger } = useDataStore.getState();
  
  const dayCredits = ledger.filter(l => 
    l.clientId === clientId && 
    l.type === 'payment' &&
    (division === 'all' || l.division === division) &&
    (l.paymentDate || l.createdAt).substring(0, 10) === date
  );
  return dayCredits.reduce((sum, p) => sum + (p.amount || 0), 0);
}

export function getClientMetrics(clientId: string, division: FilterDivision) {
  const { ledger, orders, payments, clients } = useDataStore.getState();
  
  const allClientLedger = ledger.filter(l => l.clientId === clientId);

  if (allClientLedger.length > 0) {
    const primaryEntries = allClientLedger.filter(l => l.division !== 'bakery');
    const bakeryEntries = allClientLedger.filter(l => l.division === 'bakery');

    const primaryOpening = primaryEntries.filter(l => l.type === 'opening_balance').reduce((sum, l) => sum + (l.amount || 0), 0);
    const primaryInvoiced = primaryEntries.filter(l => l.type === 'invoice').reduce((sum, l) => sum + (l.amount || 0), 0);
    const primaryPaid = primaryEntries.filter(l => l.type === 'payment').reduce((sum, l) => sum + (l.amount || 0), 0);
    const primaryOrders = primaryEntries.filter(l => l.type === 'invoice').length;
    const primaryRawBalance = (primaryOpening + primaryInvoiced) - primaryPaid;
    const primaryOutstanding = Math.max(0, primaryRawBalance);
    const primaryCredit = primaryRawBalance < 0 ? Math.abs(primaryRawBalance) : 0;

    const bakeryOpening = bakeryEntries.filter(l => l.type === 'opening_balance').reduce((sum, l) => sum + (l.amount || 0), 0);
    const bakeryInvoiced = bakeryEntries.filter(l => l.type === 'invoice').reduce((sum, l) => sum + (l.amount || 0), 0);
    const bakeryPaid = bakeryEntries.filter(l => l.type === 'payment').reduce((sum, l) => sum + (l.amount || 0), 0);
    const bakeryOrders = bakeryEntries.filter(l => l.type === 'invoice').length;
    const bakeryRawBalance = (bakeryOpening + bakeryInvoiced) - bakeryPaid;
    const bakeryOutstanding = Math.max(0, bakeryRawBalance);
    const bakeryCredit = bakeryRawBalance < 0 ? Math.abs(bakeryRawBalance) : 0;

    let openingBalance = primaryOpening + bakeryOpening;
    let totalInvoiced = primaryInvoiced + bakeryInvoiced;
    let totalPaid = primaryPaid + bakeryPaid;
    let totalOrders = primaryOrders + bakeryOrders;
    let rawBalance = primaryRawBalance + bakeryRawBalance;
    let outstanding = primaryOutstanding + bakeryOutstanding;
    let credit = primaryCredit + bakeryCredit;

    if (division === 'primary') {
      openingBalance = primaryOpening;
      totalInvoiced = primaryInvoiced;
      totalPaid = primaryPaid;
      totalOrders = primaryOrders;
      rawBalance = primaryRawBalance;
      outstanding = primaryOutstanding;
      credit = primaryCredit;
    } else if (division === 'bakery') {
      openingBalance = bakeryOpening;
      totalInvoiced = bakeryInvoiced;
      totalPaid = bakeryPaid;
      totalOrders = bakeryOrders;
      rawBalance = bakeryRawBalance;
      outstanding = bakeryOutstanding;
      credit = bakeryCredit;
    }

    return {
      openingBalance,
      totalInvoiced,
      totalPaid,
      outstanding,
      rawBalance,
      receivable: outstanding,
      credit,
      totalOrders,
      primaryOutstanding,
      bakeryOutstanding,
      primaryCredit,
      bakeryCredit,
      primaryRawBalance,
      bakeryRawBalance,
    };
  }

  // Fallback if ledger entries are not yet populated for this client:
  const client = clients?.find(c => c.id === clientId);
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

  const primaryRawBalance = (primaryOpening + primaryInvoiced) - primaryPaid;
  const primaryOutstanding = Math.max(0, primaryRawBalance);
  const primaryCredit = primaryRawBalance < 0 ? Math.abs(primaryRawBalance) : 0;

  const bakeryRawBalance = (bakeryOpening + bakeryInvoiced) - bakeryPaid;
  const bakeryOutstanding = Math.max(0, bakeryRawBalance);
  const bakeryCredit = bakeryRawBalance < 0 ? Math.abs(bakeryRawBalance) : 0;

  let openingBalance = primaryOpening + bakeryOpening;
  let totalInvoiced = primaryInvoiced + bakeryInvoiced;
  let totalPaid = primaryPaid + bakeryPaid;
  let totalOrders = clientOrders.length;
  let rawBalance = primaryRawBalance + bakeryRawBalance;
  let outstanding = primaryOutstanding + bakeryOutstanding;
  let credit = primaryCredit + bakeryCredit;

  if (division === 'primary') {
    openingBalance = primaryOpening;
    totalInvoiced = primaryInvoiced;
    totalPaid = primaryPaid;
    totalOrders = primaryOrdersList.length;
    rawBalance = primaryRawBalance;
    outstanding = primaryOutstanding;
    credit = primaryCredit;
  } else if (division === 'bakery') {
    openingBalance = bakeryOpening;
    totalInvoiced = bakeryInvoiced;
    totalPaid = bakeryPaid;
    totalOrders = bakeryOrdersList.length;
    rawBalance = bakeryRawBalance;
    outstanding = bakeryOutstanding;
    credit = bakeryCredit;
  }

  return {
    openingBalance,
    totalInvoiced,
    totalPaid,
    outstanding,
    rawBalance,
    receivable: outstanding,
    credit,
    totalOrders,
    primaryOutstanding,
    bakeryOutstanding,
    primaryCredit,
    bakeryCredit,
    primaryRawBalance,
    bakeryRawBalance,
  };
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
  ledger.forEach(l => {
    if (l.type !== 'payment') return;
    if (!l.invoiceId || !todayInvoiceIds.has(l.invoiceId)) return;
    if (division !== 'all') {
      const entryDiv = l.division;
      if (entryDiv && entryDiv !== 'all' && entryDiv !== division) return;
    }
    
    // Composite key ensures bakery payments strictly subtract from bakery invoices
    const key = `${l.invoiceId}:${l.division || 'all'}`;
    const existing = paymentsByKey.get(key) || 0;
    const applied = l.appliedAmount !== undefined ? l.appliedAmount : (l.amount || 0);
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
    const paidAmount = entry.invoiceId ? (paymentsByKey.get(pKey) || 0) : 0;
    const order = entry.invoiceId ? orders.find(o => o.id === entry.invoiceId) : null;
    const creditApplied = order
      ? (entry.division === 'bakery'
          ? (order.bakeryCreditApplied || 0)
          : entry.division === 'primary'
            ? (order.primaryCreditApplied || 0)
            : (order.creditApplied || 0))
      : 0;

    const pendingAmount = Math.max(0, invoiceAmount - creditApplied - paidAmount);

    totalInvoiced += invoiceAmount;
    totalPaid += (paidAmount + creditApplied);

    // Only keep rows with remaining balance
    if (pendingAmount <= 0) continue;

    const clientName = clientMap.get(entry.clientId) || entry.clientId;
    tempRows.push({
      key: `${entry.clientId}:${entry.division}:${entry.invoiceId || entry.id}`,
      clientId: entry.clientId,
      clientName,
      division: (entry.division || 'all') as 'primary' | 'bakery' | 'multiple',
      invoiceId: entry.invoiceId || entry.id,
      invoiceAmount,
      paidAmount,
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


