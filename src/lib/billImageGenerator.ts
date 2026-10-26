/**
 * Daily Fresh ERP — Bill Image (JPG) Generator & Share Engine
 *
 * Generates single, high-quality, high-DPI JPG images of bills/invoices directly
 * in the browser using HTML5 Canvas API with zero external cloud dependencies.
 *
 * Features:
 * 1. Self-contained 2x retina canvas rendering.
 * 2. Complete financial & division reconciliation (Primary & Bakery Foods).
 * 3. Web Share API file-sharing integration for instant mobile WhatsApp sharing.
 * 4. Reliable download fallback with direct WhatsApp link for unsupported environments.
 */

import {
  type UnifiedInvoiceData,
  type DailyBillInvoiceData,
  type PrintOrderInvoiceOptions,
  buildUnifiedInvoiceDataFromOrder,
  buildUnifiedInvoiceDataFromDailyBill,
  COMPANY_NAME,
  COMPANY_ADDRESS,
  COMPANY_PHONE,
} from './invoicePrint';

export interface ShareBillJpgResult {
  success: boolean;
  method: 'web_share' | 'download';
  fileName: string;
  error?: string;
}

/**
 * Sanitizes a bill number into a safe, alphanumeric filename.
 */
export function getBillJpgFilename(billNumber: string): string {
  const clean = billNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `DailyFresh_Bill_${clean}.jpg`;
}

/**
 * Builds a WhatsApp URL for a given phone and optional text.
 */
export function buildWhatsAppUrl(phone?: string, text?: string): string {
  const cleanPhone = phone ? phone.replace(/[^0-9]/g, '') : '';
  const encodedText = text ? encodeURIComponent(text) : '';
  if (cleanPhone) {
    return encodedText
      ? `https://wa.me/${cleanPhone}?text=${encodedText}`
      : `https://wa.me/${cleanPhone}`;
  }
  return encodedText ? `https://wa.me/?text=${encodedText}` : 'https://wa.me/';
}

/**
 * Helper to split text into lines that fit within a maximum width.
 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = ctx.measureText(testLine).width;
    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines.length > 0 ? lines : [text];
}

/**
 * Draws a rounded rectangle path on canvas.
 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
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

/**
 * Generates an HTMLCanvasElement rendering the complete, unified Daily Fresh bill.
 * Uses a crisp 2x scale factor for high-resolution mobile reading and WhatsApp sharing.
 */
