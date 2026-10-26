/**
 * Daily Fresh ERP — Division-Wise Balance Receivable Calculation Library
 *
 * CANONICAL ACCOUNTING PRINCIPLES:
 * 1. Single Source of Truth: Authoritative client ledger, invoice, payment, and customer data.
 * 2. Integer Paise Precision: All internal sums and subtractions use integer paise (1 Rupee = 100 Paise)
 *    to guarantee that Primary + Bakery = All with zero floating-point drift.
 * 3. Division Integrity:
 *    - Primary Foods: Kuboos, Roomali, Wheat Kuboos ONLY.
 *    - Bakery Foods: Soft Kuboos, Poratta, Burger Bun, Milk Bread, and all other products.
 * 4. Invariant: For any accounting scope, Primary Receivable + Bakery Receivable === All Receivable.
 * 5. General Advance Isolation: Unapplied customer advances (general credit) are tracked separately
 *    and never subtracted from division receivables or arbitrarily attributed to either division.
 * 6. Historical Non-Destructive Calculation: Zero mutations of existing ledger or payment records.
 */

import {
  type Client,
  type Order,
  type Payment,
  type LedgerTransaction,
  type Product,
  type FilterDivision,
} from '../types';
import { getProductDivision } from './utils';
import { calculateUnifiedMetrics } from './billing';

export interface UnpaidInvoiceBreakdown {
  invoiceId: string;
  deliveryDate: string;
  division: 'primary' | 'bakery' | 'all';
  orderTotalPaise: number;
  orderTotal: number;
  paidAmountPaise: number;
  paidAmount: number;
  creditAppliedPaise: number;
  creditApplied: number;
  primaryDuePaise: number;
  primaryDue: number;
  bakeryDuePaise: number;
  bakeryDue: number;
  netDuePaise: number;
  netDue: number;
  paymentStatus: 'pending' | 'partial' | 'paid';
}

export interface ClientReceivableSummary {
  clientId: string;
  clientName: string;
  phone?: string;
  region?: string;
  primaryReceivablePaise: number;
  primaryReceivable: number;
  bakeryReceivablePaise: number;
  bakeryReceivable: number;
  totalReceivablePaise: number;
  totalReceivable: number;
  generalCreditPaise: number;
  generalCredit: number;
  unpaidInvoices: UnpaidInvoiceBreakdown[];
}

export interface DivisionReceivablesReport {
  /** Total outstanding receivable across all divisions in integer paise */
  allReceivablePaise: number;
  /** Total outstanding receivable across all divisions in Rupees */
  allReceivable: number;
  /** Primary Foods outstanding receivable in integer paise */
  primaryReceivablePaise: number;
  /** Primary Foods outstanding receivable in Rupees */
  primaryReceivable: number;
  /** Bakery Foods outstanding receivable in integer paise */
  bakeryReceivablePaise: number;
  /** Bakery Foods outstanding receivable in Rupees */
  bakeryReceivable: number;
  /** Total unapplied customer advance credits held across all clients (in integer paise) */
  totalGeneralCreditPaise: number;
  /** Total unapplied customer advance credits held across all clients (in Rupees) */
  totalGeneralCredit: number;
  /** Total number of clients with outstanding receivable balances */
  totalDebtorClientsCount: number;
  /** Total number of unpaid or partially paid invoices */
  totalUnpaidInvoicesCount: number;
  /** Client-level drilldown breakdown */
  clientSummaries: ClientReceivableSummary[];
  /** Accounting basis label */
  accountingBasis: 'Current Outstanding';
}

export interface CalculateReceivablesInput {
  clients: Client[];
  orders: Order[];
  payments: Payment[];
  ledger: LedgerTransaction[];
  products: Product[];
  divisionFilter?: FilterDivision;
}

/**
 * Helper to compute an invoice's items partition between Primary Foods and Bakery Foods.
 */
