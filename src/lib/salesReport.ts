import { type Order, type Product, type OrderItem } from '../types';
import { getProductDivision } from './utils';

export type DateRangePreset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom';
export type ReportDivisionFilter = 'all' | 'primary' | 'bakery';
export type ReportSortField = 'amount' | 'qty' | 'name' | 'avg_price';
export type SortDirection = 'asc' | 'desc';

export interface SalesReportFilter {
  preset: DateRangePreset;
  customFrom?: string;
  customTo?: string;
  division: ReportDivisionFilter;
  productId?: string; // 'all' or specific productId
  search?: string;
  sortBy?: ReportSortField;
  sortDir?: SortDirection;
}

export interface ProductSalesRow {
  productId: string;
  productName: string;
  division: 'primary' | 'bakery';
  unit: string;
  totalQty: number;
  totalSales: number;
  averagePrice: number;
  orderCount: number;
  shareOfTotal: number; // percentage 0 - 100
  rankAmount: number;
  rankQty: number;
}

export interface SalesReportSummary {
  totalSales: number;
  totalQty: number;
  primarySales: number;
  primaryQty: number;
  bakerySales: number;
  bakeryQty: number;
  uniqueProductsCount: number;
  validOrdersCount: number;
  isReconciled: boolean;
}

export interface SalesReportResult {
  rows: ProductSalesRow[];
  summary: SalesReportSummary;
  dateRangeLabel: string;
  effectiveFrom: string;
  effectiveTo: string;
}

/**
 * Helper to round to 2 decimal places to avoid floating point anomalies.
 */
