/**
 * Daily Fresh ERP — Central CSV Export Engine
 *
 * Provides RFC 4180 compliant CSV generation, Excel UTF-8 BOM encoding,
 * spreadsheet formula injection protection, and financial total reconciliation.
 *
 * Applicable for:
 * 1. Staff Collections Export (Feature 3A)
 * 2. Expense Tracker Export (Feature 3B)
 */

import { format } from 'date-fns';
import { type Payment, type PaymentMethod, type Division, type User } from '../types';
import { type ExpenseDocument } from '../types/expense.types';

// ============================================================================
// 1. Core Security & Sanitization Helpers
// ============================================================================

/**
 * Sanitizes a cell value for CSV export according to RFC 4180
 * with OWASP-compliant protection against spreadsheet formula injection (=, +, -, @, \t, \r).
 *
 * - Null/Undefined -> empty quoted string ""
 * - Numbers -> standard numeric representation
 * - Formula trigger characters (=, +, -, @, \t, \r) -> prepended with ' (single quote)
 * - Quotes, commas, newlines -> properly escaped with RFC 4180 doubled quotes
 */
export function sanitizeCsvCell(val: unknown): string {
  if (val === null || val === undefined) {
    return '""';
  }

  if (typeof val === 'number') {
    return isNaN(val) ? '0' : String(val);
  }

  if (typeof val === 'boolean') {
    return val ? 'Yes' : 'No';
  }

  let str = String(val);
  const trimmed = str.trim();

  // If the trimmed string is a pure decimal number (e.g. "123.45" or "-50.00" without + or formula chars)
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed;
  }

  // Formula trigger character check (=, +, -, @, \t, \r) on either raw or trimmed string
  if (/^[=+\-@\t\r]/.test(str) || /^[=+\-@\t\r]/.test(trimmed)) {
    str = `'${str}`;
  }

  // RFC 4180 double-quote escaping
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Triggers safe CSV download in the browser with Excel-compatible UTF-8 BOM.
 */
export function triggerCsvDownload(csvContent: string, fileName: string): void {
  // \uFEFF is the UTF-8 Byte Order Mark (BOM) ensuring Excel opens UTF-8 properly
  const bomContent = csvContent.startsWith('\uFEFF') ? csvContent : '\uFEFF' + csvContent;
  const blob = new Blob([bomContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Formats an ISO or date string to human-readable date & time (Asia/Kolkata or local).
 */
export function formatDateTime(isoString?: string | null): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return format(d, 'yyyy-MM-dd HH:mm:ss');
  } catch {
    return isoString;
  }
}

/**
 * Formats an ISO or date string to human-readable date (yyyy-MM-dd).
 */
export function formatDateOnly(isoString?: string | null): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString.length === 10 ? `${isoString}T12:00:00` : isoString);
    if (isNaN(d.getTime())) return isoString.substring(0, 10);
    return format(d, 'yyyy-MM-dd');
  } catch {
    return isoString.substring(0, 10);
  }
}

// ============================================================================
// 2. FEATURE 3A: STAFF COLLECTIONS CSV EXPORT
// ============================================================================

export interface StaffCollectionExportOptions {
  /** Label for date filter / range (e.g. '2026-10-26', '2026-10', 'All_Time') */
  dateLabel: string;
  /** Active division filter: 'all' | 'primary' | 'bakery' */
  divisionFilter?: 'all' | 'primary' | 'bakery';
  /** Staff filter name or ID (e.g. 'All Staff', 'Rijash') */
  staffFilterLabel?: string;
  /** Known registered staff users for role resolution */
  staffUsers?: User[];
  /** Custom file prefix (default: 'Staff_Collections') */
  filePrefix?: string;
}

export interface StaffCollectionExportResult {
  csv: string;
  fileName: string;
  totalCollectedPaise: number;
  primaryAllocatedPaise: number;
  bakeryAllocatedPaise: number;
  totalCollected: number;
  primaryAllocated: number;
  bakeryAllocated: number;
  recordCount: number;
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  upi: 'UPI',
  cash: 'Cash',
  bank_transfer: 'Bank Transfer',
  card: 'Card',
};

