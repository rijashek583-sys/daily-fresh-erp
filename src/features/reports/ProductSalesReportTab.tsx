import React, { useState, useMemo } from 'react';
import {
  Calendar,
  Download,
  Printer,
  Search,
  Filter,
  CheckCircle2,
  Package,
  Layers,
  ArrowUpDown,
  TrendingUp,
  X,
  AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { useDataStore } from '../../stores/dataStore';
import { useAuthStore } from '../../stores/authStore';
import { Button, Card, Badge } from '../../components/ui';
import { formatCurrency, cn } from '../../lib/utils';
import {
  calculateProductSalesReport,
  downloadSalesReportCsv,
  printSalesReport,
  type DateRangePreset,
  type ReportDivisionFilter,
  type ReportSortField,
  type SortDirection,
  type SalesReportFilter,
} from '../../lib/salesReport';

export default function ProductSalesReportTab() {
  const { orders, products } = useDataStore();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  // Filters state
  const [preset, setPreset] = useState<DateRangePreset>('this_month');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [division, setDivision] = useState<ReportDivisionFilter>('all');
  const [selectedProductId, setSelectedProductId] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [sortBy, setSortBy] = useState<ReportSortField>('amount');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  // Sorted product options for the filter dropdown
  const sortedCatalogProducts = useMemo(() => {
    return [...products]
      .filter(p => !p.deletedAt && p.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);

  // Construct filter object
  const reportFilter = useMemo<SalesReportFilter>(() => ({
    preset,
    customFrom: preset === 'custom' ? customFrom : undefined,
    customTo: preset === 'custom' ? customTo : undefined,
    division,
    productId: selectedProductId,
    search,
    sortBy,
    sortDir,
  }), [preset, customFrom, customTo, division, selectedProductId, search, sortBy, sortDir]);

  // Execute aggregation
  const reportResult = useMemo(() => {
    return calculateProductSalesReport(orders, products, reportFilter);
  }, [orders, products, reportFilter]);

  const { rows, summary, dateRangeLabel } = reportResult;

  // Handlers
  const handleSort = (field: ReportSortField) => {
    if (sortBy === field) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
  };

  const handleExportCsv = () => {
    try {
      if (rows.length === 0) {
        toast.error('No sales data to export for the selected filter.');
        return;
      }
      downloadSalesReportCsv(reportResult, reportFilter);
      toast.success('Product sales report exported as CSV.');
    } catch (err: any) {
      toast.error(`CSV Export failed: ${err?.message || 'Unknown error'}`);
    }
  };

  const handlePrint = () => {
    try {
      if (rows.length === 0) {
        toast.error('No sales data to print for the selected filter.');
        return;
      }
      printSalesReport(reportResult, reportFilter);
    } catch (err: any) {
      toast.error(`Print preview failed: ${err?.message || 'Unknown error'}`);
    }
  };

  if (!isAdmin) {
    return (
      <Card className="p-8 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
        <h3 className="text-base font-bold text-[var(--color-text-main)]">Access Restricted</h3>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Only administrators are authorized to view product-wise sales reports.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Control Bar: Date, Division, Product & Search ── */}
      <Card padding={false} className="p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-white/[0.05]">
        <div className="flex flex-col gap-4">
          {/* Top Row: Date Presets & Division Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Date Presets */}
            <div className="flex items-center gap-1.5 p-1 bg-gray-100 dark:bg-gray-800/60 rounded-xl">
              {(
                [
                  { id: 'today', label: 'Today' },
                  { id: 'yesterday', label: 'Yesterday' },
                  { id: 'this_week', label: 'This Week' },
                  { id: 'this_month', label: 'This Month' },
                  { id: 'custom', label: 'Custom' },
                ] as const
              ).map(item => (
                <button
                  key={item.id}
                  onClick={() => setPreset(item.id)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-semibold rounded-lg transition-all',
                    preset === item.id
                      ? 'bg-white dark:bg-gray-900 text-[var(--color-primary)] shadow-sm'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]'
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* Division Filter */}
            <div className="flex items-center gap-1.5 p-1 bg-gray-100 dark:bg-gray-800/60 rounded-xl">
              {(
                [
                  { id: 'all', label: 'All Divisions' },
                  { id: 'primary', label: 'Primary Only' },
                  { id: 'bakery', label: 'Bakery Only' },
                ] as const
              ).map(item => (
                <button
                  key={item.id}
                  onClick={() => setDivision(item.id)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-semibold rounded-lg transition-all',
                    division === item.id
                      ? 'bg-white dark:bg-gray-900 text-[var(--color-text-main)] shadow-sm'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]'
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                icon={<Download className="w-3.5 h-3.5" />}
                onClick={handleExportCsv}
                title="Download Excel / CSV"
              >
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon={<Printer className="w-3.5 h-3.5" />}
                onClick={handlePrint}
                title="Print Report"
              >
                Print
              </Button>
            </div>
          </div>

          {/* Custom Date Range Pickers (if Custom preset chosen) */}
          {preset === 'custom' && (
            <div className="flex flex-wrap items-center gap-3 p-3 bg-gray-50 dark:bg-gray-900/40 rounded-xl border border-gray-100 dark:border-white/[0.05]">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[var(--color-text-muted)]">From:</span>
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[var(--color-text-main)] font-semibold outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[var(--color-text-muted)]">To:</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[var(--color-text-main)] font-semibold outline-none"
                />
              </div>
              <span className="text-xs text-[var(--color-text-muted)] italic">
                (Inclusive date boundary in Asia/Kolkata timezone)
              </span>
            </div>
          )}

          {/* Bottom Row: Product Selector & Search Input */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Product Selector */}
            <div className="relative">
              <select
                value={selectedProductId}
                onChange={e => setSelectedProductId(e.target.value)}
                className="w-full px-3 py-2 text-xs font-semibold rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-[var(--color-text-main)] outline-none cursor-pointer appearance-none pr-8"
              >
                <option value="all">All Products (Full Catalog)</option>
                {sortedCatalogProducts.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.division === 'primary' ? 'Primary' : 'Bakery'})
                  </option>
                ))}
              </select>
              <Filter className="w-3.5 h-3.5 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Keyword Search */}
            <div className="relative">
              <input
                type="text"
                placeholder="Search product name..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-8 py-2 text-xs rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-[var(--color-text-main)] placeholder-gray-400 outline-none"
              />
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Active Period Label */}
            <div className="flex items-center justify-end sm:justify-start lg:justify-end text-xs font-medium text-[var(--color-text-muted)]">
              <Calendar className="w-3.5 h-3.5 mr-1.5 text-gray-400 shrink-0" />
              <span>Period: <strong className="text-[var(--color-text-main)] font-semibold">{dateRangeLabel}</strong></span>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Summary KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
        {/* Total Sales */}
        <Card className="p-4 sm:p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-500 text-xs font-semibold uppercase tracking-wider mb-2">
            <span>Total Sales</span>
            <TrendingUp className="w-4 h-4 text-[var(--color-primary)]" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-[var(--color-text-main)] tracking-tight">
            {formatCurrency(summary.totalSales)}
          </div>
          <div className="text-[11px] text-[var(--color-text-muted)] font-medium mt-1">
            Across {summary.validOrdersCount} valid orders
          </div>
        </Card>

        {/* Total Quantity */}
        <Card className="p-4 sm:p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-500 text-xs font-semibold uppercase tracking-wider mb-2">
            <span>Quantity Sold</span>
            <Package className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-[var(--color-text-main)] tracking-tight">
            {summary.totalQty.toLocaleString('en-IN')}{' '}
            <span className="text-xs font-normal text-gray-400">units</span>
          </div>
          <div className="text-[11px] text-[var(--color-text-muted)] font-medium mt-1">
            {summary.uniqueProductsCount} distinct products sold
          </div>
        </Card>

        {/* Primary Foods Subtotal */}
        <Card className="p-4 sm:p-5 flex flex-col justify-between border-l-4 border-l-blue-500">
          <div className="flex items-center justify-between text-gray-500 text-xs font-semibold uppercase tracking-wider mb-2">
            <span className="text-blue-600 dark:text-blue-400">Primary Foods</span>
            <Badge variant="info">Primary</Badge>
          </div>
          <div className="text-xl sm:text-2xl font-black text-[var(--color-text-main)] tracking-tight">
            {formatCurrency(summary.primarySales)}
          </div>
          <div className="text-[11px] text-[var(--color-text-muted)] font-medium mt-1 flex justify-between">
            <span>{summary.primaryQty.toLocaleString('en-IN')} units</span>
            <span>
              {summary.totalSales > 0
                ? `${((summary.primarySales / summary.totalSales) * 100).toFixed(1)}%`
                : '0%'}
            </span>
          </div>
        </Card>

        {/* Bakery Foods Subtotal */}
        <Card className="p-4 sm:p-5 flex flex-col justify-between border-l-4 border-l-amber-500">
          <div className="flex items-center justify-between text-gray-500 text-xs font-semibold uppercase tracking-wider mb-2">
            <span className="text-amber-600 dark:text-amber-400">Bakery Foods</span>
            <Badge variant="warning">Bakery</Badge>
          </div>
          <div className="text-xl sm:text-2xl font-black text-[var(--color-text-main)] tracking-tight">
            {formatCurrency(summary.bakerySales)}
          </div>
          <div className="text-[11px] text-[var(--color-text-muted)] font-medium mt-1 flex justify-between">
            <span>{summary.bakeryQty.toLocaleString('en-IN')} units</span>
            <span>
              {summary.totalSales > 0
                ? `${((summary.bakerySales / summary.totalSales) * 100).toFixed(1)}%`
                : '0%'}
            </span>
          </div>
        </Card>
      </div>

      {/* ── Subtotal Reconciliation Pill ── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-800 rounded-xl text-xs">
        <div className="flex items-center gap-2">
          {summary.isReconciled ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
          )}
          <span className="text-[var(--color-text-main)] font-semibold">
            {summary.isReconciled
              ? 'Subtotals Reconciled:'
              : 'Reconciliation Warning:'}
          </span>
          <span className="text-[var(--color-text-muted)]">
            Primary ({formatCurrency(summary.primarySales)}) + Bakery ({formatCurrency(summary.bakerySales)}) = Grand Total ({formatCurrency(summary.totalSales)})
          </span>
        </div>
        <span className="hidden sm:inline text-[11px] text-gray-400">
          Zero double-counting guaranteed
        </span>
      </div>

      {/* ── Product-wise Sales Table ── */}
      <Card padding={false} className="shadow-sm border border-gray-100 dark:border-white/[0.05] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/[0.05] bg-gray-50/50 dark:bg-gray-900/50 text-[11px] uppercase tracking-wider text-[var(--color-text-muted)]">
                <th
                  onClick={() => handleSort('amount')}
                  className="py-3.5 px-4 font-bold text-center w-14 cursor-pointer hover:text-[var(--color-text-main)] select-none"
                  title="Rank by Sales Amount"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>Rank</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('name')}
                  className="py-3.5 px-4 font-bold cursor-pointer hover:text-[var(--color-text-main)] select-none"
                >
                  <div className="flex items-center gap-1">
                    <span>Product</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="py-3.5 px-3 font-bold text-center w-28">Division</th>
                <th className="py-3.5 px-3 font-bold text-center w-16">Unit</th>
                <th
                  onClick={() => handleSort('qty')}
                  className="py-3.5 px-4 font-bold text-right cursor-pointer hover:text-[var(--color-text-main)] select-none"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Qty Sold</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('avg_price')}
                  className="py-3.5 px-4 font-bold text-right cursor-pointer hover:text-[var(--color-text-main)] select-none"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Avg Price</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('amount')}
                  className="py-3.5 px-4 font-bold text-right cursor-pointer hover:text-[var(--color-text-main)] select-none"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Total Sales</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="py-3.5 px-4 font-bold text-right w-36">Sales Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.04] text-xs">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-400">
                    <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="font-semibold text-sm">No sales found</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      No valid orders matched the selected filters for {dateRangeLabel}.
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map(row => (
                  <tr
                    key={row.productId}
                    className="hover:bg-gray-50/60 dark:hover:bg-gray-800/30 transition-colors"
                  >
                    <td className="py-3 px-4 text-center font-bold text-[var(--color-text-muted)]">
                      <span className={cn(
                        "inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-black",
                        row.rankAmount === 1 ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" :
                        row.rankAmount === 2 ? "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200" :
                        row.rankAmount === 3 ? "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300" :
                        "text-[var(--color-text-muted)]"
                      )}>
                        {row.rankAmount}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-sm text-[var(--color-text-main)]">
                        {row.productName}
                      </div>
                      <div className="text-[11px] text-[var(--color-text-muted)]">
                        Appeared in {row.orderCount} order{row.orderCount !== 1 ? 's' : ''}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <Badge variant={row.division === 'primary' ? 'info' : 'warning'}>
                        {row.division === 'primary' ? 'Primary' : 'Bakery'}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 text-center font-medium text-[var(--color-text-muted)]">
                      {row.unit}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-sm text-[var(--color-text-main)]">
                      {row.totalQty.toLocaleString('en-IN')}
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-[var(--color-text-muted)]">
                      {formatCurrency(row.averagePrice)}
                    </td>
                    <td className="py-3 px-4 text-right font-black text-sm text-[var(--color-text-main)]">
                      {formatCurrency(row.totalSales)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 bg-gray-100 dark:bg-gray-800 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              row.division === 'primary' ? "bg-blue-500" : "bg-amber-500"
                            )}
                            style={{ width: `${Math.min(row.shareOfTotal, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-[var(--color-text-muted)] w-11 text-right">
                          {row.shareOfTotal.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/80 font-bold text-xs text-[var(--color-text-main)]">
                  <td className="py-3.5 px-4 text-center">-</td>
                  <td className="py-3.5 px-4 font-black">
                    TOTAL ({summary.uniqueProductsCount} Products)
                  </td>
                  <td className="py-3.5 px-3 text-center">-</td>
                  <td className="py-3.5 px-3 text-center">-</td>
                  <td className="py-3.5 px-4 text-right font-black text-sm">
                    {summary.totalQty.toLocaleString('en-IN')}
                  </td>
                  <td className="py-3.5 px-4 text-right font-semibold text-[var(--color-text-muted)]">
                    {summary.totalQty > 0
                      ? formatCurrency(summary.totalSales / summary.totalQty)
                      : '₹0.00'}
                  </td>
                  <td className="py-3.5 px-4 text-right font-black text-base text-[var(--color-primary)]">
                    {formatCurrency(summary.totalSales)}
                  </td>
                  <td className="py-3.5 px-4 text-right font-black">
                    100.0%
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}