export function round2(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Returns the calendar date parts in Asia/Kolkata timezone.
 */
export function getLocalDateParts(date: Date = new Date()): { str: string; year: number; month: number; day: number } {
  try {
    const str = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
    const [year, month, day] = str.split('-').map(Number);
    return { str, year, month, day };
  } catch {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const str = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { str, year, month, day };
  }
}

/**
 * Computes inclusive date boundaries based on business-local Asia/Kolkata timezone.
 * "This Week" starts on Monday and is capped at today (no future orders counted).
 * "This Month" starts on the 1st of the month and is capped at today (no future orders counted).
 */
export function getDateRangeBoundaries(
  preset: DateRangePreset,
  customFrom?: string,
  customTo?: string,
  referenceDate: Date = new Date()
): { from: string; to: string; label: string } {
  const { str: todayStr, year, month, day } = getLocalDateParts(referenceDate);
  const curDateUtc = new Date(Date.UTC(year, month - 1, day));

  if (preset === 'today') {
    return { from: todayStr, to: todayStr, label: `Today (${todayStr})` };
  }

  if (preset === 'yesterday') {
    const yestDate = new Date(curDateUtc);
    yestDate.setUTCDate(yestDate.getUTCDate() - 1);
    const yestStr = yestDate.toISOString().slice(0, 10);
    return { from: yestStr, to: yestStr, label: `Yesterday (${yestStr})` };
  }

  if (preset === 'this_week') {
    // In India/business calendar, Monday is day 0 of business week.
    // getUTCDay: 0=Sun, 1=Mon, ..., 6=Sat
    const dayOfWeek = (curDateUtc.getUTCDay() + 6) % 7; // Mon=0, Sun=6
    const monDate = new Date(curDateUtc);
    monDate.setUTCDate(monDate.getUTCDate() - dayOfWeek);
    const monStr = monDate.toISOString().slice(0, 10);
    // Capped at today to prevent premature future sales
    return { from: monStr, to: todayStr, label: `This Week (${monStr} to ${todayStr})` };
  }

  if (preset === 'this_month') {
    const firstOfMonthStr = `${year}-${String(month).padStart(2, '0')}-01`;
    // Capped at today to prevent premature future sales
    return { from: firstOfMonthStr, to: todayStr, label: `This Month (${firstOfMonthStr} to ${todayStr})` };
  }

  if (preset === 'custom') {
    let f = (customFrom || todayStr).trim();
    let t = (customTo || f).trim();
    if (f > t) {
      const temp = f;
      f = t;
      t = temp;
    }
    return { from: f, to: t, label: `Custom (${f} to ${t})` };
  }

  return { from: todayStr, to: todayStr, label: todayStr };
}

/**
 * Checks if an order is valid for sales reporting.
 * Excludes orders that have been trashed, cancelled, or soft-deleted.
 * Valid orders are included regardless of payment status ('paid', 'partial', 'pending').
 */
export function isOrderValidForSales(order: Order | any): boolean {
  if (!order || typeof order !== 'object') return false;
  if (order.deletedAt) return false;
  if (order.isDeleted === true) return false;
  if (order.status === 'cancelled' || order.status === 'deleted' || order.status === 'trash') {
    return false;
  }
  return true;
}

/**
 * Resolves the business date of an order.
 * Uses deliveryDate ('yyyy-MM-dd') as canonical, falling back to createdAt date.
 */
export function getOrderDate(order: Order): string {
  if (order.deliveryDate && typeof order.deliveryDate === 'string') {
    return order.deliveryDate.substring(0, 10);
  }
  if (order.createdAt && typeof order.createdAt === 'string') {
    return order.createdAt.substring(0, 10);
  }
  return '';
}

/**
 * Resolves product division for an order item using canonical getProductDivision.
 * Enforces the confirmed business rule:
 *   PRIMARY FOODS: Kuboos, Roomali, Wheat Kuboos ONLY.
 *   BAKERY FOODS: Soft Kuboos, Poratta, Burger Bun, and all other products.
 */
export function resolveItemDivision(
  item: OrderItem & { division?: string },
  products?: Product[]
): 'primary' | 'bakery' {
  const catalogProduct = products?.find(
    p => (item.productId && p.id === item.productId) ||
         p.name.trim().toLowerCase() === item.productName.trim().toLowerCase()
  );
  return getProductDivision(catalogProduct || { name: item.productName, division: item.division });
}

/**
 * Resolves the authoritative line total for an order item.
 * Uses item.total when valid, falling back to qty * unitPrice.
 */
export function resolveLineItemTotal(item: OrderItem): number {
  if (typeof item.total === 'number' && !isNaN(item.total) && item.total >= 0) {
    return round2(item.total);
  }
  const qty = typeof item.qty === 'number' && !isNaN(item.qty) && item.qty > 0 ? item.qty : 0;
  const unitPrice = typeof item.unitPrice === 'number' && !isNaN(item.unitPrice) && item.unitPrice >= 0 ? item.unitPrice : 0;
  return round2(qty * unitPrice);
}

/**
 * Core calculation engine for the Product-wise Sales Report.
 * Aggregates order line items without modifying any records or triggering network calls.
 */
export function calculateProductSalesReport(
  orders: Order[],
  products: Product[],
  filter: SalesReportFilter,
  referenceDate: Date = new Date()
): SalesReportResult {
  const boundaries = getDateRangeBoundaries(filter.preset, filter.customFrom, filter.customTo, referenceDate);
  const { from, to, label: dateRangeLabel } = boundaries;

  // Filter orders within date boundary and validity rules
  const validIncludedOrderIds = new Set<string>();

  interface IntermediateProductData {
    productId: string;
    productName: string;
    division: 'primary' | 'bakery';
    unit: string;
    totalQty: number;
    totalSales: number;
    orderIds: Set<string>;
  }

  const productMap = new Map<string, IntermediateProductData>();

  for (const order of orders) {
    if (!isOrderValidForSales(order)) continue;

    const oDate = getOrderDate(order);
    if (!oDate || oDate < from || oDate > to) continue;

    let orderContributedToReport = false;
    const items = Array.isArray(order.items) ? order.items : [];

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const qty = typeof item.qty === 'number' && !isNaN(item.qty) ? item.qty : 0;
      if (qty <= 0) continue;

      const lineTotal = resolveLineItemTotal(item);
      const division = resolveItemDivision(item, products);

      // Division filter
      if (filter.division !== 'all' && division !== filter.division) {
        continue;
      }

      // Catalog product match
      const catalogProduct = products.find(
        p => (item.productId && p.id === item.productId) ||
             p.name.trim().toLowerCase() === item.productName.trim().toLowerCase()
      );

      const resolvedProductId = item.productId || catalogProduct?.id || `uncataloged_${item.productName.trim().toLowerCase()}`;
      const resolvedProductName = catalogProduct?.name || item.productName || 'Uncataloged Product';
      const resolvedUnit = catalogProduct?.unit || 'pkt';

      // Specific product filter
      if (filter.productId && filter.productId !== 'all') {
        const matchesFilter =
          resolvedProductId === filter.productId ||
          item.productId === filter.productId ||
          resolvedProductName.toLowerCase() === filter.productId.toLowerCase();
        if (!matchesFilter) continue;
      }

      // Search keyword filter
      if (filter.search && filter.search.trim()) {
        const q = filter.search.trim().toLowerCase();
        if (!resolvedProductName.toLowerCase().includes(q)) {
          continue;
        }
      }

      orderContributedToReport = true;

      // Grouping key: prefer productId, fallback to normalized product name
      const groupKey = (item.productId || catalogProduct?.id)
        ? `id:${item.productId || catalogProduct?.id}`
        : `name:${resolvedProductName.trim().toLowerCase()}`;

      let existing = productMap.get(groupKey);
      if (!existing) {
        existing = {
          productId: resolvedProductId,
          productName: resolvedProductName,
          division,
          unit: resolvedUnit,
          totalQty: 0,
          totalSales: 0,
          orderIds: new Set<string>(),
        };
        productMap.set(groupKey, existing);
      }

      existing.totalQty += qty;
      existing.totalSales = round2(existing.totalSales + lineTotal);
      existing.orderIds.add(order.id);
    }

    if (orderContributedToReport) {
      validIncludedOrderIds.add(order.id);
    }
  }

  // Calculate overall totals
  let grandTotalSales = 0;
  let grandTotalQty = 0;
  let primarySales = 0;
  let primaryQty = 0;
  let bakerySales = 0;
  let bakeryQty = 0;

  const rawRows: Omit<ProductSalesRow, 'shareOfTotal' | 'rankAmount' | 'rankQty'>[] = [];

  for (const item of productMap.values()) {
    const totalSales = round2(item.totalSales);
    const totalQty = item.totalQty;
    const avgPrice = totalQty > 0 ? round2(totalSales / totalQty) : 0;

    grandTotalSales = round2(grandTotalSales + totalSales);
    grandTotalQty += totalQty;

    if (item.division === 'primary') {
      primarySales = round2(primarySales + totalSales);
      primaryQty += totalQty;
    } else {
      bakerySales = round2(bakerySales + totalSales);
      bakeryQty += totalQty;
    }

    rawRows.push({
      productId: item.productId,
      productName: item.productName,
      division: item.division,
      unit: item.unit,
      totalQty,
      totalSales,
      averagePrice: avgPrice,
      orderCount: item.orderIds.size,
    });
  }

  // Calculate ranks
  // 1. Rank by sales amount
  const sortedByAmount = [...rawRows].sort((a, b) => b.totalSales - a.totalSales);
  const rankAmountMap = new Map<string, number>();
  sortedByAmount.forEach((row, idx) => {
    rankAmountMap.set(row.productId, idx + 1);
  });

  // 2. Rank by sales quantity
  const sortedByQty = [...rawRows].sort((a, b) => b.totalQty - a.totalQty);
  const rankQtyMap = new Map<string, number>();
  sortedByQty.forEach((row, idx) => {
    rankQtyMap.set(row.productId, idx + 1);
  });

  // Assemble finalized rows with percentage share and rankings
  const rows: ProductSalesRow[] = rawRows.map(row => {
    const share = grandTotalSales > 0 ? round2((row.totalSales / grandTotalSales) * 100) : 0;
    return {
      ...row,
      shareOfTotal: share,
      rankAmount: rankAmountMap.get(row.productId) || 0,
      rankQty: rankQtyMap.get(row.productId) || 0,
    };
  });

  // Apply requested sorting
  const sortBy = filter.sortBy || 'amount';
  const sortDir = filter.sortDir || 'desc';

  rows.sort((a, b) => {
    let diff = 0;
    if (sortBy === 'amount') diff = a.totalSales - b.totalSales;
    else if (sortBy === 'qty') diff = a.totalQty - b.totalQty;
    else if (sortBy === 'name') diff = a.productName.localeCompare(b.productName);
    else if (sortBy === 'avg_price') diff = a.averagePrice - b.averagePrice;

    return sortDir === 'asc' ? diff : -diff;
  });

  // Subtotal reconciliation check
  const subtotalSum = round2(primarySales + bakerySales);
  const isReconciled = Math.abs(subtotalSum - grandTotalSales) < 0.001;

  const summary: SalesReportSummary = {
    totalSales: grandTotalSales,
    totalQty: grandTotalQty,
    primarySales,
    primaryQty,
    bakerySales,
    bakeryQty,
    uniqueProductsCount: rows.length,
    validOrdersCount: validIncludedOrderIds.size,
    isReconciled,
  };

  return {
    rows,
    summary,
    dateRangeLabel,
    effectiveFrom: from,
    effectiveTo: to,
  };
}