/**
 * Calculates authoritative division allocation for a payment using integer paise.
 *
 * Reconciles strictly:
 * Primary Allocation (paise) + Bakery Allocation (paise) === Total Payment (paise)
 */
export function calculatePaymentAllocation(p: Payment): {
  amountPaise: number;
  primaryPaise: number;
  bakeryPaise: number;
} {
  const amountPaise = Math.round((p.amount || 0) * 100);

  if (p.division === 'primary') {
    if (p.appliedToOtherBill && p.appliedToOtherBill > 0) {
      const otherPaise = Math.round(p.appliedToOtherBill * 100);
      const bakeryPaise = Math.min(amountPaise, otherPaise);
      const primaryPaise = Math.max(0, amountPaise - bakeryPaise);
      return { amountPaise, primaryPaise, bakeryPaise };
    }
    return { amountPaise, primaryPaise: amountPaise, bakeryPaise: 0 };
  }

  if (p.division === 'bakery') {
    if (p.appliedToOtherBill && p.appliedToOtherBill > 0) {
      const otherPaise = Math.round(p.appliedToOtherBill * 100);
      const primaryPaise = Math.min(amountPaise, otherPaise);
      const bakeryPaise = Math.max(0, amountPaise - primaryPaise);
      return { amountPaise, primaryPaise, bakeryPaise };
    }
    return { amountPaise, primaryPaise: 0, bakeryPaise: amountPaise };
  }

  // Fallback for unclassified
  return { amountPaise, primaryPaise: amountPaise, bakeryPaise: 0 };
}

/**
 * Determines whether a payment was recorded by an Admin or Staff member,
 * and formats the collector name and role clearly.
 */
export function resolveCollectorIdentity(
  p: Payment,
  staffUsers?: User[]
): {
  collectorName: string;
  collectorId: string;
  collectorRole: 'Admin' | 'Staff';
  isIdentifiedAsAdmin: boolean;
} {
  const rawStaffName = p.staffName || p.recordedBy || p.updatedBy || '';
  const rawStaffId = p.staffId || '';

  // Check if staffUsers was provided
  const isRegisteredStaff = staffUsers
    ? staffUsers.some(
        (s) =>
          (rawStaffId && s.uid === rawStaffId) ||
          (rawStaffName && s.name.toLowerCase() === rawStaffName.toLowerCase())
      )
    : false;

  const isAdminName =
    rawStaffName.toLowerCase().includes('admin') ||
    rawStaffId.toLowerCase().includes('admin') ||
    (!isRegisteredStaff && (!rawStaffId || rawStaffId === 'admin'));

  if (isAdminName || !isRegisteredStaff) {
    // If not matching any registered staff user, clearly identify as Admin
    const cleanName = rawStaffName || 'Admin';
    const display = cleanName.toLowerCase().includes('admin') ? cleanName : `${cleanName} (Admin)`;
    return {
      collectorName: display,
      collectorId: rawStaffId || 'admin',
      collectorRole: 'Admin',
      isIdentifiedAsAdmin: true,
    };
  }

  return {
    collectorName: rawStaffName || 'Staff',
    collectorId: rawStaffId,
    collectorRole: 'Staff',
    isIdentifiedAsAdmin: false,
  };
}

/**
 * Generates Staff Collections CSV content conforming to all RFC 4180, Excel BOM,
 * and formula injection safeguards.
 */
