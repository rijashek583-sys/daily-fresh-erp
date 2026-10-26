import { type Order, type Client, type Payment, type Product, type LedgerTransaction } from '../types';
import { format } from 'date-fns';
import { calculateOldBalance, allocatePayment } from './billing';

// ── Company Details (Strictly Enforced) ──
export const COMPANY_NAME = 'Daily Fresh Food Products';
export const COMPANY_ADDRESS = 'Posoat, Manjeswar, Kasargode – 671323';
export const COMPANY_PHONE = 'Phone: 9072265888, 7907092583';
export const COMPANY_PHONE_NUMS = ['9072265888', '7907092583'];

export interface PrintOrderInvoiceOptions {
  order: Order;
  client?: Client | null;
  payments?: Payment[];
  /** Ledger postings are the authoritative source for invoice-level allocations. */
  ledger?: LedgerTransaction[];
  products?: Product[];
  previousBalance?: number;
  availableCredit?: number;
  primaryCredit?: number;
  bakeryCredit?: number;
}

export interface DailyBillInvoiceData {
  clientId: string;
  clientName: string;
  region: string;
  deliveryDate: string;
  billNumber: string;
  items: { productName: string; qty: number; unitPrice?: number; total: number; division?: string; unit?: string }[];
  subtotal: number;
  oldBalance?: number;
  grandTotal?: number;
  paidAmount?: number;
  outstandingBalance: number;
  primarySubtotal?: number;
  bakerySubtotal?: number;
  primaryOldBalance?: number;
  bakeryOldBalance?: number;
  primaryPaid?: number;
  bakeryPaid?: number;
  primaryReceived?: number;
  bakeryReceived?: number;
  primaryExcess?: number;
  bakeryExcess?: number;
  primaryCreditApplied?: number;
  bakeryCreditApplied?: number;
  primaryAppliedToBill?: number;
  primaryAppliedToPrevious?: number;
  primaryBillRemaining?: number;
  primaryPreviousRemaining?: number;
  bakeryAppliedToBill?: number;
  bakeryAppliedToPrevious?: number;
  bakeryBillRemaining?: number;
  bakeryPreviousRemaining?: number;
  primaryOutstanding?: number;
  bakeryOutstanding?: number;
  updatedInfo?: string | null;
  staffName?: string;
  invoiceId?: string;
  clientPhone?: string;
  clientAddress?: string;
}

/**
 * Normalized data structure for rendering the Unified Daily Fresh Invoice
 */
export interface UnifiedInvoiceData {
  billNumber: string;
  deliveryDate: string;
  isDirectSale: boolean;
  client: {
    name: string;
    region?: string;
    phone?: string;
    address?: string;
  };
  staffName?: string;
  notes?: string;
  updatedInfo?: string;
  divisionLabel: string;
  items: Array<{
    productName: string;
    qty: number;
    unit?: string;
    unitPrice?: number;
    rate?: number;
    total: number;
    division?: string;
  }>;
  // Authoritative Financial Summary (Strictly Reconciled)
  subtotal: number;
  previousOutstanding?: number;
  previousAvailableCredit?: number;
  creditApplied: number;
  netDue: number;
  paymentReceivedForBill?: number;
  totalPaid: number;
  appliedToBill?: number;
  appliedToPrevious?: number;
  excessAddedToCredit?: number;
  billRemaining: number;
  availableCreditAfterBill?: number;
  totalOutstanding: number;
  statusText: string;
  statusBadgeClass: string;

  // Legacy compatibility fields
  previousBalance: number;
  remainingPreviousBalance?: number;
  hasAdvanceCredit: boolean;
  primaryAdvanceCredit?: number;
  bakeryAdvanceCredit?: number;
  totalAdvanceCredit: number;
  /** Present when payment postings cannot be attributed to this invoice safely. */
  allocationWarning?: string;
  discount?: number;
  tax?: number;

  // Multi-division breakdown if applicable
  divisionBreakdown?: {
    primary?: {
      subtotal: number;
      creditApplied?: number;
      netDue: number;
      paid?: number;
      appliedToBill?: number;
      appliedToPrevious?: number;
      previousBalance?: number;
      remainingPrevious?: number;
      outstanding: number;
      excessCredit?: number;
    };
    bakery?: {
      subtotal: number;
      creditApplied?: number;
      netDue: number;
      paid?: number;
      appliedToBill?: number;
      appliedToPrevious?: number;
      previousBalance?: number;
      remainingPrevious?: number;
      outstanding: number;
      excessCredit?: number;
    };
  };
}

/**
 * Modern, responsive CSS for the unified Daily Fresh invoice
 */
function getInvoiceStyles(): string {
  return `
    *, *::before, *::after { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      margin: 0;
      padding: 0;
      background: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      font-size: 13px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    .invoice-shell {
      padding-top: 64px;
      padding-bottom: 40px;
      min-height: 100vh;
    }
    .invoice-card {
      max-width: 820px;
      margin: 0 auto;
      background: #ffffff;
      padding: 36px 40px;
      border-radius: 12px;
      box-shadow: 0 4px 25px -4px rgba(15, 23, 42, 0.08);
      border: 1px solid #e2e8f0;
      border-top: 5px solid #b91c1c;
    }
    
    /* ── Floating Action Bar (Screen Only) ── */
    .action-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 52px;
      background: #0f172a;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      z-index: 9999;
      box-shadow: 0 2px 12px rgba(0,0,0,0.25);
    }
    .bar-brand {
      font-weight: 800;
      font-size: 13px;
      letter-spacing: 0.3px;
      color: #f8fafc;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .bar-brand .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #dc2626;
      box-shadow: 0 0 8px #dc2626;
    }
    .bar-buttons {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn-act {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      font-size: 12px;
      font-weight: 700;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.15s ease;
      user-select: none;
    }
    .btn-act:hover { opacity: 0.92; transform: translateY(-0.5px); }
    .btn-act:active { transform: translateY(0); }
    .btn-print { background: #b91c1c; color: #ffffff; }
    .btn-jpg { background: #2563eb; color: #ffffff; }
    .btn-jpg:hover { background: #1d4ed8; }
    .btn-wa { background: #16a34a; color: #ffffff; }
    .btn-close { background: #334155; color: #cbd5e1; padding: 7px 10px; }
    .btn-text-short { display: none; }
    .btn-text-full { display: inline; }

    #share-feedback-banner {
      position: fixed;
      top: 52px;
      left: 0;
      right: 0;
      z-index: 9998;
      padding: 10px 16px;
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      animation: bannerSlideDown 0.2s ease-out;
    }
    #share-feedback-banner.success {
      background: #065f46;
      color: #ecfdf5;
    }
    #share-feedback-banner.info {
      background: #1e293b;
      color: #f8fafc;
      border-bottom: 2px solid #2563eb;
    }
    #share-feedback-banner .btn-banner-action {
      background: #22c55e;
      color: #0f172a;
      font-weight: 800;
      font-size: 12px;
      padding: 6px 14px;
      border-radius: 6px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }
    #share-feedback-banner .btn-banner-action:hover {
      background: #16a34a;
      color: #ffffff;
    }
    #share-feedback-banner .btn-banner-close {
      background: transparent;
      border: none;
      color: #94a3b8;
      font-size: 16px;
      cursor: pointer;
      padding: 0 4px;
      line-height: 1;
    }
    #share-feedback-banner .btn-banner-close:hover {
      color: #ffffff;
    }
    @keyframes bannerSlideDown {
      from { transform: translateY(-100%); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    /* ── Header ── */
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 18px;
      margin-bottom: 18px;
      gap: 16px;
    }
    .brand-col {
      display: flex;
      align-items: flex-start;
      gap: 14px;
    }
    .brand-title {
      font-size: 20px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.3px;
      line-height: 1.2;
    }
    .brand-address {
      font-size: 11px;
      font-weight: 500;
      color: #475569;
      margin-top: 2px;
      line-height: 1.4;
    }
    .brand-contact {
      font-size: 11px;
      font-weight: 700;
      color: #b91c1c;
      margin-top: 2px;
    }
    .meta-col {
      text-align: right;
      flex-shrink: 0;
    }
    .meta-type {
      font-size: 18px;
      font-weight: 800;
      letter-spacing: -0.3px;
      color: #0f172a;
      margin: 0 0 2px 0;
    }
    .meta-bill-no {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      font-weight: 800;
      color: #b91c1c;
      margin: 0 0 2px 0;
    }
    .meta-date {
      font-size: 11px;
      color: #475569;
      font-weight: 600;
      margin: 0 0 6px 0;
    }
    .meta-pills {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      flex-wrap: wrap;
    }
    .badge-status {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .badge-paid { background: #dcfce7; color: #15803d; border: 1px solid #86efac; }
    .badge-partial { background: #fef3c7; color: #b45309; border: 1px solid #fcd34d; }
    .badge-pending { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
    .badge-div-primary { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
    .badge-div-bakery { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
    .badge-div-dual { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; }

    /* ── Client & Route Staff Card ── */
    .client-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 18px;
      margin-bottom: 18px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }
    .client-tag {
      font-size: 9px;
      font-weight: 800;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      margin-bottom: 2px;
    }
    .client-name {
      font-size: 15px;
      font-weight: 800;
      color: #0f172a;
      text-transform: uppercase;
      margin: 0 0 3px 0;
      line-height: 1.25;
    }
    .client-details {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      font-size: 11px;
      color: #475569;
      font-weight: 500;
    }
    .client-pill {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      padding: 1px 6px;
      font-weight: 600;
    }
    .client-meta-col {
      text-align: right;
      font-size: 11px;
      color: #475569;
      line-height: 1.4;
    }
    .staff-name {
      font-size: 12px;
      font-weight: 800;
      color: #0f172a;
    }
    .staff-notes {
      font-size: 10px;
      font-style: italic;
      color: #64748b;
      margin-top: 2px;
    }

    /* ── Items Table ── */
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
      table-layout: fixed;
    }
    .items-table th {
      background: #f1f5f9;
      color: #475569;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 8px 10px;
      border-top: 1px solid #e2e8f0;
      border-bottom: 1px solid #cbd5e1;
      text-align: left;
    }
    .items-table th.text-right { text-align: right; }
    .items-table th.text-center { text-align: center; }
    .items-table td {
      padding: 7px 10px;
      border-bottom: 1px solid #f1f5f9;
      font-size: 12px;
      color: #1e293b;
      vertical-align: middle;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    .items-table td.text-right {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .items-table td.text-center { text-align: center; }
    .items-table tbody tr.item-row:nth-child(even) {
      background: #fbfbfc;
    }
    .item-num { color: #64748b; font-size: 11px; font-weight: 600; }
    .item-name { font-weight: 700; color: #0f172a; line-height: 1.35; font-size: 12px; }
    .item-qty { font-weight: 700; color: #1e293b; font-size: 12px; }
    .item-unit { color: #64748b; font-size: 10px; font-weight: 500; margin-left: 2px; }
    .item-rate {
      color: #64748b;
      font-size: 11px;
      font-weight: 600;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .item-total {
      font-weight: 800;
      color: #0f172a;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
    }

    .div-section-tr td {
      padding: 8px 10px 4px 10px;
      background: #ffffff;
      border-bottom: none;
      border-top: none;
    }
    .div-header-pill {
      display: inline-flex;
      align-items: center;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .pill-primary { background: #eff6ff; color: #1d4ed8; }
    .pill-bakery { background: #fffbeb; color: #b45309; }
    .subtotal-row td {
      background: #f8fafc;
      font-weight: 700;
      border-top: 1px solid #f1f5f9;
      border-bottom: 1px solid #e2e8f0;
      font-size: 11px;
      padding: 6px 10px;
    }
    .subtotal-primary { color: #1d4ed8; }
    .subtotal-bakery { color: #b45309; }

    /* ── Summary Layout ── */
    .summary-wrapper {
      margin-top: 14px;
    }
    .summary-table-wrap {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 12px;
    }
    .summary-table {
      width: 380px;
      border-collapse: collapse;
    }
    .summary-table td {
      padding: 4px 0;
      font-size: 12px;
      border: none;
    }
    .summary-table .lbl {
      color: #64748b;
      font-weight: 500;
      font-size: 12px;
    }
    .summary-table .lbl.indent {
      padding-left: 14px;
      font-size: 11px;
      color: #166534;
    }
    .summary-table .val {
      text-align: right;
      font-weight: 700;
      color: #0f172a;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
    }
    .text-credit { color: #15803d !important; }
    .text-credit-sub { color: #166534 !important; font-size: 11px; }
    .text-amber { color: #d97706 !important; }
    
    /* ── Prominent TOTAL OUTSTANDING Banner ── */
    .grand-banner {
      background: #fef2f2;
      border: 1.5px solid #fca5a5;
      border-radius: 8px;
      padding: 12px 20px;
      margin-top: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .grand-banner.banner-paid {
      background: #f0fdf4;
      border-color: #86efac;
    }
    .grand-lbl {
      font-size: 13px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #991b1b;
      line-height: 1.2;
    }
    .grand-banner.banner-paid .grand-lbl { color: #166534; }
    .grand-val {
      font-size: 24px;
      font-weight: 900;
      color: #991b1b;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .grand-banner.banner-paid .grand-val { color: #166534; }

    /* ── Footer ── */
    .invoice-footer {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid #e2e8f0;
      text-align: center;
      font-size: 10px;
      color: #64748b;
      line-height: 1.6;
    }
    .invoice-footer p { margin: 2px 0; }
    .footer-highlight { font-weight: 700; color: #0f172a; font-size: 11px; }
    .footer-brand { color: #b91c1c; font-weight: 800; }

    /* ── Mobile Optimization (Screen < 640px) ── */
    @media screen and (max-width: 640px) {
      .invoice-shell { padding-top: 58px; padding-bottom: 20px; }
      .invoice-card { padding: 16px 14px; border-radius: 0; border: none; border-top: 5px solid #b91c1c; box-shadow: none; }
      .header-row { flex-direction: column; align-items: stretch; gap: 12px; }
      .meta-col { text-align: left; }
      .meta-pills { justify-content: flex-start; }
      .client-card { flex-direction: column; gap: 10px; }
      .client-meta-col { text-align: left; }
      .summary-table-wrap { justify-content: stretch; }
      .summary-table { width: 100%; }
      .items-table td, .items-table th { padding: 8px 6px; font-size: 11px; }
      .brand-title { font-size: 18px; }
      .btn-act { padding: 6px 9px; font-size: 11px; gap: 4px; }
      .bar-brand { display: none; }
      .bar-buttons { width: 100%; justify-content: space-between; gap: 4px; }
      .action-bar { padding: 0 8px; }
      .btn-text-full { display: none; }
      .btn-text-short { display: inline; }
      #share-feedback-banner { top: 52px; font-size: 12px; padding: 8px 12px; flex-direction: column; align-items: stretch; text-align: center; }
    }

    /* ── Print / PDF Styles ── */
    @page {
      size: A4 portrait;
      margin: 10mm 10mm 10mm 10mm;
    }
    @media print {
      .no-print { display: none !important; }
      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      html, body {
        background: #ffffff !important;
        margin: 0 !important;
        padding: 0 !important;
        font-size: 10pt !important;
        color: #0f172a !important;
      }
      .invoice-shell {
        padding: 0 !important;
        min-height: auto !important;
      }
      .invoice-card {
        max-width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
        border-top: 5px solid #b91c1c !important;
        box-shadow: none !important;
        border-radius: 0 !important;
      }
      .items-table { page-break-inside: auto !important; }
      thead { display: table-header-group !important; }
      tr {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      .avoid-break {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      .invoice-footer { margin-top: 20px; padding-top: 12px; }
    }
  `;
}