/**
 * Sanitizes a single cell value for CSV export according to RFC 4180
 * with protection against spreadsheet formula injection (=, +, -, @, \t, \r).
 * Preserves genuine negative numbers and ordinary text without corruption.
 */
export function sanitizeCsvCell(val: any): string {
  if (val === null || val === undefined) return '""';
  if (typeof val === 'number') {
    return isNaN(val) ? '0' : String(val);
  }

  let str = String(val).trim();

  // If the string is a valid numeric representation (e.g. "-150.50"), allow as-is
  if (!isNaN(Number(str)) && str !== '') {
    return str;
  }

  // Prevent formula injection if the string starts with formula trigger characters
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // RFC 4180 escaping: wrap in quotes and escape internal double quotes by doubling
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Generates an Excel-compatible RFC 4180 CSV string with UTF-8 BOM.
 */
export function generateSalesReportCsv(
  result: SalesReportResult,
  filter: SalesReportFilter,
  generatedAt: Date = new Date()
): string {
  const { str: genDateStr } = getLocalDateParts(generatedAt);
  const timeStr = generatedAt.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const divisionText =
    filter.division === 'primary' ? 'Primary Foods Only' :
    filter.division === 'bakery' ? 'Bakery Foods Only' :
    'All Divisions (Primary & Bakery)';

  const lines: string[] = [
    // Header metadata
    `"Daily Fresh ERP — Product-wise Sales Report"`,
    `"Generated On","${genDateStr} ${timeStr} IST"`,
    `"Date Range","${result.dateRangeLabel}"`,
    `"Division Filter","${divisionText}"`,
    `""`,
    // Summary table
    `"SUMMARY TOTALS"`,
    `"Total Sales Amount (INR)","${result.summary.totalSales.toFixed(2)}"`,
    `"Total Quantity Sold","${result.summary.totalQty}"`,
    `"Primary Foods Sales (INR)","${result.summary.primarySales.toFixed(2)}"`,
    `"Bakery Foods Sales (INR)","${result.summary.bakerySales.toFixed(2)}"`,
    `"Unique Products Sold","${result.summary.uniqueProductsCount}"`,
    `"Valid Orders Count","${result.summary.validOrdersCount}"`,
    `"Subtotal Reconciled","${result.summary.isReconciled ? 'YES' : 'NO'}"`,
    `""`,
    // Column headers
    [
      sanitizeCsvCell('Rank (#)'),
      sanitizeCsvCell('Product Name'),
      sanitizeCsvCell('Division'),
      sanitizeCsvCell('Unit'),
      sanitizeCsvCell('Quantity Sold'),
      sanitizeCsvCell('Average Selling Price (INR)'),
      sanitizeCsvCell('Total Sales Amount (INR)'),
      sanitizeCsvCell('Share of Total Sales (%)'),
      sanitizeCsvCell('Orders Count'),
    ].join(','),
  ];

  // Product rows
  for (const row of result.rows) {
    const divisionLabel = row.division === 'primary' ? 'Primary Foods' : 'Bakery Foods';
    const rowCells = [
      row.rankAmount,
      sanitizeCsvCell(row.productName),
      sanitizeCsvCell(divisionLabel),
      sanitizeCsvCell(row.unit),
      row.totalQty,
      row.averagePrice.toFixed(2),
      row.totalSales.toFixed(2),
      `${row.shareOfTotal.toFixed(1)}%`,
      row.orderCount,
    ];
    lines.push(rowCells.join(','));
  }

  // Footer totals row
  lines.push(`""`);
  lines.push([
    `"TOTAL"`,
    `"All Products"`,
    sanitizeCsvCell(divisionText),
    `"-"`,
    result.summary.totalQty,
    result.summary.totalQty > 0 ? (result.summary.totalSales / result.summary.totalQty).toFixed(2) : '0.00',
    result.summary.totalSales.toFixed(2),
    `"100.0%"`,
    result.summary.validOrdersCount,
  ].join(','));

  // UTF-8 BOM + lines joined with CRLF
  return '\uFEFF' + lines.join('\r\n');
}

/**
 * Triggers safe CSV file download in the browser/client.
 */
export function downloadSalesReportCsv(
  result: SalesReportResult,
  filter: SalesReportFilter,
  filenamePrefix = 'daily-fresh-product-sales'
): void {
  const csvContent = generateSalesReportCsv(result, filter);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  const cleanDateRange = `${result.effectiveFrom}_to_${result.effectiveTo}`;
  link.setAttribute('download', `${filenamePrefix}-${cleanDateRange}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Renders print-ready HTML for the Product-wise Sales Report.
 */
export function renderSalesReportPrintHtml(
  result: SalesReportResult,
  filter: SalesReportFilter,
  generatedAt: Date = new Date()
): string {
  const { str: genDateStr } = getLocalDateParts(generatedAt);
  const timeStr = generatedAt.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });

  const divisionText =
    filter.division === 'primary' ? 'Primary Foods Only' :
    filter.division === 'bakery' ? 'Bakery Foods Only' :
    'All Divisions';

  const rowsHtml = result.rows.map((row, idx) => `
    <tr>
      <td style="text-align: center; font-weight: 600;">${row.rankAmount}</td>
      <td style="font-weight: 600;">${row.productName}</td>
      <td style="text-align: center;">
        <span class="badge ${row.division === 'primary' ? 'badge-primary' : 'badge-bakery'}">
          ${row.division === 'primary' ? 'Primary' : 'Bakery'}
        </span>
      </td>
      <td style="text-align: center;">${row.unit}</td>
      <td style="text-align: right; font-weight: 600;">${row.totalQty.toLocaleString('en-IN')}</td>
      <td style="text-align: right;">₹${row.averagePrice.toFixed(2)}</td>
      <td style="text-align: right; font-weight: 700;">₹${row.totalSales.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td style="text-align: right;">${row.shareOfTotal.toFixed(1)}%</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Daily Fresh ERP — Product Sales Report</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 15mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 11px; line-height: 1.4; color: #111827; margin: 0; padding: 15px; }
    .header { border-bottom: 2px solid #b91c1c; padding-bottom: 12px; margin-bottom: 15px; }
    .company-title { font-size: 18px; font-weight: 800; color: #b91c1c; margin: 0; }
    .company-sub { font-size: 10px; color: #6b7280; margin: 2px 0 0; }
    .report-title-bar { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 10px; }
    .report-title { font-size: 14px; font-weight: 700; color: #1f2937; margin: 0; }
    .report-meta { font-size: 10px; color: #4b5563; text-align: right; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
    .summary-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 12px; }
    .summary-label { font-size: 9px; font-weight: 600; text-transform: uppercase; color: #6b7280; }
    .summary-val { font-size: 14px; font-weight: 800; color: #111827; margin-top: 2px; }
    .summary-sub { font-size: 9px; color: #4b5563; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { background: #f3f4f6; color: #374151; font-size: 9.5px; font-weight: 700; text-transform: uppercase; border: 1px solid #e5e7eb; padding: 6px 8px; }
    td { border: 1px solid #e5e7eb; padding: 6px 8px; font-size: 10.5px; }
    tr:nth-child(even) td { background-color: #fafafa; }
    tfoot td { background: #f3f4f6; font-weight: 800; border-top: 2px solid #d1d5db; }
    .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700; text-transform: uppercase; }
    .badge-primary { background: #dbeafe; color: #1e40af; }
    .badge-bakery { background: #fef3c7; color: #92400e; }
    .footer { margin-top: 20px; font-size: 9px; color: #9ca3af; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="company-title">Daily Fresh Food Products</div>
    <div class="company-sub">Posoat, Manjeswar, Kasargode – 671323 | Phone: 9072265888, 7907092583</div>
    <div class="report-title-bar">
      <div>
        <h1 class="report-title">Product-wise Sales Report</h1>
        <div style="font-size: 10px; color: #4b5563; margin-top: 2px;">Division: <strong>${divisionText}</strong></div>
      </div>
      <div class="report-meta">
        <div>Period: <strong>${result.dateRangeLabel}</strong></div>
        <div>Generated: <strong>${genDateStr} ${timeStr} IST</strong></div>
      </div>
    </div>
  </div>

  <div class="summary-grid">
    <div class="summary-card">
      <div class="summary-label">Total Sales</div>
      <div class="summary-val">₹${result.summary.totalSales.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
      <div class="summary-sub">${result.summary.validOrdersCount} valid orders</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Total Quantity</div>
      <div class="summary-val">${result.summary.totalQty.toLocaleString('en-IN')} units</div>
      <div class="summary-sub">${result.summary.uniqueProductsCount} distinct products</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Primary Foods</div>
      <div class="summary-val">₹${result.summary.primarySales.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
      <div class="summary-sub">${result.summary.primaryQty.toLocaleString('en-IN')} units</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Bakery Foods</div>
      <div class="summary-val">₹${result.summary.bakerySales.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
      <div class="summary-sub">${result.summary.bakeryQty.toLocaleString('en-IN')} units</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 35px; text-align: center;">Rank</th>
        <th>Product Name</th>
        <th style="width: 70px; text-align: center;">Division</th>
        <th style="width: 45px; text-align: center;">Unit</th>
        <th style="width: 80px; text-align: right;">Qty Sold</th>
        <th style="width: 85px; text-align: right;">Avg Price</th>
        <th style="width: 105px; text-align: right;">Sales Total</th>
        <th style="width: 65px; text-align: right;">Share</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml || '<tr><td colspan="8" style="text-align: center; padding: 20px; color: #6b7280;">No sales found for the selected period.</td></tr>'}
    </tbody>
    <tfoot>
      <tr>
        <td style="text-align: center;">-</td>
        <td>TOTAL (${result.summary.uniqueProductsCount} Products)</td>
        <td style="text-align: center;">-</td>
        <td style="text-align: center;">-</td>
        <td style="text-align: right;">${result.summary.totalQty.toLocaleString('en-IN')}</td>
        <td style="text-align: right;">₹${result.summary.totalQty > 0 ? (result.summary.totalSales / result.summary.totalQty).toFixed(2) : '0.00'}</td>
        <td style="text-align: right;">₹${result.summary.totalSales.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
        <td style="text-align: right;">100.0%</td>
      </tr>
    </tfoot>
  </table>

  <div class="footer">
    Daily Fresh ERP • Authoritative Product Sales Report • Subtotals Reconciled: ${result.summary.isReconciled ? '✓ Verified' : '⚠ Discrepancy'}
  </div>
</body>
</html>
  `;
}

/**
 * Triggers safe print view across Web, Windows Electron, and Android Webview.
 */
export function printSalesReport(result: SalesReportResult, filter: SalesReportFilter): void {
  const html = renderSalesReportPrintHtml(result, filter);
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups to print the sales report.');
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 350);
}