export function generateStaffCollectionsCsv(
  payments: Payment[],
  options: StaffCollectionExportOptions
): StaffCollectionExportResult {
  const {
    dateLabel,
    divisionFilter = 'all',
    staffFilterLabel = 'All Staff',
    staffUsers,
    filePrefix = 'Staff_Collections',
  } = options;

  let totalCollectedPaise = 0;
  let primaryAllocatedPaise = 0;
  let bakeryAllocatedPaise = 0;

  // Sanitize dateLabel for filename
  const cleanDateLabel = (dateLabel || 'All_Time').replace(/[^a-zA-Z0-9_\-]/g, '_');
  const fileName = `${filePrefix}_${cleanDateLabel}.csv`;

  const headers = [
    sanitizeCsvCell('Collection Date & Time'),
    sanitizeCsvCell('Delivery / Bill Date'),
    sanitizeCsvCell('Collector Name'),
    sanitizeCsvCell('Collector Role'),
    sanitizeCsvCell('Collector ID'),
    sanitizeCsvCell('Customer Name'),
    sanitizeCsvCell('Customer ID'),
    sanitizeCsvCell('Payment ID'),
    sanitizeCsvCell('Payment Reference'),
    sanitizeCsvCell('Payment Method'),
    sanitizeCsvCell('Total Collected (INR)'),
    sanitizeCsvCell('Primary Foods Allocated (INR)'),
    sanitizeCsvCell('Bakery Foods Allocated (INR)'),
    sanitizeCsvCell('Related Invoices / Orders'),
    sanitizeCsvCell('Payment Correction Status'),
  ];

  const dataRows: string[] = [];

  for (const p of payments) {
    if (p.deletedAt) continue;

    const { amountPaise, primaryPaise, bakeryPaise } = calculatePaymentAllocation(p);
    totalCollectedPaise += amountPaise;
    primaryAllocatedPaise += primaryPaise;
    bakeryAllocatedPaise += bakeryPaise;

    const collector = resolveCollectorIdentity(p, staffUsers);

    // Collection Date & Time
    const collectionDateTime = formatDateTime(p.createdAt || p.paymentDate);

    // Delivery / Bill Date
    const billDate = formatDateOnly(p.billDate || p.paymentDate || p.createdAt);

    // Customer
    const isDirect = p.orderType === 'direct' || p.clientId === 'direct';
    const customerName = isDirect ? 'Direct Sale' : (p.clientName || '—');
    const customerId = p.clientId || '—';

    // Payment Reference / Notes
    const reference = p.reference ? p.reference : (p.notes ? p.notes : '—');

    // Method
    const methodDisplay = METHOD_LABELS[p.method] || p.method || 'Cash';

    // Related Invoices
    const invoices: string[] = [];
    if (p.invoiceId) invoices.push(p.invoiceId);
    if (p.otherInvoiceId) invoices.push(p.otherInvoiceId);
    const relatedInvoices = invoices.length > 0 ? invoices.join(', ') : '—';

    // Correction Status
    let correctionStatus = 'Original';
    if (p.isCorrected) {
      const orig = typeof p.originalAmount === 'number' ? `Original: INR ${p.originalAmount.toFixed(2)}` : 'Original';
      const reason = p.correctionReason ? ` Reason: ${p.correctionReason}` : '';
      correctionStatus = `Corrected (${orig}${reason})`;
    }

    const row = [
      sanitizeCsvCell(collectionDateTime),
      sanitizeCsvCell(billDate),
      sanitizeCsvCell(collector.collectorName),
      sanitizeCsvCell(collector.collectorRole),
      sanitizeCsvCell(collector.collectorId),
      sanitizeCsvCell(customerName),
      sanitizeCsvCell(customerId),
      sanitizeCsvCell(p.id),
      sanitizeCsvCell(reference),
      sanitizeCsvCell(methodDisplay),
      (amountPaise / 100).toFixed(2),
      (primaryPaise / 100).toFixed(2),
      (bakeryPaise / 100).toFixed(2),
      sanitizeCsvCell(relatedInvoices),
      sanitizeCsvCell(correctionStatus),
    ];

    dataRows.push(row.join(','));
  }

  // Summary footer metadata
  const totalCollected = totalCollectedPaise / 100;
  const primaryAllocated = primaryAllocatedPaise / 100;
  const bakeryAllocated = bakeryAllocatedPaise / 100;

  const lines: string[] = [
    // Report Title & Metadata Header
    `"Daily Fresh ERP — Staff Collection Report"`,
    `"Generated At","${formatDateTime(new Date().toISOString())}"`,
    `"Period / Date Filter","${dateLabel || 'All Records'}"`,
    `"Division Filter","${divisionFilter === 'primary' ? 'Primary Foods Only' : divisionFilter === 'bakery' ? 'Bakery Foods Only' : 'All Divisions'}"`,
    `"Staff / Collector Selection","${staffFilterLabel}"`,
    `"Total Records Exported","${payments.length}"`,
    `""`,
    // Summary Banner
    `"SUMMARY TOTALS"`,
    `"Total Collected Amount (INR)","${totalCollected.toFixed(2)}"`,
    `"Primary Foods Allocated (INR)","${primaryAllocated.toFixed(2)}"`,
    `"Bakery Foods Allocated (INR)","${bakeryAllocated.toFixed(2)}"`,
    `"Allocation Reconciled","${primaryAllocatedPaise + bakeryAllocatedPaise === totalCollectedPaise ? 'YES' : 'NO'}"`,
    `""`,
    // Headers & Rows
    headers.join(','),
    ...dataRows,
    `""`,
    // Bottom Totals Row
    [
      `"TOTAL"`,
      `"-"`,
      `"-"`,
      `"-"`,
      `"-"`,
      `"-"`,
      `"-"`,
      `"-"`,
      `"-"`,
      `"-"`,
      totalCollected.toFixed(2),
      primaryAllocated.toFixed(2),
      bakeryAllocated.toFixed(2),
      `"-"`,
      `"-"`,
    ].join(','),
  ];

  const csv = '\uFEFF' + lines.join('\r\n');

  return {
    csv,
    fileName,
    totalCollectedPaise,
    primaryAllocatedPaise,
    bakeryAllocatedPaise,
    totalCollected,
    primaryAllocated,
    bakeryAllocated,
    recordCount: payments.length,
  };
}

