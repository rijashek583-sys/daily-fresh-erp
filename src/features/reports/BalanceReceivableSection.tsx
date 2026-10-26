import React, { useState, useMemo } from 'react';
import {
  Wallet,
  ChevronDown,
  ChevronUp,
  Search,
  CheckCircle2,
  AlertCircle,
  FileText,
  User,
  Phone,
  MapPin,
  Calendar,
  Layers,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { useDataStore } from '../../stores/dataStore';
import { useDivisionStore } from '../../stores/divisionStore';
import { Card, Badge, Button } from '../../components/ui';
import { formatCurrency, cn } from '../../lib/utils';
import {
  calculateDivisionReceivables,
  type DivisionReceivablesReport,
  type ClientReceivableSummary,
} from '../../lib/receivablesReport';

export default function BalanceReceivableSection() {
  const { clients, orders, payments, ledger, products } = useDataStore();
  const { activeDivision, setDivision } = useDivisionStore();

  // Local filter states for customer drilldown
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null);

  // Compute authoritative receivables report
  const report: DivisionReceivablesReport = useMemo(() => {
    return calculateDivisionReceivables({
      clients,
      orders,
      payments,
      ledger,
      products,
      divisionFilter: activeDivision,
    });
  }, [clients, orders, payments, ledger, products, activeDivision]);

  // Filter clients based on search query
  const displayedClients = useMemo(() => {
    if (!searchQuery.trim()) return report.clientSummaries;
    const q = searchQuery.toLowerCase().trim();
    return report.clientSummaries.filter(
      (c) =>
        c.clientName.toLowerCase().includes(q) ||
        (c.region && c.region.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q))
    );
  }, [report.clientSummaries, searchQuery]);

  const toggleExpand = (clientId: string) => {
    setExpandedClientId((prev) => (prev === clientId ? null : clientId));
  };

  const isReconciled =
    report.primaryReceivablePaise + report.bakeryReceivablePaise === report.allReceivablePaise;

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* ── Section Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[var(--color-primary-bg)] text-[var(--color-primary)] flex items-center justify-center font-bold">
              <Wallet className="w-4 h-4" />
            </div>
            <h2 className="text-lg font-bold text-[var(--color-text-main)]">
              Division-Wise Balance Receivable
            </h2>
            <Badge variant="gray" className="text-[11px] font-semibold bg-gray-50 dark:bg-gray-800">
              Current Outstanding
            </Badge>
          </div>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            Authoritative division receivables calculated across all eligible customer accounts and unpaid invoices.
          </p>
        </div>

        {/* Division Selector Buttons */}
        <div className="inline-flex items-center p-1 bg-gray-100 dark:bg-gray-800/80 rounded-xl border border-gray-200 dark:border-gray-700 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setDivision('all')}
            className={cn(
              'px-3 py-1.5 rounded-lg transition-all',
              activeDivision === 'all'
                ? 'bg-white dark:bg-gray-900 text-[var(--color-text-main)] shadow-sm'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
            )}
          >
            All Divisions
          </button>
          <button
            type="button"
            onClick={() => setDivision('primary')}
            className={cn(
              'px-3 py-1.5 rounded-lg transition-all',
              activeDivision === 'primary'
                ? 'bg-[var(--color-primary)] text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
            )}
          >
            Primary Foods
          </button>
          <button
            type="button"
            onClick={() => setDivision('bakery')}
            className={cn(
              'px-3 py-1.5 rounded-lg transition-all',
              activeDivision === 'bakery'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
            )}
          >
            Bakery Foods
          </button>
        </div>
      </div>

      {/* ── 3 Summary Receivable Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: ALL RECEIVABLES */}
        <div
          onClick={() => setDivision('all')}
          className={cn(
            'p-5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden',
            activeDivision === 'all'
              ? 'bg-gradient-to-br from-red-500/10 via-transparent to-red-500/5 border-[var(--color-primary)] shadow-md ring-1 ring-[var(--color-primary)]/30'
              : 'bg-[var(--color-card)] border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 shadow-sm'
          )}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              ALL RECEIVABLES
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400">
              Total Outstanding
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-[var(--color-text-main)] font-mono">
            {formatCurrency(report.allReceivable)}
          </div>
          <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)] mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
            <span>{report.totalDebtorClientsCount} debtor clients</span>
            <span>{report.totalUnpaidInvoicesCount} unpaid invoices</span>
          </div>
        </div>

        {/* Card 2: PRIMARY FOODS */}
        <div
          onClick={() => setDivision('primary')}
          className={cn(
            'p-5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden',
            activeDivision === 'primary'
              ? 'bg-gradient-to-br from-red-600/10 via-transparent to-red-600/5 border-red-500 shadow-md ring-1 ring-red-500/30'
              : 'bg-[var(--color-card)] border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 shadow-sm'
          )}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
              PRIMARY FOODS
            </span>
            <span className="text-[10px] font-medium text-gray-400">
              Kuboos, Roomali, Wheat Kuboos
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-red-600 dark:text-red-400 font-mono">
            {formatCurrency(report.primaryReceivable)}
          </div>
          <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)] mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
            <span>
              {report.allReceivable > 0
                ? `${Math.round((report.primaryReceivable / report.allReceivable) * 100)}% of total`
                : '0%'}
            </span>
            <span className="text-red-500 font-medium">Primary Division</span>
          </div>
        </div>

        {/* Card 3: BAKERY FOODS */}
        <div
          onClick={() => setDivision('bakery')}
          className={cn(
            'p-5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden',
            activeDivision === 'bakery'
              ? 'bg-gradient-to-br from-amber-600/10 via-transparent to-amber-600/5 border-amber-500 shadow-md ring-1 ring-amber-500/30'
              : 'bg-[var(--color-card)] border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 shadow-sm'
          )}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              BAKERY FOODS
            </span>
            <span className="text-[10px] font-medium text-gray-400">
              Soft Kuboos, Poratta, Buns & others
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-amber-600 dark:text-amber-400 font-mono">
            {formatCurrency(report.bakeryReceivable)}
          </div>
          <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)] mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
            <span>
              {report.allReceivable > 0
                ? `${Math.round((report.bakeryReceivable / report.allReceivable) * 100)}% of total`
                : '0%'}
            </span>
            <span className="text-amber-500 font-medium">Bakery Division</span>
          </div>
        </div>
      </div>

      {/* ── Reconciliation Banner & Advance Isolation Note ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200/80 dark:border-gray-700/80 text-xs">
        <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
          {isReconciled ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
          )}
          <span>
            <strong>Reconciliation Status:</strong>{' '}
            {formatCurrency(report.primaryReceivable)} (Primary) + {formatCurrency(report.bakeryReceivable)} (Bakery) ={' '}
            <strong className="text-[var(--color-text-main)]">{formatCurrency(report.allReceivable)}</strong> (All)
          </span>
        </div>

        {report.totalGeneralCredit > 0 && (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Unapplied Customer Advances: {formatCurrency(report.totalGeneralCredit)} (Kept distinct from invoice dues)</span>
          </div>
        )}
      </div>

      {/* ── Customer-Level Drilldown Section ── */}
      <Card padding={false} className="overflow-hidden border border-gray-200 dark:border-gray-800 shadow-sm">
        <div className="p-4 sm:p-5 border-b border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-gray-50/50 dark:bg-gray-900/50">
          <div>
            <h3 className="text-sm font-bold text-[var(--color-text-main)]">
              Customer Receivables Drilldown
            </h3>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              Showing {displayedClients.length} of {report.clientSummaries.length} client accounts with outstanding balances.
            </p>
          </div>

          {/* Search Input */}
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search client, region, phone..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-colors"
            />
          </div>
        </div>

        {displayedClients.length === 0 ? (
          <div className="p-8 text-center text-xs text-[var(--color-text-muted)]">
            No customer accounts found matching your filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/80 text-gray-500 font-bold uppercase tracking-wider">
                  <th className="py-3 px-4">Client Name</th>
                  <th className="py-3 px-4">Region</th>
                  <th className="py-3 px-4 text-right">Primary Due</th>
                  <th className="py-3 px-4 text-right">Bakery Due</th>
                  <th className="py-3 px-4 text-right">Total Outstanding</th>
                  <th className="py-3 px-4 text-center">Unpaid Invoices</th>
                  <th className="py-3 px-4 text-center">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {displayedClients.map((c) => {
                  const isExpanded = expandedClientId === c.clientId;
                  return (
                    <React.Fragment key={c.clientId}>
                      <tr
                        onClick={() => toggleExpand(c.clientId)}
                        className={cn(
                          'hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer',
                          isExpanded && 'bg-red-50/20 dark:bg-red-950/20'
                        )}
                      >
                        <td className="py-3 px-4 font-semibold text-[var(--color-text-main)]">
                          <div className="flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <span>{c.clientName}</span>
                          </div>
                          {c.phone && (
                            <div className="text-[10px] text-gray-400 font-normal pl-5 flex items-center gap-1 mt-0.5">
                              <Phone className="w-2.5 h-2.5" />
                              {c.phone}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-gray-500">
                          {c.region ? (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-gray-400" />
                              {c.region}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-red-600 dark:text-red-400">
                          {c.primaryReceivable > 0 ? formatCurrency(c.primaryReceivable) : '₹0.00'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-amber-600 dark:text-amber-400">
                          {c.bakeryReceivable > 0 ? formatCurrency(c.bakeryReceivable) : '₹0.00'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-[var(--color-text-main)]">
                          {formatCurrency(c.totalReceivable)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Badge
                            variant={c.unpaidInvoices.length > 0 ? 'warning' : 'gray'}
                            className="text-[10px]"
                          >
                            {c.unpaidInvoices.length} bill{c.unpaidInvoices.length === 1 ? '' : 's'}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            type="button"
                            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-500"
                            aria-label="Toggle invoice details"
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>
                        </td>
                      </tr>

                      {/* Expandable Invoice Breakdown Sub-row */}
                      {isExpanded && (
                        <tr className="bg-gray-50/80 dark:bg-gray-900/60 border-b border-gray-200 dark:border-gray-800">
                          <td colSpan={7} className="p-4 pl-8">
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs font-bold text-gray-600 dark:text-gray-300">
                                <span>Contributing Invoices for {c.clientName}</span>
                                {c.generalCredit > 0 && (
                                  <span className="text-blue-600 font-semibold">
                                    Customer Advance Credit: {formatCurrency(c.generalCredit)}
                                  </span>
                                )}
                              </div>

                              {c.unpaidInvoices.length === 0 ? (
                                <p className="text-xs text-gray-400 italic py-2">
                                  No individual unpaid orders recorded; balance originates from opening balance or legacy ledger entries.
                                </p>
                              ) : (
                                <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800">
                                  <table className="w-full text-left text-[11px] border-collapse">
                                    <thead>
                                      <tr className="bg-gray-100 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300 font-semibold border-b border-gray-200 dark:border-gray-700">
                                        <th className="py-2 px-3">Invoice / Order ID</th>
                                        <th className="py-2 px-3">Delivery Date</th>
                                        <th className="py-2 px-3">Division</th>
                                        <th className="py-2 px-3 text-right">Invoice Total</th>
                                        <th className="py-2 px-3 text-right">Paid / Credit</th>
                                        <th className="py-2 px-3 text-right">Primary Due</th>
                                        <th className="py-2 px-3 text-right">Bakery Due</th>
                                        <th className="py-2 px-3 text-right">Net Due</th>
                                        <th className="py-2 px-3 text-center">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50 font-mono">
                                      {c.unpaidInvoices.map((inv) => (
                                        <tr key={inv.invoiceId} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/30">
                                          <td className="py-2 px-3 font-semibold text-[var(--color-text-main)]">
                                            #{inv.invoiceId.slice(-6)}
                                          </td>
                                          <td className="py-2 px-3 text-gray-500 font-sans">
                                            {inv.deliveryDate}
                                          </td>
                                          <td className="py-2 px-3 font-sans">
                                            <Badge
                                              variant={
                                                inv.division === 'primary'
                                                  ? 'danger'
                                                  : inv.division === 'bakery'
                                                  ? 'warning'
                                                  : 'default'
                                              }
                                              className="text-[9px] uppercase"
                                            >
                                              {inv.division}
                                            </Badge>
                                          </td>
                                          <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-300">
                                            {formatCurrency(inv.orderTotal)}
                                          </td>
                                          <td className="py-2 px-3 text-right text-emerald-600 dark:text-emerald-400">
                                            {formatCurrency(inv.paidAmount + inv.creditApplied)}
                                          </td>
                                          <td className="py-2 px-3 text-right text-red-600 dark:text-red-400 font-semibold">
                                            {inv.primaryDue > 0 ? formatCurrency(inv.primaryDue) : '—'}
                                          </td>
                                          <td className="py-2 px-3 text-right text-amber-600 dark:text-amber-400 font-semibold">
                                            {inv.bakeryDue > 0 ? formatCurrency(inv.bakeryDue) : '—'}
                                          </td>
                                          <td className="py-2 px-3 text-right font-bold text-[var(--color-text-main)]">
                                            {formatCurrency(inv.netDue)}
                                          </td>
                                          <td className="py-2 px-3 text-center font-sans">
                                            <Badge
                                              variant={inv.paymentStatus === 'partial' ? 'warning' : 'danger'}
                                              className="text-[9px]"
                                            >
                                              {inv.paymentStatus}
                                            </Badge>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