export function generateBillCanvas(data: UnifiedInvoiceData): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('generateBillCanvas must be executed in a browser environment with DOM access.');
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D rendering context from canvas.');
  }

  const logicalWidth = 800;
  const scale = 2; // High-DPI 2x supersampling for crisp mobile text

  const primaryItems = data.items.filter((i) => i.division === 'primary');
  const bakeryItems = data.items.filter((i) => i.division === 'bakery');
  const isMultiDiv = primaryItems.length > 0 && bakeryItems.length > 0;
  const hasAnyRate = data.items.some((i) => (i.rate && i.rate > 0) || (i.unitPrice && i.unitPrice > 0));

  // ── Calculate dynamic canvas height to prevent any content clipping ──
  const baseHeaderHeight = 160;
  const clientCardHeight = 100;
  const tableHeaderHeight = 36;
  const itemRowHeight = 30;
  const itemsCount = data.items.length;
  const sectionHeadersHeight = isMultiDiv ? 76 : 0; // Two section pills + subtotals
  const tableHeight = tableHeaderHeight + itemsCount * itemRowHeight + sectionHeadersHeight;

  let summaryHeight = 180;
  const prevOut = Number(data.previousOutstanding !== undefined ? data.previousOutstanding : data.previousBalance || 0);
  const prevCred = Number(data.previousAvailableCredit !== undefined ? data.previousAvailableCredit : (data.hasAdvanceCredit ? data.totalAdvanceCredit : 0));
  const credApp = Number(data.creditApplied || 0);
  const totPaid = Number(data.totalPaid || 0);
  const payForBill = Number(data.paymentReceivedForBill !== undefined ? data.paymentReceivedForBill : (data.appliedToBill || 0));
  const appToPrev = Number(data.appliedToPrevious || 0);
  const availCredAfter = Number(data.availableCreditAfterBill !== undefined ? data.availableCreditAfterBill : 0);

  if (data.allocationWarning) summaryHeight += 30;
  if (prevOut > 0) summaryHeight += 30;
  if (prevCred > 0) summaryHeight += 30;
  if (credApp > 0) summaryHeight += 30;
  if (data.tax && data.tax > 0) summaryHeight += 25;
  if (data.discount && data.discount > 0) summaryHeight += 25;
  if (totPaid > 0 || payForBill > 0) summaryHeight += 40;
  if (appToPrev > 0) summaryHeight += 25;
  if (availCredAfter > 0) summaryHeight += 30;
  if (isMultiDiv) summaryHeight += 40;

  const grandBannerHeight = 54;
  const footerHeight = 80;
  const padding = 50;

  const logicalHeight =
    baseHeaderHeight +
    clientCardHeight +
    tableHeight +
    summaryHeight +
    grandBannerHeight +
    footerHeight +
    padding;

  canvas.width = logicalWidth * scale;
  canvas.height = logicalHeight * scale;
  ctx.scale(scale, scale);

  // Background - Pure Crisp White
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, logicalWidth, logicalHeight);

  // Top Red Brand Accent Bar
  ctx.fillStyle = '#B91C1C';
  ctx.fillRect(0, 0, logicalWidth, 6);

  let curY = 32;

  // ── 1. Company Brand Header ──
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(COMPANY_NAME, 36, curY);

  ctx.fillStyle = '#475569';
  ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(COMPANY_ADDRESS, 36, curY + 18);

  ctx.fillStyle = '#B91C1C';
  ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(COMPANY_PHONE, 36, curY + 34);

  // Right Header: Invoice Meta
  ctx.textAlign = 'right';
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('BILL / INVOICE', logicalWidth - 36, curY);

  ctx.fillStyle = '#B91C1C';
  ctx.font = 'bold 13px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillText(`#${data.billNumber}`, logicalWidth - 36, curY + 18);

  ctx.fillStyle = '#475569';
  ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(`Date: ${data.deliveryDate}`, logicalWidth - 36, curY + 34);

  // Status & Division Pills
  const statusX = logicalWidth - 36;
  const pillY = curY + 44;

  // Draw Status Badge
  const isPaid = data.totalOutstanding <= 0.01;
  const statusBg = isPaid ? '#DCFCE7' : data.totalPaid > 0 ? '#FEF3C7' : '#FEE2E2';
  const statusTextColor = isPaid ? '#166534' : data.totalPaid > 0 ? '#B45309' : '#991B1B';
  const statusLabel = data.statusText || (isPaid ? 'PAID' : 'PENDING');

  ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const statusWidth = ctx.measureText(statusLabel).width + 16;
  roundRect(ctx, statusX - statusWidth, pillY, statusWidth, 20, 4);
  ctx.fillStyle = statusBg;
  ctx.fill();
  ctx.fillStyle = statusTextColor;
  ctx.textAlign = 'center';
  ctx.fillText(statusLabel, statusX - statusWidth / 2, pillY + 14);

  // Draw Division Badge
  const divLabel = data.divisionLabel || 'Primary Foods';
  const divBg = divLabel.includes('Primary') && divLabel.includes('Bakery')
    ? '#F1F5F9'
    : divLabel.includes('Bakery')
    ? '#FFFBEB'
    : '#EFF6FF';
  const divTextColor = divLabel.includes('Primary') && divLabel.includes('Bakery')
    ? '#334155'
    : divLabel.includes('Bakery')
    ? '#B45309'
    : '#1D4ED8';
  const divWidth = ctx.measureText(divLabel).width + 16;
  const divX = statusX - statusWidth - 8 - divWidth;

  roundRect(ctx, divX, pillY, divWidth, 20, 4);
  ctx.fillStyle = divBg;
  ctx.fill();
  ctx.fillStyle = divTextColor;
  ctx.fillText(divLabel, divX + divWidth / 2, pillY + 14);

  curY += 80;

  // Header separator line
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(36, curY);
  ctx.lineTo(logicalWidth - 36, curY);
  ctx.stroke();

  curY += 14;

  // ── 2. Client & Route Information Card ──
  const cardY = curY;
  const cardH = 80;
  roundRect(ctx, 36, cardY, logicalWidth - 72, cardH, 8);
  ctx.fillStyle = '#F8FAFC';
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#64748B';
  ctx.font = 'bold 9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('BILLED TO (CUSTOMER):', 52, cardY + 20);

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(data.client.name, 52, cardY + 38);

  ctx.fillStyle = '#475569';
  ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const clientMeta: string[] = [];
  if (data.client.region && data.client.region !== '—') clientMeta.push(`Region: ${data.client.region}`);
  if (data.client.phone) clientMeta.push(`Phone: ${data.client.phone}`);
  if (data.client.address) clientMeta.push(data.client.address);
  ctx.fillText(clientMeta.join('  ·  ') || 'Customer Account', 52, cardY + 56);

  // Right side of client card: Staff / Route
  ctx.textAlign = 'right';
  ctx.fillStyle = '#64748B';
  ctx.font = 'bold 9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('DELIVERY / ROUTE STAFF:', logicalWidth - 52, cardY + 20);

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(data.staffName || 'Daily Fresh Team', logicalWidth - 52, cardY + 38);

  const auditOrNotes = data.notes || data.updatedInfo;
  if (auditOrNotes) {
    ctx.fillStyle = '#64748B';
    ctx.font = 'italic 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(`${auditOrNotes.slice(0, 48)}`, logicalWidth - 52, cardY + 56);
  }

  curY += cardH + 16;

  // ── 3. Items Table ──
  const tableX = 36;
  const tableW = logicalWidth - 72;

  // Table Header
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

  let itemIdx = 0;

  const renderSingleItem = (item: (typeof data.items)[0]) => {
    itemIdx += 1;
    const isEven = itemIdx % 2 === 0;

    ctx.fillStyle = isEven ? '#FBFBFC' : '#FFFFFF';
    ctx.fillRect(tableX, curY, tableW, itemRowHeight);

    ctx.strokeStyle = '#F1F5F9';
    ctx.beginPath();
    ctx.moveTo(tableX, curY + itemRowHeight);
    ctx.lineTo(tableX + tableW, curY + itemRowHeight);
    ctx.stroke();

    // Item Number
    ctx.textAlign = 'center';
    ctx.fillStyle = '#64748B';
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(String(itemIdx), tableX + 24, curY + 19);

    // Item Name (wrapped if long)
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const maxNameW = hasAnyRate ? tableW - 300 : tableW - 240;
    const wrappedName = wrapText(ctx, item.productName, maxNameW);
    ctx.fillText(wrappedName[0], tableX + 54, curY + 19);

    // Qty
    ctx.textAlign = 'right';
    ctx.fillStyle = '#1E293B';
    ctx.font = '700 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const qtyText = item.unit ? `${item.qty} ${item.unit}` : `${item.qty}`;

    if (hasAnyRate) {
      ctx.fillText(qtyText, tableX + tableW - 190, curY + 19);
      ctx.fillStyle = '#64748B';
      ctx.font = '600 11px ui-monospace, Menlo, Consolas, monospace';
      const rateVal = item.rate || item.unitPrice || 0;
      ctx.fillText(rateVal > 0 ? `₹${rateVal.toFixed(2)}` : '—', tableX + tableW - 100, curY + 19);
    } else {
      ctx.fillText(qtyText, tableX + tableW - 130, curY + 19);
    }

    // Total Amount
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 11px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(`₹${Number(item.total || 0).toFixed(2)}`, tableX + tableW - 16, curY + 19);

    curY += itemRowHeight;
  };

  if (isMultiDiv) {
    // Primary Section Pill
    roundRect(ctx, tableX + 6, curY + 4, 110, 20, 4);
    ctx.fillStyle = '#EFF6FF';
    ctx.fill();
    ctx.fillStyle = '#1D4ED8';
    ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PRIMARY FOODS', tableX + 61, curY + 18);
    curY += 26;

    primaryItems.forEach(renderSingleItem);

    // Primary Subtotal Row
    const pSub = primaryItems.reduce((s, i) => s + (i.total || 0), 0);
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(tableX, curY, tableW, 24);
    ctx.fillStyle = '#1D4ED8';
    ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Primary Subtotal:', tableX + tableW - 130, curY + 16);
    ctx.fillText(`₹${pSub.toFixed(2)}`, tableX + tableW - 16, curY + 16);
    curY += 28;

    // Bakery Section Pill
    roundRect(ctx, tableX + 6, curY + 4, 110, 20, 4);
    ctx.fillStyle = '#FFFBEB';
    ctx.fill();
    ctx.fillStyle = '#B45309';
    ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BAKERY FOODS', tableX + 61, curY + 18);
    curY += 26;

    bakeryItems.forEach(renderSingleItem);

    // Bakery Subtotal Row
    const bSub = bakeryItems.reduce((s, i) => s + (i.total || 0), 0);
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(tableX, curY, tableW, 24);
    ctx.fillStyle = '#B45309';
    ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Bakery Subtotal:', tableX + tableW - 130, curY + 16);
    ctx.fillText(`₹${bSub.toFixed(2)}`, tableX + tableW - 16, curY + 16);
    curY += 32;
  } else {
    data.items.forEach(renderSingleItem);
    curY += 12;
  }

  // ── 4. Financial Summary & Accounting Section ──
  curY += 8;
  const summaryBoxW = 380;
  const summaryBoxX = tableX + tableW - summaryBoxW;

  const renderSummaryRow = (label: string, value: string, isBold = false, color = '#0F172A', indent = 0) => {
    ctx.fillStyle = '#64748B';
    ctx.font = `${isBold ? 'bold' : '500'} 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(label, summaryBoxX + indent, curY + 14);

    ctx.fillStyle = color;
    ctx.font = `${isBold ? 'bold' : '600'} 12px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(value, tableX + tableW, curY + 14);

    curY += 20;
  };

  renderSummaryRow('Items Subtotal:', `₹${data.subtotal.toFixed(2)}`, true, '#0F172A');

  if (data.allocationWarning) {
    renderSummaryRow('Payment Allocation Status:', 'Review required', true, '#D97706');
  }

  if (data.discount && data.discount > 0) {
    renderSummaryRow('Discount:', `-₹${data.discount.toFixed(2)}`, false, '#16A34A');
  }

  if (data.tax && data.tax > 0) {
    renderSummaryRow('Tax / GST:', `₹${data.tax.toFixed(2)}`, false, '#475569');
  }

  const prevOutVal = Number(data.previousOutstanding !== undefined ? data.previousOutstanding : (data.previousBalance || 0));
  if (prevOutVal > 0) {
    renderSummaryRow('Previous Outstanding:', `₹${prevOutVal.toFixed(2)}`, false, '#475569');
  }

  const prevCredVal = Number(data.previousAvailableCredit !== undefined ? data.previousAvailableCredit : (data.hasAdvanceCredit ? data.totalAdvanceCredit : 0));
  if (prevCredVal > 0) {
    renderSummaryRow('Previous Available Customer Credit:', `– ₹${prevCredVal.toFixed(2)}`, false, '#15803D');
  }

  if (data.creditApplied > 0) {
    renderSummaryRow('Credit Applied to This Bill:', `– ₹${data.creditApplied.toFixed(2)}`, true, '#15803D');
  }

  const payForBillVal = Number(data.paymentReceivedForBill !== undefined ? data.paymentReceivedForBill : (data.appliedToBill || 0));
  const totPaidVal = Number(data.totalPaid || 0);
  const appliedToP = Number(data.appliedToPrevious || 0);

  if (totPaidVal > 0 || payForBillVal > 0) {
    renderSummaryRow('Payment Received for This Bill:', `₹${payForBillVal.toFixed(2)}`, true, '#15803D');
    if (appliedToP > 0) {
      renderSummaryRow('↳ Applied to Old Balance:', `₹${appliedToP.toFixed(2)}`, false, '#166534', 12);
    }
    const excessCreditVal = Number(data.excessAddedToCredit !== undefined ? data.excessAddedToCredit : Math.max(0, totPaidVal - payForBillVal - appliedToP));
    if (excessCreditVal > 0.01) {
      renderSummaryRow('↳ Added to Customer Credit:', `+₹${excessCreditVal.toFixed(2)}`, false, '#166534', 12);
    }
  }

  if (data.billRemaining > 0) {
    renderSummaryRow('This Bill Remaining:', `₹${data.billRemaining.toFixed(2)}`, true, '#D97706');
  } else if (data.creditApplied > 0 || totPaidVal > 0) {
    renderSummaryRow('This Bill Remaining:', '₹0.00 (Settled)', true, '#16A34A');
  } else {
    renderSummaryRow('This Bill Remaining:', `₹${Number(data.billRemaining || 0).toFixed(2)}`, true, '#0F172A');
  }

  const availCredAfterVal = Number(data.availableCreditAfterBill !== undefined ? data.availableCreditAfterBill : 0);
  if (availCredAfterVal > 0) {
    renderSummaryRow('Available Credit After This Bill:', `₹${availCredAfterVal.toFixed(2)}`, true, '#15803D');
  }

  curY += 12;

  // ── 5. TOTAL OUTSTANDING BANNER ──
  const bannerY = curY;
  const bannerH = 50;
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
    ctx.fillText(`₹${data.totalOutstanding.toFixed(2)}`, tableX + tableW - 20, bannerY + 32);
  }

  curY += bannerH + 24;

  // ── 6. Footer ──
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
  ctx.fillText(`Thank you for partnering with ${COMPANY_NAME}!`, logicalWidth / 2, curY);

  ctx.fillStyle = '#64748B';
  ctx.font = '500 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(`${COMPANY_ADDRESS} · ${COMPANY_PHONE}`, logicalWidth / 2, curY + 16);

  ctx.fillStyle = '#94A3B8';
  ctx.font = '400 9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('Computer generated document · No signature required · Daily Fresh ERP', logicalWidth / 2, curY + 30);

  return canvas;
}