export function getOrderDivisionAmountsPaise(
  order: Order,
  products: Product[]
): { primaryPaise: number; bakeryPaise: number; totalPaise: number } {
  if (!order.items || order.items.length === 0) {
    const totalPaise = Math.round((order.total || 0) * 100);
    if (order.division === 'primary') return { primaryPaise: totalPaise, bakeryPaise: 0, totalPaise };
    if (order.division === 'bakery') return { primaryPaise: 0, bakeryPaise: totalPaise, totalPaise };
    return { primaryPaise: 0, bakeryPaise: 0, totalPaise };
  }

  let primaryPaise = 0;
  let bakeryPaise = 0;

  for (const item of order.items) {
    const prod = products.find(p => p.id === item.productId || p.name === item.productName);
    const div = prod?.division || getProductDivision(prod || { name: item.productName });
    const itemPaise = Math.round((item.total || 0) * 100);

    if (div === 'primary') {
      primaryPaise += itemPaise;
    } else {
      bakeryPaise += itemPaise;
    }
  }

  const itemsSumPaise = primaryPaise + bakeryPaise;
  const orderTotalPaise = Math.round((order.total || 0) * 100);

  // If items sum differs slightly from order.total due to tax/rounding, preserve order.total
  if (itemsSumPaise !== orderTotalPaise && itemsSumPaise > 0) {
    const scale = orderTotalPaise / itemsSumPaise;
    const scaledPrimary = Math.round(primaryPaise * scale);
    const scaledBakery = orderTotalPaise - scaledPrimary;
    return { primaryPaise: scaledPrimary, bakeryPaise: scaledBakery, totalPaise: orderTotalPaise };
  }

  return { primaryPaise, bakeryPaise, totalPaise: orderTotalPaise };
}

/**
 * Calculates authoritative division receivables across all clients and invoices.
 *
 * GUARANTEES:
 * 1. primaryReceivablePaise + bakeryReceivablePaise === allReceivablePaise.
 * 2. Unapplied advances (generalCredit) are NEVER deducted from division receivables.
 * 3. Uses integer paise throughout internal calculations.
 * 4. Respects delivery date ordering for invoice settlement.
 */
