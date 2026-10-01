import { type PaymentMethod, type Payment, type FilterDivision } from '../types';
import { useDataStore } from '../stores/dataStore';
import { format } from 'date-fns';
import { recordPaymentAtomic, updatePayment as dbUpdatePayment } from '../services/db';
import { resolveProductPrice } from './pricing';
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
    // Use the logical date: billDate for invoices, paymentDate for payments.
    const txDate = (l.billDate || l.paymentDate || l.createdAt).substring(0, 10);
    return txDate < deliveryDate;
  });

  const totalDebits = previousEntries.filter(l => l.type === 'invoice').reduce((sum, l) => sum + (l.amount || 0), 0);
  
  const totalCredits = previousEntries.filter(l => l.type === 'payment').reduce((sum, l) => sum + (l.amount || 0), 0);

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
  const { ledger, orders, payments } = useDataStore.getState();
  
  const clientLedger = ledger.filter(l => {
    if (l.clientId !== clientId) return false;
    if (division !== 'all') {
      const entryDiv = l.division;
      if (entryDiv && entryDiv !== 'all' && entryDiv !== division) return false;
    }
    return true;
  });

  if (clientLedger.length > 0) {
    const totalInvoiced = clientLedger.filter(l => l.type === 'invoice').reduce((sum, l) => sum + (l.amount || 0), 0);
    const totalPaid = clientLedger.filter(l => l.type === 'payment').reduce((sum, l) => sum + (l.amount || 0), 0);
    const totalOrders = clientLedger.filter(l => l.type === 'invoice').length;

    return {
      totalInvoiced,
      totalPaid,
      outstanding: totalInvoiced - totalPaid,
      totalOrders
    };
  }

  // Fallback if ledger entries are not yet populated for this client:
  const clientOrders = orders.filter(o => {
    if (o.clientId !== clientId) return false;
    if (division !== 'all') {
      return (o.division as any) === 'all' || !o.division || o.division === division;
    }
    return true;
  });
  const clientPayments = payments.filter(p => {
    if (p.clientId !== clientId || p.deletedAt) return false;
    if (division !== 'all') {
      return (p.division as any) === 'all' || !p.division || p.division === division;
    }
    return true;
  });

  const totalInvoiced = clientOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  const totalPaid = clientPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

  return {
    totalInvoiced,
    totalPaid,
    outstanding: totalInvoiced - totalPaid,
    totalOrders: clientOrders.length
  };
}

export function getClientOutstanding(clientId: string, division: FilterDivision): number {
  return getClientMetrics(clientId, division).outstanding;
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
    paymentsByKey.set(key, existing + (l.amount || 0));
  });

  // Step 3: Build temporary rows per invoice entry
  const clientMap = new Map(clients.map(c => [c.id, c.name]));
  const tempRows: PendingCollectionRow[] = [];
  let totalInvoiced = 0;
  let totalPaid = 0;

  for (const entry of todayInvoiceEntries) {
    const invoiceAmount = entry.amount || 0;
    const pKey = `${entry.invoiceId}:${entry.division || 'all'}`;
    const paidAmount = entry.invoiceId ? (paymentsByKey.get(pKey) || 0) : 0;
    const pendingAmount = invoiceAmount - paidAmount;

    totalInvoiced += invoiceAmount;
    totalPaid += paidAmount;

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


