import React, { useState, useEffect, useMemo } from 'react';
import {
  Download, Filter, Calendar, IndianRupee, PieChart,
  Users, Fuel, ShieldCheck, RefreshCw, AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { type AppUser } from '../../types/auth.types';
import {
  type ExpenseDocument,
  type ExpenseSummaryReport,
  type ExpenseDatePreset,
} from '../../types/expense.types';
import { getExpensesByBusinessDayRange, calculateExpenseSummary } from '../../services/expenseDb';
import { getBusinessDayDateRange, formatBusinessDayDisplay } from '../../lib/businessDay';
import { Button, Card, Badge, StatCard } from '../../components/ui';
import { downloadExpensesCsv } from '../../lib/csvExport';
import { formatCurrency } from '../../lib/utils';

interface ExpenseReportsTabProps {
  currentUser: AppUser;
}

export default function ExpenseReportsTab({ currentUser }: ExpenseReportsTabProps) {
  const isAdmin = currentUser.role === 'admin';

  // Range and filter states
  const [preset, setPreset] = useState<ExpenseDatePreset>('this_month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [expenses, setExpenses] = useState<ExpenseDocument[]>([]);

  // Compute active business-day date boundaries
  const dateRange = useMemo(() => {
    return getBusinessDayDateRange(preset, customFrom, customTo);
  }, [preset, customFrom, customTo]);

  // Load data whenever date boundaries change
  const fetchExpenses = async () => {
    setLoading(true);
    try {
      const records = await getExpensesByBusinessDayRange(
        dateRange.fromBusinessDay,
        dateRange.toBusinessDay,
        currentUser
      );
      setExpenses(records);
    } catch (err: any) {
      console.error('Failed to load expenses for report:', err);
      toast.error('Failed to load expense report: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExpenses();
  }, [dateRange.fromBusinessDay, dateRange.toBusinessDay]);

  // Calculate summary report
  const summary: ExpenseSummaryReport = useMemo(() => {
    return calculateExpenseSummary(
      expenses,
      dateRange.fromBusinessDay,
      dateRange.toBusinessDay,
      dateRange.label
    );
  }, [expenses, dateRange]);

  // Top category calculation
  const topCategory = useMemo(() => {
    if (!summary.categories || summary.categories.length === 0) return null;
    const sorted = [...summary.categories].sort((a, b) => b.totalAmount - a.totalAmount);
    return sorted[0].totalAmount > 0 ? sorted[0] : null;
  }, [summary.categories]);

  // CSV Export handler (Feature 3B)
  const handleExportCsv = () => {
    if (expenses.length === 0) {
      toast.info('No expenses to export for the selected date range.');
      return;
    }

    const dateLabel = `${dateRange.fromBusinessDay}_to_${dateRange.toBusinessDay}`;
    const result = downloadExpensesCsv(expenses, {
      isAdmin,
      dateLabel,
      categoryFilter: 'all',
      includeVoided: false, // Report tab shows active analytics
      filePrefix: 'Expenses_Report',
    });

    toast.success(
      `Exported ${result.totalRecords} expense records. Active Total: ${formatCurrency(result.activeTotalAmount)}.`
    );
  };

  return (
    <div className="space-y-6" id="expense-reports-tab">
      {/* Date Range Selector Header */}
      <Card className="p-4 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-[var(--color-text-main)] flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[var(--color-primary)]" />
              Expense Period & Range
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Filtered by business-day timestamps (2:00 AM IST cutoff)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(['today', 'yesterday', 'this_week', 'this_month', 'custom'] as ExpenseDatePreset[]).map((p) => {
              const labels: Record<ExpenseDatePreset, string> = {
                today: 'Today',
                yesterday: 'Yesterday',
                last7: 'Last 7 Days',
                this_week: 'This Week',
                this_month: 'This Month',
                all: 'All Time',
                custom: 'Custom Range',
              };
              const isSelected = preset === p;

              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPreset(p)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--color-primary)] text-white shadow-sm shadow-red-900/20'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                  id={`preset-${p}`}
                >
                  {labels[p]}
                </button>
              );
            })}

            <Button
              variant="outline"
              size="sm"
              onClick={fetchExpenses}
              disabled={loading}
              icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
              id="refresh-expense-report-button"
            >
              Refresh
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={handleExportCsv}
              disabled={loading || expenses.length === 0}
              icon={<Download className="w-3.5 h-3.5" />}
              id="export-expense-csv-button"
            >
              Export CSV
            </Button>
          </div>
        </div>

        {/* Custom Range Inputs */}
        {preset === 'custom' && (
          <div className="mt-4 pt-4 border-t border-black/[0.04] dark:border-white/[0.04] flex flex-wrap items-center gap-3 animate-in fade-in duration-200">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500">From (Business Day):</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)]"
                id="expense-report-custom-from"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500">To (Business Day):</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)]"
                id="expense-report-custom-to"
              />
            </div>
          </div>
        )}
      </Card>

      {/* Mandatory Non-Interference Guarantee Notice */}
      <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-800/40 flex items-start gap-3">
        <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        <div className="text-xs text-emerald-900 dark:text-emerald-200 leading-relaxed font-medium">
          <span className="font-bold">Strict Financial Isolation:</span> Expense totals are strictly operational metrics.
          They are completely isolated from client outstanding balances, payments, cash registers, billing, and customer ledgers.
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          id="stat-total-expenses"
          label="Total Expenses"
          value={`₹${summary.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={<IndianRupee className="w-5 h-5 text-red-600" />}
          iconBg="bg-red-50 dark:bg-red-950/30"
          subtitle={summary.dateRangeLabel}
        />
        <StatCard
          id="stat-expense-entries"
          label="Total Entries"
          value={`${summary.totalCount}`}
          icon={<Filter className="w-5 h-5 text-blue-600" />}
          iconBg="bg-blue-50 dark:bg-blue-950/30"
          subtitle="Recorded transactions"
        />
        <StatCard
          id="stat-average-expense"
          label="Average Per Entry"
          value={`₹${(summary.totalCount > 0 ? summary.totalAmount / summary.totalCount : 0).toFixed(2)}`}
          icon={<PieChart className="w-5 h-5 text-emerald-600" />}
          iconBg="bg-emerald-50 dark:bg-emerald-950/30"
          subtitle="Average ticket size"
        />
        <StatCard
          id="stat-top-category"
          label="Top Category"
          value={topCategory ? topCategory.category : 'None'}
          icon={<Fuel className="w-5 h-5 text-amber-600" />}
          iconBg="bg-amber-50 dark:bg-amber-950/30"
          subtitle={topCategory ? `₹${topCategory.totalAmount.toFixed(2)} (${topCategory.percentage}%)` : 'No expenses recorded'}
        />
      </div>

      {/* Category Breakdown & Custom Other Expense Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Breakdown */}
        <Card className="p-6">
          <h4 className="text-sm font-bold text-[var(--color-text-main)] uppercase tracking-wider mb-4 flex items-center gap-2">
            <PieChart className="w-4 h-4 text-[var(--color-primary)]" />
            Category-Wise Totals
          </h4>
          <div className="space-y-3.5" id="category-breakdown-list">
            {summary.categories.map((cat) => (
              <div key={cat.category} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-gray-700 dark:text-gray-300">
                    {cat.category}
                  </span>
                  <div className="flex items-center gap-2 font-mono">
                    <span className="text-gray-400 text-[11px]">({cat.count} entries)</span>
                    <span className="font-bold text-[var(--color-text-main)]">
                      ₹{cat.totalAmount.toFixed(2)}
                    </span>
                    <span className="text-[11px] font-semibold text-gray-500 w-12 text-right">
                      {cat.percentage}%
                    </span>
                  </div>
                </div>
                {/* Progress bar */}
                <div className="w-full h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--color-primary)] transition-all duration-500"
                    style={{ width: `${cat.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Custom "Other Expense" Itemized Breakdown */}
        <Card className="p-6">
          <h4 className="text-sm font-bold text-[var(--color-text-main)] uppercase tracking-wider mb-4 flex items-center gap-2">
            <Filter className="w-4 h-4 text-[var(--color-primary)]" />
            Itemized "Other Expense" Breakdown
          </h4>
          {summary.customOtherExpenses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-gray-400">
              <AlertCircle className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-xs">No "Other Expense" entries in this period.</p>
            </div>
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-xs" id="custom-other-expenses-table">
                <thead>
                  <tr className="border-b border-black/[0.04] dark:border-white/[0.04] text-gray-400 font-bold uppercase text-[10px]">
                    <th className="pb-2.5">Custom Item Name</th>
                    <th className="pb-2.5 text-center">Entries</th>
                    <th className="pb-2.5 text-right">Total Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                  {summary.customOtherExpenses.map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="py-2.5 font-semibold text-gray-800 dark:text-gray-200">
                        {item.customExpenseName}
                      </td>
                      <td className="py-2.5 text-center text-gray-500 font-mono">
                        {item.count}
                      </td>
                      <td className="py-2.5 text-right font-bold text-[var(--color-text-main)] font-mono">
                        ₹{item.totalAmount.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Staff and Admin Breakdown Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Individual Staff Breakdown */}
        <Card className="p-6">
          <h4 className="text-sm font-bold text-[var(--color-text-main)] uppercase tracking-wider mb-4 flex items-center gap-2">
            <Users className="w-4 h-4 text-[var(--color-primary)]" />
            {isAdmin ? 'Staff / Driver Totals' : 'My Expense Total'}
          </h4>
          {summary.staffBreakdown.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-gray-400">
              <p className="text-xs">No staff expenses recorded in this period.</p>
            </div>
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-xs" id="staff-expense-breakdown-table">
                <thead>
                  <tr className="border-b border-black/[0.04] dark:border-white/[0.04] text-gray-400 font-bold uppercase text-[10px]">
                    <th className="pb-2.5">Staff / Driver</th>
                    <th className="pb-2.5 text-center">Entries</th>
                    <th className="pb-2.5 text-right">Total Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                  {summary.staffBreakdown.map((item) => (
                    <tr key={item.staffUid} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="py-2.5 font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-500" />
                        {item.staffName}
                      </td>
                      <td className="py-2.5 text-center text-gray-500 font-mono">
                        {item.count}
                      </td>
                      <td className="py-2.5 text-right font-bold text-[var(--color-text-main)] font-mono">
                        ₹{item.totalAmount.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Admin Attribution Breakdown (Admin Only) */}
        {isAdmin && (
          <Card className="p-6">
            <h4 className="text-sm font-bold text-[var(--color-text-main)] uppercase tracking-wider mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 text-[var(--color-primary)]" />
              Admin Operator Attribution Totals
            </h4>
            {summary.adminAttributionBreakdown.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center text-gray-400">
                <p className="text-xs">No admin-attributed expenses recorded in this period.</p>
              </div>
            ) : (
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left text-xs" id="admin-attribution-breakdown-table">
                  <thead>
                    <tr className="border-b border-black/[0.04] dark:border-white/[0.04] text-gray-400 font-bold uppercase text-[10px]">
                      <th className="pb-2.5">Admin Operator Display Name</th>
                      <th className="pb-2.5 text-center">Entries</th>
                      <th className="pb-2.5 text-right">Total Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                    {summary.adminAttributionBreakdown.map((item) => (
                      <tr key={item.adminName} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <td className="py-2.5 font-semibold text-[var(--color-primary)] flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-[var(--color-primary)]" />
                          {item.adminName}
                        </td>
                        <td className="py-2.5 text-center text-gray-500 font-mono">
                          {item.count}
                        </td>
                        <td className="py-2.5 text-right font-bold text-[var(--color-text-main)] font-mono">
                          ₹{item.totalAmount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