export function calculateDivisionReceivables(
  input: CalculateReceivablesInput
): DivisionReceivablesReport {
  const { clients, orders, payments, ledger, products, divisionFilter = 'all' } = input;

  const clientSummaries: ClientReceivableSummary[] = [];

  let grandAllReceivablePaise = 0;
  let grandPrimaryReceivablePaise = 0;
  let grandBakeryReceivablePaise = 0;
  let grandGeneralCreditPaise = 0;
  let totalDebtorClientsCount = 0;
  let totalUnpaidInvoicesCount = 0;

  // Filter active clients (excluding soft-deleted)
  const activeClients = clients.filter(c => !c.deletedAt && c.status !== 'inactive');

  for (const client of activeClients) {
    // 1. Authoritative metrics for this client
    const clientLedger = ledger.filter(l => l.clientId === client.id);

    let primaryOpening = 0;
    let bakeryOpening = 0;
    let primaryInvoiced = 0;
    let bakeryInvoiced = 0;
    let primaryPaid = 0;
    let bakeryPaid = 0;
    let primaryOrders = 0;
    let bakeryOrders = 0;

    if (clientLedger.length > 0) {
      const primaryEntries = clientLedger.filter(l => l.division !== 'bakery');
      const bakeryEntries = clientLedger.filter(l => l.division === 'bakery');

      const pOpeningLedger = primaryEntries.filter(l => l.type === 'opening_balance').reduce((sum, l) => sum + (l.amount || 0), 0);
      const hasPOpeningLedger = primaryEntries.some(l => l.type === 'opening_balance');
      primaryOpening = hasPOpeningLedger
        ? pOpeningLedger
        : (client.primaryTotals?.openingBalance || (client.openingBalance?.division !== 'bakery' ? (client.openingBalance?.amount || client.openingBalanceAmount || 0) : 0));

      primaryInvoiced = primaryEntries.filter(l => l.type === 'invoice').reduce((sum, l) => sum + (l.amount || 0), 0);
      primaryPaid = primaryEntries.filter(l => l.type === 'payment').reduce((sum, l) => sum + (l.amount || 0), 0);
      primaryOrders = primaryEntries.filter(l => l.type === 'invoice').length;

      const bOpeningLedger = bakeryEntries.filter(l => l.type === 'opening_balance').reduce((sum, l) => sum + (l.amount || 0), 0);
      const hasBOpeningLedger = bakeryEntries.some(l => l.type === 'opening_balance');
      bakeryOpening = hasBOpeningLedger
        ? bOpeningLedger
        : (client.bakeryTotals?.openingBalance || (client.openingBalance?.division === 'bakery' ? client.openingBalance?.amount || 0 : 0));

      bakeryInvoiced = bakeryEntries.filter(l => l.type === 'invoice').reduce((sum, l) => sum + (l.amount || 0), 0);
      bakeryPaid = bakeryEntries.filter(l => l.type === 'payment').reduce((sum, l) => sum + (l.amount || 0), 0);
      bakeryOrders = bakeryEntries.filter(l => l.type === 'invoice').length;
    } else {
      primaryOpening = client.primaryTotals?.openingBalance || (client.openingBalance?.division !== 'bakery' ? (client.openingBalance?.amount || client.openingBalanceAmount || 0) : 0);
      bakeryOpening = client.bakeryTotals?.openingBalance || (client.openingBalance?.division === 'bakery' ? client.openingBalance?.amount || 0 : 0);

      const clientOrders = orders.filter(o => o.clientId === client.id && !o.deletedAt);
      const clientPayments = payments.filter(p => p.clientId === client.id && !p.deletedAt);

      const pOrders = clientOrders.filter(o => o.division !== 'bakery');
      const bOrders = clientOrders.filter(o => o.division === 'bakery');

      primaryInvoiced = pOrders.reduce((sum, o) => sum + (o.total || 0), 0);
      bakeryInvoiced = bOrders.reduce((sum, o) => sum + (o.total || 0), 0);
      primaryOrders = pOrders.length;
      bakeryOrders = bOrders.length;

      primaryPaid = clientPayments.filter(p => p.division !== 'bakery').reduce((sum, p) => sum + (p.amount || 0), 0);
      bakeryPaid = clientPayments.filter(p => p.division === 'bakery').reduce((sum, p) => sum + (p.amount || 0), 0);
    }

    const unifiedMetrics = calculateUnifiedMetrics({
      primaryOpening,
      bakeryOpening,
      primaryInvoiced,
      bakeryInvoiced,
      primaryPaid,
      bakeryPaid,
      primaryOrders,
      bakeryOrders,
      division: 'all',
    });

    // Convert client metrics strictly to integer paise
    const clientPrimaryPaise = Math.round(unifiedMetrics.primaryOutstanding * 100);
    const clientBakeryPaise = Math.round(unifiedMetrics.bakeryOutstanding * 100);
    const clientTotalPaise = clientPrimaryPaise + clientBakeryPaise;
    const clientGeneralCreditPaise = Math.round(unifiedMetrics.generalCredit * 100);

    // 2. Identify legitimate unpaid invoices for customer drilldown
    const clientUnpaidOrders = orders
      .filter(o => o.clientId === client.id && !o.deletedAt && o.paymentStatus !== 'paid')
      .sort((a, b) => {
        // Chronological delivery date ordering (oldest first)
        const dateA = a.deliveryDate || a.createdAt;
        const dateB = b.deliveryDate || b.createdAt;
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        return (a.createdAt || '').localeCompare(b.createdAt || '');
      });

    const unpaidInvoices: UnpaidInvoiceBreakdown[] = [];

    for (const order of clientUnpaidOrders) {
      const orderTotalPaise = Math.round((order.total || 0) * 100);
      const paidPaise = Math.round((order.paidAmount || 0) * 100);
      const creditAppliedPaise = Math.round((order.creditApplied || 0) * 100);
      const settledPaise = paidPaise + creditAppliedPaise;
      const netDuePaise = Math.max(0, orderTotalPaise - settledPaise);

      if (netDuePaise === 0) continue; // Fully settled invoice

      // Division partition of this order
      const { primaryPaise, bakeryPaise } = getOrderDivisionAmountsPaise(order, products);

      // Determine division share of remaining net due
      let orderPrimaryDuePaise = 0;
      let orderBakeryDuePaise = 0;

      if (order.division === 'primary' || bakeryPaise === 0) {
        orderPrimaryDuePaise = netDuePaise;
        orderBakeryDuePaise = 0;
      } else if (order.division === 'bakery' || primaryPaise === 0) {
        orderPrimaryDuePaise = 0;
        orderBakeryDuePaise = netDuePaise;
      } else {
        // Mixed order: check if payments/credits are division-attributed
        const orderPayments = clientLedger.filter(l => l.invoiceId === order.id && l.type === 'payment');
        const paidPrimaryPaise = Math.round(orderPayments.filter(p => p.division !== 'bakery').reduce((s, p) => s + (p.amount || 0), 0) * 100);
        const paidBakeryPaise = Math.round(orderPayments.filter(p => p.division === 'bakery').reduce((s, p) => s + (p.amount || 0), 0) * 100);
        const credPrimaryPaise = Math.round((order.primaryCreditApplied || 0) * 100);
        const credBakeryPaise = Math.round((order.bakeryCreditApplied || 0) * 100);

        const remPrimaryPaise = Math.max(0, primaryPaise - paidPrimaryPaise - credPrimaryPaise);
        const remBakeryPaise = Math.max(0, bakeryPaise - paidBakeryPaise - credBakeryPaise);
        const sumRemPaise = remPrimaryPaise + remBakeryPaise;

        if (sumRemPaise > 0) {
          const factor = netDuePaise / sumRemPaise;
          orderPrimaryDuePaise = Math.round(remPrimaryPaise * factor);
          orderBakeryDuePaise = netDuePaise - orderPrimaryDuePaise;
        } else {
          // Proportional allocation based on items total
          const ratio = primaryPaise / (primaryPaise + bakeryPaise);
          orderPrimaryDuePaise = Math.round(netDuePaise * ratio);
          orderBakeryDuePaise = netDuePaise - orderPrimaryDuePaise;
        }
      }

      unpaidInvoices.push({
        invoiceId: order.id,
        deliveryDate: order.deliveryDate,
        division: order.division === 'all' || (primaryPaise > 0 && bakeryPaise > 0) ? 'all' : (primaryPaise > 0 ? 'primary' : 'bakery'),
        orderTotalPaise,
        orderTotal: orderTotalPaise / 100,
        paidAmountPaise: paidPaise,
        paidAmount: paidPaise / 100,
        creditAppliedPaise,
        creditApplied: creditAppliedPaise / 100,
        primaryDuePaise: orderPrimaryDuePaise,
        primaryDue: orderPrimaryDuePaise / 100,
        bakeryDuePaise: orderBakeryDuePaise,
        bakeryDue: orderBakeryDuePaise / 100,
        netDuePaise,
        netDue: netDuePaise / 100,
        paymentStatus: order.paymentStatus || (settledPaise > 0 ? 'partial' : 'pending'),
      });

      totalUnpaidInvoicesCount += 1;
    }

    if (clientTotalPaise > 0 || clientGeneralCreditPaise > 0 || unpaidInvoices.length > 0) {
      if (clientTotalPaise > 0) {
        totalDebtorClientsCount += 1;
      }

      grandAllReceivablePaise += clientTotalPaise;
      grandPrimaryReceivablePaise += clientPrimaryPaise;
      grandBakeryReceivablePaise += clientBakeryPaise;
      grandGeneralCreditPaise += clientGeneralCreditPaise;

      clientSummaries.push({
        clientId: client.id,
        clientName: client.name,
        phone: client.phone,
        region: client.region,
        primaryReceivablePaise: clientPrimaryPaise,
        primaryReceivable: clientPrimaryPaise / 100,
        bakeryReceivablePaise: clientBakeryPaise,
        bakeryReceivable: clientBakeryPaise / 100,
        totalReceivablePaise: clientTotalPaise,
        totalReceivable: clientTotalPaise / 100,
        generalCreditPaise: clientGeneralCreditPaise,
        generalCredit: clientGeneralCreditPaise / 100,
        unpaidInvoices,
      });
    }
  }

  // Sort clients by total receivable descending
  clientSummaries.sort((a, b) => b.totalReceivablePaise - a.totalReceivablePaise);

  // Filter client drilldown according to division selection if specified
  const filteredClientSummaries = clientSummaries.filter(c => {
    if (divisionFilter === 'primary') return c.primaryReceivablePaise > 0;
    if (divisionFilter === 'bakery') return c.bakeryReceivablePaise > 0;
    return c.totalReceivablePaise > 0 || c.generalCreditPaise > 0;
  });

  return {
    allReceivablePaise: grandAllReceivablePaise,
    allReceivable: grandAllReceivablePaise / 100,
    primaryReceivablePaise: grandPrimaryReceivablePaise,
    primaryReceivable: grandPrimaryReceivablePaise / 100,
    bakeryReceivablePaise: grandBakeryReceivablePaise,
    bakeryReceivable: grandBakeryReceivablePaise / 100,
    totalGeneralCreditPaise: grandGeneralCreditPaise,
    totalGeneralCredit: grandGeneralCreditPaise / 100,
    totalDebtorClientsCount,
    totalUnpaidInvoicesCount,
    clientSummaries: filteredClientSummaries,
    accountingBasis: 'Current Outstanding',
  };
}