/**
 * Converts a UnifiedInvoiceData object into a high-quality JPEG Blob.
 */
export async function generateBillJpgBlob(data: UnifiedInvoiceData, quality = 0.95): Promise<Blob> {
  const canvas = generateBillCanvas(data);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas toBlob conversion failed.'));
        }
      },
      'image/jpeg',
      quality
    );
  });
}

/**
 * Downloads the generated bill JPG directly to the user's device.
 */
export async function downloadBillJpg(data: UnifiedInvoiceData): Promise<string> {
  const blob = await generateBillJpgBlob(data);
  const fileName = getBillJpgFilename(data.billNumber);

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Defer revoking so the browser download manager can consume it
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return fileName;
}

/**
 * Primary sharing function:
 * - Uses Web Share API if supported by the browser/device to share the JPG file directly.
 * - Falls back cleanly to direct file download if unsupported.
 * - Strictly does NOT claim the image was sent automatically unless platform confirms it.
 */
export async function shareBillAsJpg(data: UnifiedInvoiceData): Promise<ShareBillJpgResult> {
  const fileName = getBillJpgFilename(data.billNumber);
  const blob = await generateBillJpgBlob(data);
  const file = new File([blob], fileName, { type: 'image/jpeg' });

  // 1. Try Web Share API with file support
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({
        title: `Bill ${data.billNumber} · Daily Fresh`,
        text: `Daily Fresh invoice #${data.billNumber} for ${data.client.name}`,
        files: [file],
      });
      return { success: true, method: 'web_share', fileName };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // User cancelled or dismissed the native share sheet
        return { success: false, method: 'web_share', fileName, error: 'Share cancelled' };
      }
      // If native sharing failed unexpectedly, fall through to download fallback
    }
  }

  // 2. Reliable Fallback: Direct File Download
  await downloadBillJpg(data);
  return { success: true, method: 'download', fileName };
}

/**
 * Convenience helper to share or download a combined Daily Bill row as a JPG image.
 */
export async function shareDailyBillJpg(row: DailyBillInvoiceData): Promise<ShareBillJpgResult> {
  const unifiedData = buildUnifiedInvoiceDataFromDailyBill(row);
  return shareBillAsJpg(unifiedData);
}

/**
 * Convenience helper to share or download a single Order as a JPG image.
 */
export async function shareOrderInvoiceJpg(options: PrintOrderInvoiceOptions): Promise<ShareBillJpgResult> {
  const unifiedData = buildUnifiedInvoiceDataFromOrder(options);
  return shareBillAsJpg(unifiedData);
}