/**
 * Triggers export of Staff Collections CSV.
 */
export function downloadStaffCollectionsCsv(
  payments: Payment[],
  options: StaffCollectionExportOptions
): StaffCollectionExportResult {
  const result = generateStaffCollectionsCsv(payments, options);
  triggerCsvDownload(result.csv, result.fileName);
  return result;
}

// ============================================================================
// 3. FEATURE 3B: ALL EXPENSES CSV EXPORT
// ============================================================================

export interface ExpenseExportOptions {
  /** User is admin */
  isAdmin: boolean;
  /** Period / date description (e.g. '2026-10-26', '2026-10', 'All_Time') */
  dateLabel: string;
  /** Active category filter */
  categoryFilter?: string;
  /** Include voided expenses (only valid for Admin) */
  includeVoided?: boolean;
  /** Custom file prefix (default: 'Expenses') */
  filePrefix?: string;
}

export interface ExpenseExportResult {
  csv: string;
  fileName: string;
  activeTotalAmount: number;
  activeCount: number;
  voidedCount: number;
  totalRecords: number;
}

/**
 * Generates All Expenses CSV content conforming to all RFC 4180, Excel BOM,
 * and formula injection safeguards.
 *
 * Strictly ensures:
 * - Voided expenses are never included in active financial totals.
 * - Admin can export voided expenses when explicitly enabled.
 * - Sensitive audit records are preserved without mutating source data.
 */