/**
 * Builds the floating action bar HTML with Print, JPG image share, WhatsApp share, and Close buttons.
 */
function buildActionBarHtml(billNumber: string): string {
  return `
    <div class="no-print action-bar">
      <div class="bar-brand">
        <span class="dot"></span>
        <span>Daily Fresh · ${billNumber}</span>
      </div>
      <div class="bar-buttons">
        <button type="button" class="btn-act btn-print" onclick="window.print()" title="Print or save as PDF">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          <span class="btn-text-full">Print / PDF</span>
          <span class="btn-text-short">Print</span>
        </button>
        <button type="button" class="btn-act btn-jpg" id="btn-share-jpg" onclick="shareAsJpg()" title="Share bill as high-quality JPG image">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <span class="btn-text-full">Share as Image (JPG)</span>
          <span class="btn-text-short">Share JPG</span>
        </button>
        <button type="button" class="btn-act btn-wa" onclick="shareOnWhatsApp()" title="Share invoice summary on WhatsApp">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          <span class="btn-text-full">Share WhatsApp</span>
          <span class="btn-text-short">WhatsApp</span>
        </button>
        <button type="button" class="btn-act btn-close" onclick="window.close()" title="Close window">✕</button>
      </div>
    </div>
    <div id="share-feedback-banner" class="no-print"></div>
  `;
}

function getInvoiceCanvasScript(): string {
  return `
    function roundRect(ctx, x, y, width, height, radius) {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    }

    function wrapText(ctx, text, maxWidth) {
      var words = (text || '').split(' ');
      var lines = [];
      var currentLine = '';
      for (var i = 0; i < words.length; i++) {
        var word = words[i];
        var testLine = currentLine ? (currentLine + ' ' + word) : word;
        var testWidth = ctx.measureText(testLine).width;
        if (testWidth > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) lines.push(currentLine);
      return lines.length > 0 ? lines : [text || ''];
    }

    function renderInvoiceCanvas(data) {
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get 2d context');

      var logicalWidth = 800;
      var scale = 2;

      var items = data.items || [];
      var primaryItems = items.filter(function(i) { return i.division === 'primary'; });
      var bakeryItems = items.filter(function(i) { return i.division === 'bakery'; });
      var isMultiDiv = primaryItems.length > 0 && bakeryItems.length > 0;
      var hasAnyRate = items.some(function(i) { return (i.rate && i.rate > 0) || (i.unitPrice && i.unitPrice > 0); });

      var baseHeaderHeight = 160;
      var clientCardHeight = 90;
      var tableHeaderHeight = 36;
      var itemRowHeight = 30;
      var itemsCount = items.length;
      var sectionHeadersHeight = isMultiDiv ? 76 : 0;
      var tableHeight = tableHeaderHeight + (itemsCount * itemRowHeight) + sectionHeadersHeight;

      var summaryHeight = 60;
      summaryHeight += 22; // Items Subtotal
      if (data.discount && data.discount > 0) summaryHeight += 20;
      if (data.tax && data.tax > 0) summaryHeight += 20;
      if (data.previousOutstanding > 0) summaryHeight += 22;
      if (data.previousAvailableCredit > 0) summaryHeight += 22;
      if (data.creditApplied > 0) summaryHeight += 22;
      var payForBill = Number(data.paymentReceivedForBill !== undefined ? data.paymentReceivedForBill : (data.appliedToBill || 0));
      var totPaid = Number(data.totalPaid || 0);
      if (totPaid > 0 || payForBill > 0) {
        summaryHeight += 22;
        if (data.appliedToPrevious && data.appliedToPrevious > 0) summaryHeight += 20;
        var excessCreditVal = Number(data.excessAddedToCredit !== undefined ? data.excessAddedToCredit : Math.max(0, totPaid - payForBill - Number(data.appliedToPrevious || 0)));
        if (excessCreditVal > 0.01) summaryHeight += 20;
      }
      summaryHeight += 22; // This Bill Remaining
      if (data.availableCreditAfterBill > 0) summaryHeight += 22;

      var grandBannerHeight = 54;
      var footerHeight = 85;
      var padding = 50;

      var logicalHeight = baseHeaderHeight + clientCardHeight + tableHeight + summaryHeight + grandBannerHeight + footerHeight + padding;

      canvas.width = logicalWidth * scale;
      canvas.height = logicalHeight * scale;
      ctx.scale(scale, scale);

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, logicalWidth, logicalHeight);

      ctx.fillStyle = '#B91C1C';
      ctx.fillRect(0, 0, logicalWidth, 6);

      var curY = 32;

      // Header
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(${JSON.stringify(COMPANY_NAME)}, 36, curY);

      ctx.fillStyle = '#475569';
      ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(${JSON.stringify(COMPANY_ADDRESS)}, 36, curY + 18);

      ctx.fillStyle = '#B91C1C';
      ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(${JSON.stringify(COMPANY_PHONE)}, 36, curY + 34);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText('BILL / INVOICE', logicalWidth - 36, curY);

      ctx.fillStyle = '#B91C1C';
      ctx.font = 'bold 13px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText('#' + data.billNumber, logicalWidth - 36, curY + 18);

      ctx.fillStyle = '#475569';
      ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText('Date: ' + data.deliveryDate, logicalWidth - 36, curY + 34);

      var statusX = logicalWidth - 36;
      var pillY = curY + 44;
      var isPaid = data.totalOutstanding <= 0.01;
      var statusBg = isPaid ? '#DCFCE7' : (data.totalPaid > 0 ? '#FEF3C7' : '#FEE2E2');
      var statusTextColor = isPaid ? '#166534' : (data.totalPaid > 0 ? '#B45309' : '#991B1B');
      var statusLabel = data.statusText || (isPaid ? 'PAID' : 'PENDING');

      ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      var statusWidth = ctx.measureText(statusLabel).width + 16;
      roundRect(ctx, statusX - statusWidth, pillY, statusWidth, 20, 4);
      ctx.fillStyle = statusBg;
      ctx.fill();
      ctx.fillStyle = statusTextColor;
      ctx.textAlign = 'center';
      ctx.fillText(statusLabel, statusX - statusWidth / 2, pillY + 14);

      var divLabel = data.divisionLabel || 'Primary Foods';
      var divBg = divLabel.indexOf('Primary') !== -1 && divLabel.indexOf('Bakery') !== -1 ? '#F1F5F9' : (divLabel.indexOf('Bakery') !== -1 ? '#FFFBEB' : '#EFF6FF');
      var divTextColor = divLabel.indexOf('Primary') !== -1 && divLabel.indexOf('Bakery') !== -1 ? '#334155' : (divLabel.indexOf('Bakery') !== -1 ? '#B45309' : '#1D4ED8');
      var divWidth = ctx.measureText(divLabel).width + 16;
      var divX = statusX - statusWidth - 8 - divWidth;

      roundRect(ctx, divX, pillY, divWidth, 20, 4);
      ctx.fillStyle = divBg;
      ctx.fill();
      ctx.fillStyle = divTextColor;
      ctx.fillText(divLabel, divX + divWidth / 2, pillY + 14);

      curY += 80;

      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(36, curY);
      ctx.lineTo(logicalWidth - 36, curY);
      ctx.stroke();

      curY += 14;

      // Client Card
      var cardY = curY;
      var cardH = 76;
      roundRect(ctx, 36, cardY, logicalWidth - 72, cardH, 8);
      ctx.fillStyle = '#F8FAFC';
      ctx.fill();
      ctx.strokeStyle = '#E2E8F0';
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillStyle = '#64748B';
      ctx.font = 'bold 9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText('BILLED TO (CUSTOMER):', 52, cardY + 18);

      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText((data.client && data.client.name) || 'Valued Customer', 52, cardY + 36);

      ctx.fillStyle = '#475569';
      ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      var metaParts = [];
      if (data.client && data.client.region && data.client.region !== '—') metaParts.push('Region: ' + data.client.region);
      if (data.client && data.client.phone) metaParts.push('Phone: ' + data.client.phone);
      if (data.client && data.client.address) metaParts.push(data.client.address);
      ctx.fillText(metaParts.join('  ·  ') || 'Customer Account', 52, cardY + 54);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#64748B';
      ctx.font = 'bold 9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText('DELIVERY / ROUTE STAFF:', logicalWidth - 52, cardY + 18);

      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(data.staffName || 'Daily Fresh Team', logicalWidth - 52, cardY + 36);

      var auditOrNotes = data.notes || data.updatedInfo;
      if (auditOrNotes) {
        ctx.fillStyle = '#64748B';
        ctx.font = 'italic 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(auditOrNotes.slice(0, 48), logicalWidth - 52, cardY + 54);
      }

      curY += cardH + 16;

      // Items Table
      var tableX = 36;
      var tableW = logicalWidth - 72;

      roundRect(ctx, tableX, curY, tableW, 30, 6);
      ctx.fillStyle = '#F1F5F9';
      ctx.fill();
      ctx.strokeStyle = '#CBD5E1';
      ctx.stroke();

      ctx.fillStyle = '#475569';
      ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

      ctx.textAlign = 'center';
      ctx.fillText('#', tableX + 24, curY + 19);

      ctx.textAlign = 'left';
      ctx.fillText('ITEM DESCRIPTION', tableX + 54, curY + 19);

      if (hasAnyRate) {
        ctx.textAlign = 'right';
        ctx.fillText('QTY', tableX + tableW - 190, curY + 19);
        ctx.fillText('RATE (₹)', tableX + tableW - 100, curY + 19);
        ctx.fillText('TOTAL (₹)', tableX + tableW - 16, curY + 19);
      } else {
        ctx.textAlign = 'right';
        ctx.fillText('QTY', tableX + tableW - 130, curY + 19);
        ctx.fillText('TOTAL (₹)', tableX + tableW - 16, curY + 19);
      }

      curY += 34;

      var itemIdx = 0;
      function renderItem(item) {
        itemIdx += 1;
        var isEven = itemIdx % 2 === 0;

        ctx.fillStyle = isEven ? '#FBFBFC' : '#FFFFFF';
        ctx.fillRect(tableX, curY, tableW, itemRowHeight);

        ctx.strokeStyle = '#F1F5F9';
        ctx.beginPath();
        ctx.moveTo(tableX, curY + itemRowHeight);
        ctx.lineTo(tableX + tableW, curY + itemRowHeight);
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.fillStyle = '#64748B';
        ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(String(itemIdx), tableX + 24, curY + 19);

        ctx.textAlign = 'left';
        ctx.fillStyle = '#0F172A';
        ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        var maxNameW = hasAnyRate ? (tableW - 300) : (tableW - 240);
        var wrapped = wrapText(ctx, item.productName || '', maxNameW);
        ctx.fillText(wrapped[0], tableX + 54, curY + 19);

        ctx.textAlign = 'right';
        ctx.fillStyle = '#1E293B';
        ctx.font = '700 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        var qtyStr = item.unit ? (item.qty + ' ' + item.unit) : String(item.qty);

        if (hasAnyRate) {
          ctx.fillText(qtyStr, tableX + tableW - 190, curY + 19);
          ctx.fillStyle = '#64748B';
          ctx.font = '600 11px ui-monospace, Menlo, Consolas, monospace';
          var rateVal = item.rate || item.unitPrice || 0;
          ctx.fillText(rateVal > 0 ? ('₹' + rateVal.toFixed(2)) : '—', tableX + tableW - 100, curY + 19);
        } else {
          ctx.fillText(qtyStr, tableX + tableW - 130, curY + 19);
        }

        ctx.fillStyle = '#0F172A';
        ctx.font = 'bold 11px ui-monospace, Menlo, Consolas, monospace';
        ctx.fillText('₹' + Number(item.total || 0).toFixed(2), tableX + tableW - 16, curY + 19);

        curY += itemRowHeight;
      }

      if (isMultiDiv) {
        roundRect(ctx, tableX + 6, curY + 4, 110, 20, 4);
        ctx.fillStyle = '#EFF6FF';
        ctx.fill();
        ctx.fillStyle = '#1D4ED8';
        ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('PRIMARY FOODS', tableX + 61, curY + 18);
        curY += 26;

        primaryItems.forEach(renderItem);

        var pSub = primaryItems.reduce(function(s, i) { return s + (i.total || 0); }, 0);
        ctx.fillStyle = '#F8FAFC';
        ctx.fillRect(tableX, curY, tableW, 24);
        ctx.fillStyle = '#1D4ED8';
        ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('Primary Subtotal:', tableX + tableW - 130, curY + 16);
        ctx.fillText('₹' + pSub.toFixed(2), tableX + tableW - 16, curY + 16);
        curY += 28;

        roundRect(ctx, tableX + 6, curY + 4, 110, 20, 4);
        ctx.fillStyle = '#FFFBEB';
        ctx.fill();
        ctx.fillStyle = '#B45309';
        ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('BAKERY FOODS', tableX + 61, curY + 18);
        curY += 26;

        bakeryItems.forEach(renderItem);

        var bSub = bakeryItems.reduce(function(s, i) { return s + (i.total || 0); }, 0);
        ctx.fillStyle = '#F8FAFC';
        ctx.fillRect(tableX, curY, tableW, 24);
        ctx.fillStyle = '#B45309';
        ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('Bakery Subtotal:', tableX + tableW - 130, curY + 16);
        ctx.fillText('₹' + bSub.toFixed(2), tableX + tableW - 16, curY + 16);
        curY += 32;
      } else {
        items.forEach(renderItem);
        curY += 12;
      }

      // Financial Summary
      curY += 8;
      var summaryBoxW = 380;
      var summaryBoxX = tableX + tableW - summaryBoxW;

      function renderSumRow(label, val, isBold, color, indent) {
        var xOffset = indent || 0;
        ctx.fillStyle = '#64748B';
        ctx.font = (isBold ? 'bold' : '500') + ' 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(label, summaryBoxX + xOffset, curY + 14);

        ctx.fillStyle = color || '#0F172A';
        ctx.font = (isBold ? 'bold' : '600') + ' 12px ui-monospace, Menlo, Consolas, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(val, tableX + tableW, curY + 14);

        curY += 20;
      }

      renderSumRow('Items Subtotal:', '₹' + Number(data.subtotal || 0).toFixed(2), true, '#0F172A');

      if (data.discount && data.discount > 0) {
        renderSumRow('Discount:', '-₹' + Number(data.discount).toFixed(2), false, '#16A34A');
      }

      if (data.tax && data.tax > 0) {
        renderSumRow('Tax / GST:', '₹' + Number(data.tax).toFixed(2), false, '#475569');
      }

      if (data.previousOutstanding > 0) {
        renderSumRow('Previous Outstanding:', '₹' + Number(data.previousOutstanding).toFixed(2), false, '#475569');
      }

      if (data.previousAvailableCredit > 0) {
        renderSumRow('Previous Available Customer Credit:', '– ₹' + Number(data.previousAvailableCredit).toFixed(2), false, '#15803D');
      }

      if (data.creditApplied > 0) {
        renderSumRow('Credit Applied to This Bill:', '– ₹' + Number(data.creditApplied).toFixed(2), true, '#15803D');
      }

      var payForBill = Number(data.paymentReceivedForBill !== undefined ? data.paymentReceivedForBill : (data.appliedToBill || 0));
      var totPaid = Number(data.totalPaid || 0);

      if (totPaid > 0 || payForBill > 0) {
        renderSumRow('Payment Received for This Bill:', '₹' + payForBill.toFixed(2), true, '#15803D');
        if (data.appliedToPrevious && data.appliedToPrevious > 0) {
          renderSumRow('↳ Applied to Old Balance:', '₹' + Number(data.appliedToPrevious).toFixed(2), false, '#166534', 12);
        }
        var excessCreditVal = Number(data.excessAddedToCredit !== undefined ? data.excessAddedToCredit : Math.max(0, totPaid - payForBill - Number(data.appliedToPrevious || 0)));
        if (excessCreditVal > 0.01) {
          renderSumRow('↳ Added to Customer Credit:', '+₹' + excessCreditVal.toFixed(2), false, '#166534', 12);
        }
      }

      if (data.billRemaining > 0) {
        renderSumRow('This Bill Remaining:', '₹' + Number(data.billRemaining).toFixed(2), true, '#D97706');
      } else if (data.creditApplied > 0 || totPaid > 0) {
        renderSumRow('This Bill Remaining:', '₹0.00 (Settled)', true, '#16A34A');
      } else {
        renderSumRow('This Bill Remaining:', '₹' + Number(data.billRemaining || 0).toFixed(2), true, '#0F172A');
      }

      if (data.availableCreditAfterBill > 0) {
        renderSumRow('Available Credit After This Bill:', '₹' + Number(data.availableCreditAfterBill).toFixed(2), true, '#15803D');
      }

      curY += 10;

      // Grand Banner
      var bannerY = curY;
      var bannerH = 50;
      roundRect(ctx, tableX, bannerY, tableW, bannerH, 8);

      if (data.totalOutstanding <= 0.01) {
        ctx.fillStyle = '#F0FDF4';
        ctx.fill();
        ctx.strokeStyle = '#86EFAC';
        ctx.stroke();

        ctx.fillStyle = '#166534';
        ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('ACCOUNT SETTLED / NIL DUE', tableX + 20, bannerY + 30);

        ctx.font = 'bold 22px ui-monospace, Menlo, Consolas, monospace';
        ctx.textAlign = 'right';
        ctx.fillText('₹0.00', tableX + tableW - 20, bannerY + 32);
      } else {
        ctx.fillStyle = '#FEF2F2';
        ctx.fill();
        ctx.strokeStyle = '#FCA5A5';
        ctx.stroke();

        ctx.fillStyle = '#991B1B';
        ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('TOTAL OUTSTANDING — ALL BILLS', tableX + 20, bannerY + 30);

        ctx.font = 'bold 22px ui-monospace, Menlo, Consolas, monospace';
        ctx.textAlign = 'right';
        ctx.fillText('₹' + Number(data.totalOutstanding).toFixed(2), tableX + tableW - 20, bannerY + 32);
      }

      curY += bannerH + 24;

      // Footer
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(36, curY);
      ctx.lineTo(logicalWidth - 36, curY);
      ctx.stroke();

      curY += 18;

      ctx.textAlign = 'center';
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText('Thank you for partnering with ' + ${JSON.stringify(COMPANY_NAME)} + '!', logicalWidth / 2, curY);

      ctx.fillStyle = '#64748B';
      ctx.font = '500 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(${JSON.stringify(COMPANY_ADDRESS + ' · ' + COMPANY_PHONE)}, logicalWidth / 2, curY + 16);

      ctx.fillStyle = '#94A3B8';
      ctx.font = '400 9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText('Computer generated document · No signature required · Daily Fresh ERP', logicalWidth / 2, curY + 30);

      return canvas;
    }
  `;
}