export function generateExpensesCsv(
  expenses: ExpenseDocument[],
  options: ExpenseExportOptions
): ExpenseExportResult {
  const {
    isAdmin,
    dateLabel,
    categoryFilter = 'all',
    includeVoided = false,
    filePrefix = 'Expenses',
  } = options;

  let activeTotalPaise = 0;
  let activeCount = 0;
  let voidedCount = 0;

  const cleanDateLabel = (dateLabel || 'All_Time').replace(/[^a-zA-Z0-9_\-]/g, '_');
  const fileName = `${filePrefix}_${cleanDateLabel}.csv`;

  const headers = [
    sanitizeCsvCell('Expense Date'),
    sanitizeCsvCell('Expense ID'),
    sanitizeCsvCell('Category'),
    sanitizeCsvCell('Description'),
    sanitizeCsvCell('Amount (INR)'),
    sanitizeCsvCell('Payment Method'),
    sanitizeCsvCell('Recorded By'),
    sanitizeCsvCell('Role / Operator Attribution'),
    sanitizeCsvCell('Created Timestamp'),
    sanitizeCsvCell('Updated Timestamp'),
    sanitizeCsvCell('Status'),
    sanitizeCsvCell('Void Reason'),
    sanitizeCsvCell('Voided By'),
    sanitizeCsvCell('Voided At'),
  ];

  const dataRows: string[] = [];

  for (const exp of expenses) {
    const isVoided = Boolean(exp.isVoided);

    // If voided and user is not admin or export did not request voided, skip
    if (isVoided && (!isAdmin || !includeVoided)) {
      continue;
    }

    if (isVoided) {
      voidedCount += 1;
    } else {
      activeCount += 1;
      activeTotalPaise += Math.round(exp.amount * 100);
    }

    // Role / Attribution
    const roleAttribution =
      exp.creatorRole === 'admin'
        ? `Admin (${exp.adminName || exp.creatorName || 'Admin'})`
        : 'Staff';

    // Recorded By
    const recordedBy = exp.creatorName || exp.createdBy || 'Staff';

    // Description (customExpenseName or notes)
    const description = exp.customExpenseName || exp.notes || '—';

    // Payment method
    const paymentMethod = (exp as any).paymentMethod || 'Cash';

    // Void details
    const status = isVoided ? 'Voided' : 'Active';
    const voidReason = isVoided ? (exp.voidReason || '—') : '—';
    const voidedBy = isVoided
      ? (exp.voidedByName || exp.voidedByAdminName || exp.voidedByUid || 'Admin')
      : '—';
    const voidedAt = isVoided ? formatDateTime(exp.voidedAt) : '—';

    const row = [
      sanitizeCsvCell(exp.businessDay),
      sanitizeCsvCell(exp.id),
      sanitizeCsvCell(exp.category),
      sanitizeCsvCell(description),
      exp.amount.toFixed(2),
      sanitizeCsvCell(paymentMethod),
      sanitizeCsvCell(recordedBy),
      sanitizeCsvCell(roleAttribution),
      sanitizeCsvCell(formatDateTime(exp.createdAt)),
      sanitizeCsvCell(exp.updatedAt ? formatDateTime(exp.updatedAt) : '—'),
      sanitizeCsvCell(status),
      sanitizeCsvCell(voidReason),
      sanitizeCsvCell(voidedBy),
      sanitizeCsvCell(voidedAt),
    ];

    dataRows.push(row.join(','));
  }

  const activeTotalAmount = activeTotalPaise / 100;
  const totalRecords = activeCount + voidedCount;

  const lines: string[] = [
    // Header metadata
    `"Daily Fresh ERP — Expense Tracker Export"`,
    `"Generated At","${formatDateTime(new Date().toISOString())}"`,
    `"Period / Date Filter","${dateLabel || 'All Records'}"`,
    `"Category Filter","${categoryFilter === 'all' ? 'All Categories' : categoryFilter}"`,
    `"Included Voided Expenses","${includeVoided && isAdmin ? 'YES (Audit Filter Active)' : 'NO (Active Expenses Only)'}"`,
    `"Total Exported Records","${totalRecords}"`,
    `""`,
    // Summary Banner
    `"FINANCIAL SUMMARY (ACTIVE EXPENSES ONLY)"`,
    `"Active Expense Total (INR)","${activeTotalAmount.toFixed(2)}"`,
    `"Active Records Count","${activeCount}"`,
    `"Voided Records Count (Excluded from Total)","${voidedCount}"`,
    `""`,
    headers.join(','),
    ...dataRows,
    `""`,
    // Totals row
    [
      `"ACTIVE TOTAL"`,
      `"-"`,
      `"-"`,
      `"-"`,
      activeTotalAmount.toFixed(2),
      `"-"`,
      `"-"`,
      `"-"`,
      `"-"`,
      `"-"`,
      `"Active: ${activeCount} | Voided: ${voidedCount}"`,
      `"-"`,
      `"-"`,
      `"-"`,
    ].join(','),
  ];

  const csv = '\uFEFF' + lines.join('\r\n');

  return {
    csv,
    fileName,
    activeTotalAmount,
    activeCount,
    voidedCount,
    totalRecords,
  };
}

/**
 * Triggers export of All Expenses CSV.
 */
export function downloadExpensesCsv(
  expenses: ExpenseDocument[],
  options: ExpenseExportOptions
): ExpenseExportResult {
  const result = generateExpensesCsv(expenses, options);
  triggerCsvDownload(result.csv, result.fileName);
  return result;
}