/**
 * Renders the unified Daily Fresh invoice HTML.
 * Both Admin and Staff use this exact renderer for preview, print, and PDF.
 */
export function renderUnifiedInvoiceHtml(data: UnifiedInvoiceData): string {
  const {
    billNumber,
    deliveryDate,
    isDirectSale,
    client,
    staffName,
    notes,
    divisionLabel,
    items,
    subtotal,
    creditApplied,
    netDue,
    totalPaid,
    appliedToBill,
    appliedToPrevious,
    billRemaining,
    statusText,
    statusBadgeClass,
    previousBalance,
    remainingPreviousBalance,
    totalOutstanding,
    hasAdvanceCredit,
    primaryAdvanceCredit,
    bakeryAdvanceCredit,
    totalAdvanceCredit,
    divisionBreakdown,
    allocationWarning,
  } = data;

  const discount = data.discount || 0;
  const tax = data.tax || 0;
  const updatedInfo = data.updatedInfo;

  // Build division badge
  let divisionBadge = '<span class="badge-status badge-div-primary">Primary Foods</span>';
  if (divisionLabel.includes('Primary') && divisionLabel.includes('Bakery')) {
    divisionBadge = '<span class="badge-status badge-div-dual">Primary & Bakery</span>';
  } else if (divisionLabel.includes('Bakery')) {
    divisionBadge = '<span class="badge-status badge-div-bakery">Bakery Foods</span>';
  }

  const hasAnyRate = items.some(i => (i.rate && i.rate > 0) || (i.unitPrice && i.unitPrice > 0));
  const primaryItems = items.filter(i => i.division === 'primary');
  const bakeryItems = items.filter(i => i.division === 'bakery');
  const isMultiDiv = primaryItems.length > 0 && bakeryItems.length > 0;
  let itemCounter = 0;
  const renderItemRow = (item: (typeof items)[0]) => {
    itemCounter += 1;
    const unitText = item.unit ? `<span class="item-unit">${item.unit}</span>` : '';
    const rateVal = item.rate || item.unitPrice || 0;
    return `
      <tr class="item-row">
        <td class="text-center item-num">${itemCounter}</td>
        <td><div class="item-name">${item.productName}</div></td>
        <td class="text-right item-qty">${item.qty}${unitText}</td>
        ${hasAnyRate ? `<td class="text-right item-rate">${rateVal > 0 ? '₹' + rateVal.toFixed(2) : '—'}</td>` : ''}
        <td class="text-right item-total">₹${Number(item.total || 0).toFixed(2)}</td>
      </tr>
    `;
  };

  let itemsTbody = '';
  const totalCols = hasAnyRate ? 5 : 4;
  const subtotalLabelCols = hasAnyRate ? 4 : 3;

  if (isMultiDiv) {
    const pSub = primaryItems.reduce((s, i) => s + (i.total || 0), 0);
    const bSub = bakeryItems.reduce((s, i) => s + (i.total || 0), 0);
    itemsTbody = `
      <tr class="div-section-tr">
        <td colspan="${totalCols}"><span class="div-header-pill pill-primary">Primary Foods</span></td>
      </tr>
      ${primaryItems.map(renderItemRow).join('')}
      <tr class="subtotal-row">
        <td colspan="${subtotalLabelCols}" class="text-right subtotal-primary">Primary Subtotal:</td>
        <td class="text-right subtotal-primary">₹${pSub.toFixed(2)}</td>
      </tr>
      <tr class="div-section-tr">
        <td colspan="${totalCols}"><span class="div-header-pill pill-bakery">Bakery Foods</span></td>
      </tr>
      ${bakeryItems.map(renderItemRow).join('')}
      <tr class="subtotal-row">
        <td colspan="${subtotalLabelCols}" class="text-right subtotal-bakery">Bakery Subtotal:</td>
        <td class="text-right subtotal-bakery">₹${bSub.toFixed(2)}</td>
      </tr>
    `;
  } else {
    itemsTbody = items.map(renderItemRow).join('');
  }

  const previousOutstanding = data.previousOutstanding !== undefined ? data.previousOutstanding : Math.max(0, previousBalance || 0);
  const previousAvailableCredit = data.previousAvailableCredit !== undefined ? data.previousAvailableCredit : (hasAdvanceCredit ? totalAdvanceCredit : 0);
  const payForBill = Number(data.paymentReceivedForBill !== undefined ? data.paymentReceivedForBill : (appliedToBill !== undefined ? appliedToBill : Math.min(totalPaid, netDue)));
  const excessAddedToCredit = data.excessAddedToCredit !== undefined ? data.excessAddedToCredit : Math.max(0, totalPaid - payForBill - (appliedToPrevious || 0));
  const availableCreditAfterBill = data.availableCreditAfterBill !== undefined ? data.availableCreditAfterBill : (totalAdvanceCredit || 0);

  // Pre-formatted WhatsApp share message
  const waLines: string[] = [
    `*${COMPANY_NAME}*`,
    COMPANY_ADDRESS,
    COMPANY_PHONE,
    `--------------------------------`,
    `*BILL / INVOICE*`,
    `*Bill No:* ${billNumber}`,
    `*Date:* ${deliveryDate}`,
    `*Customer:* ${client.name}`,
    client.region && client.region !== '—' && !isDirectSale ? `*Region:* ${client.region}` : '',
    staffName ? `*Route Staff:* ${staffName}` : '',
    `--------------------------------`,
    `*Items:*`,
    ...items.map(
      (it, idx) => `${idx + 1}. ${it.productName} × ${it.qty}${it.unit ? ' ' + it.unit : ''} = ₹${Number(it.total || 0).toFixed(2)}`
    ),
    `--------------------------------`,
    `*Items Subtotal:* ₹${subtotal.toFixed(2)}`,
    previousOutstanding > 0 ? `*Previous Outstanding:* ₹${previousOutstanding.toFixed(2)}` : '',
    previousAvailableCredit > 0 ? `*Previous Available Customer Credit:* -₹${previousAvailableCredit.toFixed(2)}` : '',
    creditApplied > 0 ? `*Credit Applied to This Bill:* -₹${creditApplied.toFixed(2)}` : '',
    (totalPaid > 0 || payForBill > 0) ? `*Payment Received for This Bill:* ₹${payForBill.toFixed(2)}` : '',
    appliedToPrevious && appliedToPrevious > 0 ? `  ↳ *To Old Balance:* ₹${appliedToPrevious.toFixed(2)}` : '',
    excessAddedToCredit && excessAddedToCredit > 0.01 ? `  ↳ *To Customer Credit:* +₹${excessAddedToCredit.toFixed(2)}` : '',
    `*This Bill Remaining:* ₹${billRemaining.toFixed(2)}${billRemaining <= 0.005 && (totalPaid > 0 || creditApplied > 0) ? ' (Settled)' : ''}`,
    availableCreditAfterBill > 0 ? `*Available Credit After This Bill:* ₹${availableCreditAfterBill.toFixed(2)}` : '',
    `--------------------------------`,
    `*TOTAL OUTSTANDING — ALL BILLS:* ₹${totalOutstanding.toFixed(2)}`,
    `*Payment Status:* ${statusText}`,
    `--------------------------------`,
    `Thank you for choosing Daily Fresh!`,
  ];
  const waText = waLines.filter(Boolean).join('\n');

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes" />
        <title>Invoice - ${billNumber}</title>
        <style>${getInvoiceStyles()}</style>
      </head>
      <body>
        ${buildActionBarHtml(billNumber)}

        <div class="invoice-shell">
          <div class="invoice-card">
            <!-- Header Row -->
            <div class="header-row">
              <div class="brand-col">
                <div>
                  <div class="brand-title">Daily Fresh Food Products</div>
                  <div class="brand-address">${COMPANY_ADDRESS}</div>
                  <div class="brand-contact">${COMPANY_PHONE}</div>
                </div>
              </div>
              <div class="meta-col">
                <div class="meta-type">BILL / INVOICE</div>
                <div class="meta-bill-no">#${billNumber}</div>
                <div class="meta-date">Date: <strong>${deliveryDate}</strong></div>
                <div class="meta-pills">
                  ${divisionBadge}
                  <span class="badge-status ${statusBadgeClass}">${statusText}</span>
                </div>
              </div>
            </div>

            <!-- Client Info Card -->
            <div class="client-card avoid-break">
              <div>
                <div class="client-tag">BILLED TO (CUSTOMER):</div>
                <div class="client-name">${client.name}</div>
                <div class="client-details">
                  ${client.region && client.region !== '—' ? `<span class="client-pill">Region: ${client.region}</span>` : ''}
                  ${client.phone ? `<span class="client-pill">Phone: ${client.phone}</span>` : ''}
                  ${client.address ? `<span class="client-pill">${client.address}</span>` : ''}
                </div>
              </div>
              <div class="client-meta-col">
                <div class="client-tag">DELIVERY / ROUTE STAFF:</div>
                <div class="staff-name">${staffName || 'Daily Fresh Team'}</div>
                ${notes || updatedInfo ? `<div class="staff-notes">${notes || updatedInfo}</div>` : ''}
              </div>
            </div>

            <!-- Items Table -->
            <table class="items-table">
              <thead>
                <tr>
                  <th style="width: 44px;" class="text-center">#</th>
                  <th>ITEM DESCRIPTION</th>
                  <th style="width: 90px;" class="text-right">QTY</th>
                  ${hasAnyRate ? '<th style="width: 95px;" class="text-right">RATE (₹)</th>' : ''}
                  <th style="width: 110px;" class="text-right">TOTAL (₹)</th>
                </tr>
              </thead>
              <tbody>
                ${itemsTbody}
              </tbody>
            </table>

            <!-- Financial Summary & Outstanding Breakdown -->
            <div class="summary-wrapper avoid-break">
              <div class="summary-table-wrap">
                <table class="summary-table">
                  <tr>
                    <td class="lbl">Items Subtotal:</td>
                    <td class="val">₹${subtotal.toFixed(2)}</td>
                  </tr>
                  ${
                    discount && discount > 0
                      ? `
                    <tr>
                      <td class="lbl">Discount:</td>
                      <td class="val text-credit">– ₹${discount.toFixed(2)}</td>
                    </tr>
                  `
                      : ''
                  }
                  ${
                    tax && tax > 0
                      ? `
                    <tr>
                      <td class="lbl">Tax / GST:</td>
                      <td class="val">₹${tax.toFixed(2)}</td>
                    </tr>
                  `
                      : ''
                  }
                  ${
                    allocationWarning
                      ? `
                    <tr class="row-previous-due">
                      <td class="lbl">Payment Allocation Status:</td>
                      <td class="val text-amber">${allocationWarning}</td>
                    </tr>
                  `
                      : ''
                  }
                  ${
                    previousOutstanding > 0
                      ? `
                    <tr class="row-previous-due">
                      <td class="lbl">Previous Outstanding:</td>
                      <td class="val">₹${previousOutstanding.toFixed(2)}</td>
                    </tr>
                  `
                      : ''
                  }
                  ${
                    previousAvailableCredit > 0
                      ? `
                    <tr class="row-previous-credit">
                      <td class="lbl">Previous Available Customer Credit:</td>
                      <td class="val text-credit">– ₹${previousAvailableCredit.toFixed(2)}</td>
                    </tr>
                  `
                      : ''
                  }
                  ${
                    creditApplied > 0
                      ? `
                    <tr class="row-credit-applied">
                      <td class="lbl">Credit Applied to This Bill:</td>
                      <td class="val text-credit">– ₹${creditApplied.toFixed(2)}</td>
                    </tr>
                  `
                      : ''
                  }
                  ${
                    totalPaid > 0 || payForBill > 0
                      ? `
                    <tr class="row-payment">
                      <td class="lbl">Payment Received for This Bill:</td>
                      <td class="val text-credit">₹${payForBill.toFixed(2)}</td>
                    </tr>
                    ${
                      appliedToPrevious && appliedToPrevious > 0
                        ? `
                      <tr class="row-payment-sub">
                        <td class="lbl indent">↳ Applied to Old Balance:</td>
                        <td class="val text-credit-sub">₹${appliedToPrevious.toFixed(2)}</td>
                      </tr>
                    `
                        : ''
                    }
                    ${
                      excessAddedToCredit && excessAddedToCredit > 0.01
                        ? `
                      <tr class="row-payment-sub">
                        <td class="lbl indent">↳ Added to Customer Credit:</td>
                        <td class="val text-credit-sub">+₹${excessAddedToCredit.toFixed(2)}</td>
                      </tr>
                    `
                        : ''
                    }
                  `
                      : ''
                  }
                  <tr class="row-bill-remaining">
                    <td class="lbl">This Bill Remaining:</td>
                    <td class="val ${billRemaining > 0 ? 'text-amber' : 'text-credit'}">
                      ₹${billRemaining.toFixed(2)}${billRemaining <= 0.005 && (totalPaid > 0 || creditApplied > 0) ? ' (Settled)' : ''}
                    </td>
                  </tr>
                  ${
                    availableCreditAfterBill > 0
                      ? `
                    <tr class="row-credit-after">
                      <td class="lbl">Available Credit After This Bill:</td>
                      <td class="val text-credit">₹${availableCreditAfterBill.toFixed(2)}</td>
                    </tr>
                  `
                      : ''
                  }
                </table>
              </div>

              <!-- Prominent TOTAL OUTSTANDING Box (Full Table Width) -->
              <div class="grand-banner ${totalOutstanding <= 0.01 ? 'banner-paid' : ''}">
                <div class="grand-lbl">${totalOutstanding <= 0.01 ? 'ACCOUNT SETTLED / NIL DUE' : 'TOTAL OUTSTANDING — ALL BILLS'}</div>
                <div class="grand-val">₹${totalOutstanding.toFixed(2)}</div>
              </div>
            </div>

            <!-- Footer -->
            <div class="invoice-footer avoid-break">
              <p class="footer-highlight">Thank you for partnering with <span class="footer-brand">${COMPANY_NAME}</span>!</p>
              <p>${COMPANY_ADDRESS} · ${COMPANY_PHONE}</p>
              <p>Computer generated document · No signature required · Daily Fresh ERP</p>
            </div>
          </div>
        </div>

        <script>
          var INVOICE_DATA = ${JSON.stringify(data)};

          function shareOnWhatsApp() {
            var text = ${JSON.stringify(waText)};
            var phone = ${JSON.stringify(client.phone || '')};
            var cleanPhone = phone ? phone.replace(/[^0-9]/g, '') : '';
            var url = cleanPhone
              ? ('https://wa.me/' + cleanPhone + '?text=' + encodeURIComponent(text))
              : ('https://wa.me/?text=' + encodeURIComponent(text));
            window.open(url, '_blank');
          }

          function showBanner(msg, type, actionUrl, actionText) {
            var b = document.getElementById('share-feedback-banner');
            if (!b) return;
            b.className = 'no-print ' + type;
            b.style.display = 'flex';
            var actionHtml = actionUrl && actionText
              ? '<a href="' + actionUrl + '" target="_blank" rel="noopener noreferrer" class="btn-banner-action">' + actionText + ' ↗</a>'
              : '';
            b.innerHTML = '<span>' + msg + '</span>' +
              '<div style="display:flex;align-items:center;gap:8px;">' +
                actionHtml +
                '<button type="button" class="btn-banner-close" onclick="dismissBanner()">✕</button>' +
              '</div>';
          }

          function dismissBanner() {
            var b = document.getElementById('share-feedback-banner');
            if (b) b.style.display = 'none';
          }

          ${getInvoiceCanvasScript()}

          async function shareAsJpg() {
            var btn = document.getElementById('btn-share-jpg');
            var origHtml = btn ? btn.innerHTML : '';
            if (btn) {
              btn.disabled = true;
              btn.innerHTML = 'Generating JPG...';
            }
            try {
              var canvas = renderInvoiceCanvas(INVOICE_DATA);
              var blob = await new Promise(function(resolve, reject) {
                canvas.toBlob(function(b) {
                  if (b) resolve(b);
                  else reject(new Error('Canvas export failed'));
                }, 'image/jpeg', 0.95);
              });

              var cleanBillNo = (INVOICE_DATA.billNumber || 'BILL').replace(/[^a-zA-Z0-9_-]/g, '_');
              var fileName = 'DailyFresh_Bill_' + cleanBillNo + '.jpg';
              var file = new File([blob], fileName, { type: 'image/jpeg' });

              var phone = INVOICE_DATA.client && INVOICE_DATA.client.phone ? INVOICE_DATA.client.phone.replace(/[^0-9]/g, '') : '';
              var waUrl = phone ? ('https://wa.me/' + phone) : 'https://wa.me/';

              if (navigator && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
                try {
                  await navigator.share({
                    title: 'Bill ' + INVOICE_DATA.billNumber + ' · Daily Fresh',
                    text: 'Daily Fresh invoice #' + INVOICE_DATA.billNumber + ' for ' + (INVOICE_DATA.client ? INVOICE_DATA.client.name : 'Customer'),
                    files: [file]
                  });
                  showBanner('✅ Invoice image shared successfully via device share sheet.', 'success');
                  return;
                } catch (err) {
                  if (err && err.name === 'AbortError') {
                    return;
                  }
                }
              }

              // Download Fallback
              var url = URL.createObjectURL(blob);
              var a = document.createElement('a');
              a.href = url;
              a.download = fileName;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              setTimeout(function() { URL.revokeObjectURL(url); }, 2000);

              showBanner(
                '📥 Downloaded "' + fileName + '". Attach this JPG in WhatsApp:',
                'info',
                waUrl,
                'Open WhatsApp to Attach'
              );
            } catch (err) {
              console.error('Failed to generate/share bill JPG:', err);
              alert('Could not generate bill image: ' + (err.message || err));
            } finally {
              if (btn) {
                btn.disabled = false;
                btn.innerHTML = origHtml;
              }
            }
          }

          window.addEventListener('load', function() {
            setTimeout(function() {
              window.print();
            }, 300);
          });
        </script>
      </body>
    </html>
  `;
}

/**
 * Builds normalized UnifiedInvoiceData from an Order record.
 */
export function buildUnifiedInvoiceDataFromOrder({
  order,
  client,
  payments = [],
  ledger = [],
  products = [],
  previousBalance,
  availableCredit,
  primaryCredit,
  bakeryCredit,
}: PrintOrderInvoiceOptions): UnifiedInvoiceData {
  const isDirectSale = order.orderType === 'direct' || order.clientId === 'direct';
  const clientName = order.clientName || client?.name || (isDirectSale ? 'Direct Sale' : 'Valued Customer');
  const region = client?.region || order.region || (isDirectSale ? 'Direct Sale' : '—');
  const clientPhone = client?.phone || '';
  const clientAddress = client?.address || (client?.city && client.city !== region ? client.city : '');
  const billNumber = order.id.startsWith('ORD-')
    ? order.id
    : order.id.startsWith('INV-')
    ? order.id
    : `INV-${order.id.slice(0, 8).toUpperCase()}`;

  const deliveryDate = order.deliveryDate
    ? format(new Date(order.deliveryDate), 'dd MMM yyyy')
    : order.createdAt
    ? format(new Date(order.createdAt), 'dd MMM yyyy')
    : format(new Date(), 'dd MMM yyyy');

  // Map items with product units & division & rates
  const items = (order.items || []).map(i => {
    const prod = products.find(p => p.id === i.productId || p.name === i.productName);
    const division = prod?.division || (order.division === 'bakery' ? 'bakery' : 'primary');
    const total = typeof i.total === 'number' ? i.total : (i.unitPrice || 0) * i.qty;
    return {
      productName: i.productName,
      qty: i.qty,
      unit: prod?.unit || undefined,
      unitPrice: i.unitPrice,
      rate: i.unitPrice,
      total,
      division,
    };
  });

  const subtotal = order.subtotal || items.reduce((sum, i) => sum + i.total, 0);
  const creditApplied =
    order.creditApplied || ((order.primaryCreditApplied || 0) + (order.bakeryCreditApplied || 0)) || 0;
  const netDue = order.netDue !== undefined ? order.netDue : Math.max(0, subtotal - creditApplied);

  // Ledger payment postings split a cross-division collection into its actual
  // invoice allocations. Fall back to payment fields for legacy callers that
  // have not supplied ledger data.
  const invoiceLedgerPayments = ledger.filter(
    entry => entry.type === 'payment' && entry.invoiceId === order.id
  );
  const duplicatePaymentIds = Array.from(
    invoiceLedgerPayments.reduce((counts, entry) => {
      if (entry.paymentId) counts.set(entry.paymentId, (counts.get(entry.paymentId) || 0) + 1);
      return counts;
    }, new Map<string, number>()).entries()
  ).filter(([, count]) => count > 1).map(([paymentId]) => paymentId);
  const unresolvedLegacyCounterparts = payments.filter(payment =>
    !payment.deletedAt &&
    payment.clientId === order.clientId &&
    payment.invoiceId !== order.id &&
    !payment.otherInvoiceId &&
    (payment.appliedToOtherBill || 0) > 0
  );
  const allocationWarning = duplicatePaymentIds.length > 0
    ? `Allocation review required: duplicate ledger posting${duplicatePaymentIds.length > 1 ? 's' : ''} for payment ${duplicatePaymentIds.join(', ')}.`
    : unresolvedLegacyCounterparts.length > 0
      ? 'Allocation review required: a legacy cross-division payment has no counterpart invoice allocation.'
      : undefined;
  const hasAmbiguousAllocation = Boolean(allocationWarning);
  const unambiguousLedgerPayments = hasAmbiguousAllocation
    ? invoiceLedgerPayments.filter(entry => !entry.paymentId || !duplicatePaymentIds.includes(entry.paymentId))
    : invoiceLedgerPayments;
  const orderPayments = payments.filter(p => !p.deletedAt && (p.invoiceId === order.id || p.otherInvoiceId === order.id));
  const totalPaymentReceived = unambiguousLedgerPayments.length > 0
    ? unambiguousLedgerPayments.reduce((sum, entry) => sum + (entry.appliedAmount ?? entry.amount ?? 0), 0)
    : orderPayments.reduce((sum, payment) => {
        if (payment.invoiceId === order.id) return sum + (payment.appliedAmount ?? payment.amount ?? 0);
        return sum + (payment.appliedToOtherBill || 0);
      }, 0);
  // Older records may only have the order-level paidAmount. Use it only when
  // no allocation records are available; it is not safe to combine it with a
  // cross-division parent payment.
  const paymentAmount = Math.max(
    0,
    totalPaymentReceived,
    !hasAmbiguousAllocation && invoiceLedgerPayments.length === 0 && orderPayments.length === 0 ? (order.paidAmount || 0) : 0
  );
  const appliedToPreviousFromLedger = unambiguousLedgerPayments.reduce(
    (sum, entry) => sum + (entry.appliedToPrevious || 0),
    0
  );

  // Compute previous balance using existing ledger semantics if not explicitly provided
  let prevBal = 0;
  let priorCredit = 0;
  if (typeof previousBalance === 'number') {
    if (previousBalance < 0) {
      priorCredit = Math.abs(previousBalance);
    } else {
      prevBal = previousBalance;
    }
  } else if (!isDirectSale && order.clientId) {
    try {
      const invDate = (order.deliveryDate || order.createdAt || '').substring(0, 10);
      const calculatedOld = calculateOldBalance(order.clientId, invDate, 'all', [order.id]);
      if (calculatedOld < 0) {
        priorCredit = Math.abs(calculatedOld);
      } else {
        prevBal = calculatedOld;
      }
    } catch {
      prevBal = 0;
    }
  }

  // If client had prior credit that wasn't already deducted in order.creditApplied, offset remaining due
  const unappliedPriorCredit = Math.max(0, priorCredit - creditApplied);
  const effectiveNetDue = Math.max(0, netDue - unappliedPriorCredit);
  const remainingPriorCredit = Math.max(0, unappliedPriorCredit - netDue);

  const clientTotal = isDirectSale ? effectiveNetDue : prevBal + effectiveNetDue;
  const alloc = allocatePayment({
    paymentAmount,
    orderRemaining: effectiveNetDue,
    clientTotalOutstanding: clientTotal,
    isDirectSale,
    division: order.division === 'bakery' ? 'bakery' : 'primary',
  });

  const appliedToBill = alloc.appliedToBill;
  const appliedToPrevious = unambiguousLedgerPayments.length > 0
    ? appliedToPreviousFromLedger
    : alloc.appliedToPrevious;
  const totalPaid = paymentAmount;
  const billRemaining = alloc.remainingTotalOutstanding <= 0.005 ? 0 : alloc.remainingBill;
  let remainingPrevious = alloc.remainingPrevious;
  let totalOutstanding = alloc.remainingTotalOutstanding;

  // When ledger data is present, it is the authoritative account balance.
  // This includes counterpart division postings and payments against prior debt,
  // neither of which may be inferred from this invoice's payment document alone.
  if (!isDirectSale && order.clientId && ledger.length > 0) {
    const clientLedger = ledger.filter(entry => entry.clientId === order.clientId);
    if (clientLedger.length > 0) {
      const rawLedgerBalance = clientLedger.reduce((sum, entry) => {
        const signedAmount = entry.type === 'payment' ? -(entry.amount || 0) : (entry.amount || 0);
        return sum + signedAmount;
      }, 0);
      totalOutstanding = Math.max(0, rawLedgerBalance);
      remainingPrevious = Math.max(0, totalOutstanding - billRemaining);
    }
  }
  if (hasAmbiguousAllocation) {
    totalOutstanding = Math.max(totalOutstanding, billRemaining);
    remainingPrevious = Math.max(0, totalOutstanding - billRemaining);
  }

  // Determine division label & multi-division breakdown
  const primaryItems = items.filter(i => i.division === 'primary');
  const bakeryItems = items.filter(i => i.division === 'bakery');
  const hasPrimary = primaryItems.length > 0;
  const hasBakery = bakeryItems.length > 0;
  const isMultiDiv = hasPrimary && hasBakery;

  const primarySubtotal = primaryItems.reduce((s, i) => s + i.total, 0);
  const bakerySubtotal = bakeryItems.reduce((s, i) => s + i.total, 0);

  const primaryCreditApplied = order.primaryCreditApplied || (order.division === 'primary' ? (order.creditApplied || 0) : 0) || 0;
  const bakeryCreditApplied = order.bakeryCreditApplied || (order.division === 'bakery' ? (order.creditApplied || 0) : 0) || 0;
  const primaryNetDue = Math.max(0, primarySubtotal - primaryCreditApplied);
  const bakeryNetDue = Math.max(0, bakerySubtotal - bakeryCreditApplied);

  const primaryOrderPayments = orderPayments.filter(p => p.division === 'primary');
  const bakeryOrderPayments = orderPayments.filter(p => p.division === 'bakery');
  let primaryPaid = unambiguousLedgerPayments.length > 0
    ? unambiguousLedgerPayments
        .filter(entry => entry.division === 'primary')
        .reduce((sum, entry) => sum + (entry.appliedAmount ?? entry.amount ?? 0), 0)
    : primaryOrderPayments.reduce((sum, payment) => sum + (payment.appliedAmount ?? payment.amount ?? 0), 0);
  let bakeryPaid = unambiguousLedgerPayments.length > 0
    ? unambiguousLedgerPayments
        .filter(entry => entry.division === 'bakery')
        .reduce((sum, entry) => sum + (entry.appliedAmount ?? entry.amount ?? 0), 0)
    : bakeryOrderPayments.reduce((sum, payment) => sum + (payment.appliedAmount ?? payment.amount ?? 0), 0);

  if (primaryPaid === 0 && bakeryPaid === 0 && totalPaid > 0) {
    if (order.division === 'primary') {
      primaryPaid = totalPaid;
    } else if (order.division === 'bakery') {
      bakeryPaid = totalPaid;
    } else {
      primaryPaid = Math.min(totalPaid, primaryNetDue);
      bakeryPaid = Math.min(Math.max(0, totalPaid - primaryPaid), bakeryNetDue);
    }
  }

  const primaryAppliedToBill = Math.min(primaryPaid, primaryNetDue);
  const bakeryAppliedToBill = Math.min(bakeryPaid, bakeryNetDue);
  const primaryBillRemaining = Math.max(0, primaryNetDue - primaryAppliedToBill);
  const bakeryBillRemaining = Math.max(0, bakeryNetDue - bakeryAppliedToBill);

  let divisionLabel = 'Primary Foods';
  if (hasPrimary && hasBakery) {
    divisionLabel = 'Primary & Bakery Foods';
  } else if (hasBakery || order.division === 'bakery') {
    divisionLabel = 'Bakery Foods';
  }

  // Invoice status badge & text
  let statusBadgeClass = 'badge-pending';
  let statusText = 'PENDING';
  if (hasAmbiguousAllocation) {
    statusBadgeClass = 'badge-pending';
    statusText = 'ALLOCATION REVIEW REQUIRED';
  } else if (order.paymentStatus === 'paid' || totalOutstanding <= 0.01) {
    statusBadgeClass = 'badge-paid';
    statusText = 'PAID';
  } else if (totalPaid > 0 || unappliedPriorCredit > 0) {
    statusBadgeClass = 'badge-partial';
    statusText = 'PARTIALLY PAID';
  }

  // Client available credit (kept distinct from outstanding debt)
  const pCredit = typeof primaryCredit === 'number' ? primaryCredit : client?.primaryCredit || 0;
  const bCredit = typeof bakeryCredit === 'number' ? bakeryCredit : client?.bakeryCredit || 0;
  const availCredit =
    typeof availableCredit === 'number'
      ? availableCredit
      : client?.availableCredit || client?.credit || pCredit + bCredit || 0;

  const previousOutstanding = prevBal;
  const previousAvailableCredit = Math.max(
    priorCredit,
    creditApplied > 0 ? (creditApplied + availCredit) : availCredit
  );
  const paymentReceivedForBill = appliedToBill;
  const excessAddedToCredit = alloc.excessCredit;
  const availableCreditAfterBill = Math.max(0, previousAvailableCredit - creditApplied) + excessAddedToCredit;
  const hasAdvanceCredit = !isDirectSale && (alloc.excessCredit > 0 || remainingPriorCredit > 0 || pCredit > 0 || bCredit > 0 || availCredit > 0 || availableCreditAfterBill > 0);

  const staffName = order.staffName || (client as any)?.staffName || (client as any)?.routeStaff || undefined;

  return {
    billNumber,
    deliveryDate,
    isDirectSale,
    client: {
      name: clientName,
      region,
      phone: clientPhone,
      address: clientAddress,
    },
    staffName,
    notes: order.notes,
    divisionLabel,
    items,
    subtotal,
    discount: (order as any).discount,
    tax: order.tax,
    creditApplied,
    netDue,
    paymentReceivedForBill,
    totalPaid,
    appliedToBill: appliedToBill > 0 ? appliedToBill : undefined,
    appliedToPrevious: appliedToPrevious > 0 ? appliedToPrevious : undefined,
    excessAddedToCredit: excessAddedToCredit > 0 ? excessAddedToCredit : undefined,
    billRemaining,
    statusText,
    statusBadgeClass,
    previousOutstanding,
    previousAvailableCredit,
    availableCreditAfterBill,
    previousBalance: prevBal,
    remainingPreviousBalance: appliedToPrevious > 0 ? remainingPrevious : undefined,
    totalOutstanding,
    hasAdvanceCredit,
    primaryAdvanceCredit: hasPrimary && alloc.excessCredit > 0 ? alloc.excessCredit : pCredit,
    bakeryAdvanceCredit: hasBakery && !hasPrimary && alloc.excessCredit > 0 ? alloc.excessCredit : bCredit,
    totalAdvanceCredit: availableCreditAfterBill,
    allocationWarning,
    divisionBreakdown: isMultiDiv ? {
      primary: {
        subtotal: primarySubtotal,
        creditApplied: primaryCreditApplied,
        netDue: primaryNetDue,
        paid: primaryPaid,
        appliedToBill: primaryAppliedToBill,
        appliedToPrevious: 0,
        previousBalance: 0,
        remainingPrevious: 0,
        outstanding: primaryBillRemaining,
        excessCredit: Math.max(0, primaryPaid - primaryAppliedToBill),
      },
      bakery: {
        subtotal: bakerySubtotal,
        creditApplied: bakeryCreditApplied,
        netDue: bakeryNetDue,
        paid: bakeryPaid,
        appliedToBill: bakeryAppliedToBill,
        appliedToPrevious: 0,
        previousBalance: 0,
        remainingPrevious: 0,
        outstanding: bakeryBillRemaining,
        excessCredit: Math.max(0, bakeryPaid - bakeryAppliedToBill),
      },
    } : undefined,
  };
}

/**
 * Generates an official, unified Daily Fresh invoice for a single Order (Admin & Staff)
 */
export function printOrderInvoice(options: PrintOrderInvoiceOptions) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups to print/export invoices.');
    return;
  }
  const unifiedData = buildUnifiedInvoiceDataFromOrder(options);
  const html = renderUnifiedInvoiceHtml(unifiedData);
  printWindow.document.write(html);
  printWindow.document.close();
}

/**
 * Builds normalized UnifiedInvoiceData from a DailyBillInvoiceData row.
 */
export function buildUnifiedInvoiceDataFromDailyBill(row: DailyBillInvoiceData): UnifiedInvoiceData {
  const isDirectSale = row.clientId === 'direct' || row.clientName === 'Direct Sale';
  const clientName = row.clientName;
  const region = row.region || '—';
  const billNumber = row.billNumber;
  const deliveryDate = row.deliveryDate
    ? format(new Date(row.deliveryDate), 'dd MMM yyyy')
    : format(new Date(), 'dd MMM yyyy');

  const items = (row.items || []).map(i => ({
    productName: i.productName,
    qty: i.qty,
    unit: i.unit,
    unitPrice: i.unitPrice,
    rate: i.unitPrice,
    total: typeof i.total === 'number' ? i.total : (i.unitPrice || 0) * i.qty,
    division: i.division,
  }));

  const primaryItems = items.filter(i => i.division === 'primary');
  const bakeryItems = items.filter(i => i.division === 'bakery');
  const hasPrimary = primaryItems.length > 0;
  const hasBakery = bakeryItems.length > 0;

  let divisionLabel = 'Primary Foods';
  if (hasPrimary && hasBakery) {
    divisionLabel = 'Primary & Bakery Foods';
  } else if (hasBakery) {
    divisionLabel = 'Bakery Foods';
  }

  const creditApplied = (row.primaryCreditApplied || 0) + (row.bakeryCreditApplied || 0);
  const netDue = Math.max(0, row.subtotal - creditApplied);
  const totalPaid = (row.primaryReceived || 0) + (row.bakeryReceived || 0) || row.paidAmount || 0;
  const appliedToPrevious = (row.primaryAppliedToPrevious || 0) + (row.bakeryAppliedToPrevious || 0);
  const computedAppliedToBill = (row.primaryAppliedToBill !== undefined || row.bakeryAppliedToBill !== undefined)
    ? ((row.primaryAppliedToBill || 0) + (row.bakeryAppliedToBill || 0))
    : (totalPaid > 0 && appliedToPrevious > 0 ? Math.max(0, totalPaid - appliedToPrevious) : (totalPaid > 0 ? totalPaid : 0));
  const appliedToBill = computedAppliedToBill;
  const paymentReceivedForBill = appliedToBill;
  const previousOutstanding = Math.max(0, row.oldBalance || 0);
  const previousBalance = previousOutstanding;
  const remainingPreviousBalance = (row.primaryPreviousRemaining !== undefined || row.bakeryPreviousRemaining !== undefined)
    ? ((row.primaryPreviousRemaining || 0) + (row.bakeryPreviousRemaining || 0))
    : Math.max(0, previousBalance - appliedToPrevious);
  const totalOutstanding = Math.max(0, row.outstandingBalance);
  const excessCredit = (row.primaryExcess || 0) + (row.bakeryExcess || 0);
  const priorCreditFromOldBal = (row.oldBalance && row.oldBalance < 0) ? Math.abs(row.oldBalance) : 0;
  const newCashExcess = Math.max(0, totalPaid - paymentReceivedForBill - appliedToPrevious);
  const excessAddedToCredit = newCashExcess > 0 ? newCashExcess : (priorCreditFromOldBal === 0 ? excessCredit : 0);
  const billRemaining = totalOutstanding <= 0.005
    ? 0
    : ((row.primaryBillRemaining !== undefined || row.bakeryBillRemaining !== undefined)
      ? ((row.primaryBillRemaining || 0) + (row.bakeryBillRemaining || 0))
      : Math.max(0, netDue - (appliedToBill || totalPaid)));

  const effectiveCreditApplied = creditApplied > 0 ? creditApplied : (priorCreditFromOldBal > 0 ? Math.min(row.subtotal, priorCreditFromOldBal) : 0);
  const previousAvailableCredit = Math.max(priorCreditFromOldBal, creditApplied);
  const availableCreditAfterBill = priorCreditFromOldBal > 0
    ? Math.max(0, previousAvailableCredit - effectiveCreditApplied) + newCashExcess
    : Math.max(0, previousAvailableCredit - creditApplied) + excessAddedToCredit;

  let statusBadgeClass = 'badge-pending';
  let statusText = 'PENDING';
  if (totalOutstanding <= 0.01) {
    statusBadgeClass = 'badge-paid';
    statusText = 'PAID';
  } else if (totalPaid > 0 || (row.oldBalance < 0 && excessCredit > 0)) {
    statusBadgeClass = 'badge-partial';
    statusText = 'PARTIALLY PAID';
  }

  return {
    billNumber,
    deliveryDate,
    isDirectSale,
    client: {
      name: clientName,
      region,
      phone: row.clientPhone,
      address: row.clientAddress,
    },
    staffName: row.staffName || undefined,
    notes: row.updatedInfo ? `Payment info: ${row.updatedInfo}` : undefined,
    updatedInfo: row.updatedInfo || undefined,
    divisionLabel,
    items,
    subtotal: row.subtotal,
    creditApplied,
    netDue,
    paymentReceivedForBill,
    totalPaid,
    appliedToBill: appliedToBill > 0 ? appliedToBill : (totalPaid > 0 && appliedToPrevious > 0 ? Math.max(0, totalPaid - appliedToPrevious) : (totalPaid > 0 ? totalPaid : 0)),
    appliedToPrevious: appliedToPrevious > 0 ? appliedToPrevious : undefined,
    excessAddedToCredit: excessAddedToCredit > 0 ? excessAddedToCredit : undefined,
    billRemaining,
    statusText,
    statusBadgeClass,
    previousOutstanding,
    previousAvailableCredit,
    availableCreditAfterBill,
    previousBalance,
    remainingPreviousBalance: appliedToPrevious > 0 ? remainingPreviousBalance : undefined,
    totalOutstanding,
    hasAdvanceCredit: availableCreditAfterBill > 0 || excessCredit > 0,
    primaryAdvanceCredit: row.primaryExcess || 0,
    bakeryAdvanceCredit: row.bakeryExcess || 0,
    totalAdvanceCredit: availableCreditAfterBill,
    divisionBreakdown: {
      primary:
        hasPrimary && row.primarySubtotal !== undefined
          ? {
              subtotal: row.primarySubtotal,
              creditApplied: row.primaryCreditApplied,
              netDue: Math.max(0, row.primarySubtotal - (row.primaryCreditApplied || 0)),
              paid: row.primaryReceived || row.primaryPaid,
              appliedToBill: row.primaryAppliedToBill,
              appliedToPrevious: row.primaryAppliedToPrevious,
              previousBalance: Math.max(0, row.primaryOldBalance || 0),
              remainingPrevious: row.primaryPreviousRemaining,
              outstanding: Math.max(0, row.primaryOutstanding || 0),
              excessCredit: row.primaryExcess,
            }
          : undefined,
      bakery:
        hasBakery && row.bakerySubtotal !== undefined
          ? {
              subtotal: row.bakerySubtotal,
              creditApplied: row.bakeryCreditApplied,
              netDue: Math.max(0, row.bakerySubtotal - (row.bakeryCreditApplied || 0)),
              paid: row.bakeryReceived || row.bakeryPaid,
              appliedToBill: row.bakeryAppliedToBill,
              appliedToPrevious: row.bakeryAppliedToPrevious,
              previousBalance: Math.max(0, row.bakeryOldBalance || 0),
              remainingPrevious: row.bakeryPreviousRemaining,
              outstanding: Math.max(0, row.bakeryOutstanding || 0),
              excessCredit: row.bakeryExcess,
            }
          : undefined,
    },
  };
}

/**
 * Generates an official, unified Daily Fresh bill for combined Daily Bill rows (used in DailyBillingPage).
 */
export function printDailyBillInvoice(row: DailyBillInvoiceData) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups to print/export invoices.');
    return;
  }
  const unifiedData = buildUnifiedInvoiceDataFromDailyBill(row);
  const html = renderUnifiedInvoiceHtml(unifiedData);
  printWindow.document.write(html);
  printWindow.document.close();
}

export interface PrintClientStatementOptions {
  client: Client;
  entries: {
    displayDate: string;
    type: string;
    description: string;
    division?: string;
    debit: number;
    credit: number;
    balance: number;
  }[];
  metrics: {
    outstanding: number;
    credit: number;
    totalInvoiced: number;
    totalPaid: number;
  };
  division: string;
  dateRange?: {
    from?: string;
    to?: string;
  };
}

/**
 * Generates an official Client Statement of Account and triggers window.print().
 */
export function printClientStatement({ client, entries, metrics, division, dateRange }: PrintClientStatementOptions) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups to print/export statement.');
    return;
  }

  const divisionLabel = division === 'primary' ? 'Primary Foods' : division === 'bakery' ? 'Bakery Foods' : 'All Divisions';
  const periodLabel =
    dateRange?.from || dateRange?.to
      ? `${dateRange.from ? format(new Date(dateRange.from), 'dd MMM yyyy') : 'Start'} to ${
          dateRange.to ? format(new Date(dateRange.to), 'dd MMM yyyy') : 'Today'
        }`
      : 'All Time Account Statement';

  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes" />
        <title>Account Statement - ${client.name}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            color: #0f172a;
            padding: 32px;
            margin: 0;
            background: #fff;
            font-size: 13px;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 16px;
            margin-bottom: 20px;
          }
          .brand h1 { margin: 0; color: #b91c1c; font-size: 24px; font-weight: 900; }
          .brand p { margin: 2px 0; color: #64748b; font-size: 12px; }
          .brand .phone { color: #b91c1c; font-weight: 700; font-size: 12px; }
          .statement-meta { text-align: right; }
          .statement-meta h2 { margin: 0 0 2px 0; font-size: 20px; font-weight: 800; color: #0f172a; }
          .statement-meta p { margin: 2px 0; color: #475569; font-size: 12px; }
          .client-card {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 10px;
            padding: 14px 18px;
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
          }
          .kpi-row {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
            margin-bottom: 20px;
          }
          .kpi-card {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 10px 14px;
          }
          .kpi-card .label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; }
          .kpi-card .val { font-size: 18px; font-weight: 800; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th {
            text-align: left;
            padding: 8px 10px;
            background: #f1f5f9;
            color: #475569;
            font-size: 11px;
            text-transform: uppercase;
            font-weight: 700;
            border-bottom: 1px solid #e2e8f0;
          }
          td {
            padding: 8px 10px;
            border-bottom: 1px solid #f1f5f9;
            font-size: 12px;
          }
          .text-right { text-align: right; }
          .badge {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
          }
          .badge-inv { background: #e0f2fe; color: #0369a1; }
          .badge-pay { background: #dcfce7; color: #15803d; }
          .badge-ob { background: #f3e8ff; color: #7e22ce; }
          .footer {
            margin-top: 40px;
            text-align: center;
            font-size: 11px;
            color: #64748b;
            border-top: 1px solid #e2e8f0;
            padding-top: 14px;
          }
          @media screen and (max-width: 640px) {
            body { padding: 16px; }
            .kpi-row { grid-template-columns: repeat(2, 1fr); }
            .header { flex-direction: column; gap: 10px; }
            .statement-meta { text-align: left; }
          }
          @page { size: A4 portrait; margin: 10mm; }
          @media print {
            body { padding: 0; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="brand">
            <h1>${COMPANY_NAME}</h1>
            <p>${COMPANY_ADDRESS}</p>
            <p class="phone">${COMPANY_PHONE}</p>
          </div>
          <div class="statement-meta">
            <h2>ACCOUNT STATEMENT</h2>
            <p><strong>Division:</strong> ${divisionLabel}</p>
            <p><strong>Period:</strong> ${periodLabel}</p>
          </div>
        </div>

        <div class="client-card">
          <div>
            <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Customer Information</div>
            <div style="font-size: 18px; font-weight: 800; color: #0f172a; margin: 2px 0;">${client.name}</div>
            <div style="font-size: 13px; color: #475569;">Region: ${client.region || client.city || '—'} ${client.phone ? `· Phone: ${client.phone}` : ''}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Generated On</div>
            <div style="font-size: 13px; font-weight: 600; color: #0f172a; margin-top: 2px;">${format(new Date(), 'dd MMM yyyy, h:mm a')}</div>
          </div>
        </div>

        <div class="kpi-row">
          <div class="kpi-card">
            <div class="label">Total Invoiced</div>
            <div class="val" style="color: #0f172a;">₹${metrics.totalInvoiced.toFixed(2)}</div>
          </div>
          <div class="kpi-card">
            <div class="label">Total Paid</div>
            <div class="val" style="color: #166534;">₹${metrics.totalPaid.toFixed(2)}</div>
          </div>
          <div class="kpi-card">
            <div class="label">Net Outstanding Due</div>
            <div class="val" style="color: #b45309;">₹${metrics.outstanding.toFixed(2)}</div>
          </div>
          <div class="kpi-card">
            <div class="label">Available Advance Credit</div>
            <div class="val" style="color: #15803d;">₹${metrics.credit.toFixed(2)}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Description</th>
              <th class="text-right">Debit (₹)</th>
              <th class="text-right">Credit (₹)</th>
              <th class="text-right">Balance (₹)</th>
            </tr>
          </thead>
          <tbody>
            ${
              entries.length > 0
                ? entries
                    .map(
                      e => `
              <tr>
                <td style="white-space: nowrap;">${e.displayDate}</td>
                <td>
                  <span class="badge ${e.type === 'invoice' ? 'badge-inv' : e.type === 'payment' ? 'badge-pay' : 'badge-ob'}">
                    ${e.type === 'invoice' ? 'Invoice' : e.type === 'payment' ? 'Payment' : 'Opening'}
                  </span>
                </td>
                <td>${e.description} ${e.division ? `<span style="font-size:10px; color:#64748b;">(${e.division})</span>` : ''}</td>
                <td class="text-right">${e.debit > 0 ? `₹${e.debit.toFixed(2)}` : '—'}</td>
                <td class="text-right" style="color: ${e.credit > 0 ? '#166534' : 'inherit'};">${e.credit > 0 ? `₹${e.credit.toFixed(2)}` : '—'}</td>
                <td class="text-right" style="font-weight: 700; color: ${e.balance > 0 ? '#b45309' : e.balance < 0 ? '#166534' : '#64748b'};">
                  ${e.balance < 0 ? `₹${Math.abs(e.balance).toFixed(2)} CR` : `₹${e.balance.toFixed(2)}`}
                </td>
              </tr>
            `
                    )
                    .join('')
                : `
              <tr>
                <td colspan="6" style="text-align: center; padding: 24px; color: #94a3b8;">No transaction records found for this period.</td>
              </tr>
            `
            }
          </tbody>
        </table>

        <div class="footer">
          <p>${COMPANY_NAME} · ${COMPANY_ADDRESS} · ${COMPANY_PHONE}</p>
        </div>

        <script>
          window.addEventListener('load', function() {
            setTimeout(function() {
              window.print();
            }, 300);
          });
        </script>
      </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
}

/**
 * Generates an official Payment Receipt voucher and triggers window.print().
 */
export function printPaymentReceipt(payment: Payment, client?: Client | null) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups to print receipt.');
    return;
  }

  const clientName = payment.clientName || client?.name || 'Valued Customer';
  const region = payment.region || client?.region || '—';
  const receiptDate =
    payment.paymentDate ||
    (payment.createdAt ? format(new Date(payment.createdAt), 'dd MMM yyyy') : format(new Date(), 'dd MMM yyyy'));
  const staff = payment.recordedBy || payment.staffName || payment.updatedBy || 'Authorized Staff';

  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes" />
        <title>Receipt - ${payment.id}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #0f172a;
            padding: 32px;
            margin: 0;
            background: #fff;
          }
          .voucher {
            max-width: 500px;
            margin: 0 auto;
            border: 2px dashed #cbd5e1;
            border-radius: 14px;
            padding: 24px;
            background: #fafafa;
          }
          .brand { text-align: center; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 16px; }
          .brand h1 { margin: 0; color: #b91c1c; font-size: 22px; font-weight: 900; }
          .brand p { margin: 2px 0; color: #64748b; font-size: 12px; }
          .brand .phone { color: #b91c1c; font-weight: 700; font-size: 12px; }
          .title { text-align: center; font-size: 13px; font-weight: 800; letter-spacing: 1px; color: #475569; margin-bottom: 16px; }
          .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; border-bottom: 1px dotted #e2e8f0; }
          .row .label { color: #64748b; font-weight: 600; }
          .row .val { font-weight: 700; color: #0f172a; }
          .amount-box {
            background: #dcfce7;
            border: 1px solid #86efac;
            border-radius: 10px;
            padding: 12px;
            text-align: center;
            margin: 20px 0;
          }
          .amount-box .lbl { font-size: 11px; font-weight: 800; color: #166534; text-transform: uppercase; letter-spacing: 0.5px; }
          .amount-box .num { font-size: 28px; font-weight: 900; color: #15803d; margin-top: 2px; }
          .footer { text-align: center; font-size: 11px; color: #64748b; margin-top: 20px; line-height: 1.5; }
          @page { size: A5 portrait; margin: 10mm; }
          @media print {
            body { padding: 0; }
          }
        </style>
      </head>
      <body>
        <div class="voucher">
          <div class="brand">
            <h1>${COMPANY_NAME}</h1>
            <p>${COMPANY_ADDRESS}</p>
            <p class="phone">${COMPANY_PHONE}</p>
          </div>
          <div class="title">PAYMENT ACKNOWLEDGEMENT</div>

          <div class="row">
            <span class="label">Receipt No:</span>
            <span class="val font-mono">#${payment.id.slice(0, 10).toUpperCase()}</span>
          </div>
          <div class="row">
            <span class="label">Date:</span>
            <span class="val">${receiptDate}</span>
          </div>
          <div class="row">
            <span class="label">Received From:</span>
            <span class="val">${clientName}</span>
          </div>
          <div class="row">
            <span class="label">Region / Shop:</span>
            <span class="val">${region}</span>
          </div>
          <div class="row">
            <span class="label">Payment Mode:</span>
            <span class="val" style="text-transform: uppercase;">${payment.method}</span>
          </div>
          <div class="row">
            <span class="label">Division:</span>
            <span class="val" style="text-transform: capitalize;">${payment.division} Foods</span>
          </div>
          ${
            payment.reference
              ? `
            <div class="row">
              <span class="label">Reference:</span>
              <span class="val">${payment.reference}</span>
            </div>
          `
              : ''
          }

          <div class="amount-box">
            <div class="lbl">Amount Received</div>
            <div class="num">₹${Number(payment.amount || 0).toFixed(2)}</div>
          </div>

          <div class="row">
            <span class="label">Collected By:</span>
            <span class="val">${staff}</span>
          </div>

          <div class="footer">
            <p>Thank you for your payment!</p>
            <p>${COMPANY_NAME} · System Generated Voucher</p>
          </div>
        </div>

        <script>
          window.addEventListener('load', function() {
            setTimeout(function() {
              window.print();
            }, 300);
          });
        </script>
      </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
}
