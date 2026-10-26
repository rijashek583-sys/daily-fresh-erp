/**
 * Daily Fresh ERP — Dynamic Proportional Primary / Bakery Payment Collection Policy
 *
 * CANONICAL ACCOUNTING RULES:
 * 1. Delivery Date Grouping:
 *    - The selected delivery date is settled first.
 *    - All prior/other delivery dates are settled in chronological order (oldest date first).
 *
 * 2. Dynamic Primary / Bakery Proportional Allocation:
 *    - Within each delivery date, payment is distributed proportionally according to the
 *      unpaid dues of Primary Foods vs Bakery Foods on that specific date.
 *    - Proportional formula:
 *        primaryShare = floor(applied * primaryDue / totalDue)
 *        bakeryShare  = floor(applied * bakeryDue / totalDue)
 *    - Remainder tie-breaker:
 *        If fractional remainder exists, Primary Foods wins equal or higher remainders:
 *        (applied * primaryDue % totalDue >= applied * bakeryDue % totalDue) ? primaryShare++ : bakeryShare++
 *
 * 3. Oldest-Invoice-First Internal Attribution:
 *    - Within each division on a given date, the division's share is attributed to individual
 *      invoices ordered by reliable creation timestamp (orderedAt, oldest first), then by invoiceId.
 *
 * 4. Advance Credit Creation:
 *    - Only payment amount remaining after ALL client obligations across all delivery dates
 *      are settled becomes unified customer advance credit (generalCredit).
 *
 * 5. Primary-First Credit Application:
 *    - Advance credit application to new orders remains strictly Primary-first, then Bakery.
 *    - This is preserved as a separate rule from payment collection.
 */

export type FinancialDivision = 'primary' | 'bakery';

export interface InvoiceObligationInput {
  invoiceId: string;
  orderId?: string;
  clientId: string;
  deliveryDate: string; // 'YYYY-MM-DD'
  division: FinancialDivision;
  /** Persisted reliable UTC creation timestamp (or bill date) */
  orderedAt?: string;
  /** Unpaid amount in Rupees (e.g. 150.50) */
  unpaidAmount?: number;
  /** Unpaid amount in integer Paise (e.g. 15050). Takes precedence if provided. */
  unpaidPaise?: number;
}

export class FinancialEvidenceError extends Error {
  constructor(public readonly code: 'ORDERING_EVIDENCE_MISSING' | 'OPENING_BALANCE_UNRESOLVED' | 'INVALID_DELIVERY_DATE', message: string) {
    super(message);
    this.name = 'FinancialEvidenceError';
  }
}

export interface ProportionalPaymentPolicyInput {
  clientId: string;
  /** Payment amount in Rupees (e.g. 500.00) */
  paymentAmount: number;
  /** Payment amount in integer Paise (optional, e.g. 50000) */
  paymentPaise?: number;
  /** Target delivery date to settle first (e.g. today's delivery date). If null/undefined, oldest dates are settled first. */
  selectedDeliveryDate?: string | null;
  /** Array of all unpaid obligations for this client */
  obligations: readonly InvoiceObligationInput[];
  /** Flag for direct cash sales (no customer credit, no prior balance) */
  isDirectSale?: boolean;
  /** Flag indicating client has unresolved legacy opening balance evidence */
  hasUnresolvedOpeningBalance?: boolean;
}

export interface InvoicePaymentAttribution {
  invoiceId: string;
  orderId?: string;
  division: FinancialDivision;
  deliveryDate: string;
  amountPaise: number;
  amount: number; // in Rupees
}

export interface DeliveryDateAllocationSummary {
  deliveryDate: string;
  primaryDuePaise: number;
  bakeryDuePaise: number;
  totalDuePaise: number;
  primaryDue: number;
  bakeryDue: number;
  totalDue: number;
  primaryAllocatedPaise: number;
  bakeryAllocatedPaise: number;
  totalAllocatedPaise: number;
  primaryAllocated: number;
  bakeryAllocated: number;
  totalAllocated: number;
}

export interface ProportionalPaymentPolicyResult {
  status: 'allocated';
  clientId: string;
  paymentAmount: number;
  paymentPaise: number;
  totalAllocated: number;
  totalAllocatedPaise: number;
  excessCredit: number; // in Rupees
  unifiedAdvancePaise: number; // in Paise
  isAdvance: boolean;

  // Division-level totals across the entire payment:
  primaryAllocated: number;
  primaryAllocatedPaise: number;
  bakeryAllocated: number;
  bakeryAllocatedPaise: number;

  // Individual invoice-level attributions:
  attributions: InvoicePaymentAttribution[];

  // Delivery date summaries:
  dateSummaries: DeliveryDateAllocationSummary[];

  // UI-convenience breakdowns for the selected delivery date vs previous dates:
  appliedToBill: number;
  appliedToPrimaryBill: number;
  appliedToBakeryBill: number;
  appliedToOtherBill: number;
  totalAppliedToBill: number;

  appliedToPrevious: number;
  appliedToSameDivisionPrevious: number;
  appliedToOtherDivisionPrevious: number;

  remainingBill: number;
  remainingOtherBill: number;
  remainingTotalBill: number;
  remainingPrevious: number;
  remainingTotalOutstanding: number;
}

export function toPaise(rupees: number): number {
  if (typeof rupees !== 'number' || !Number.isFinite(rupees) || rupees < 0) return 0;
  return Math.round((rupees + Number.EPSILON) * 100);
}

export function toRupees(paise: number | bigint): number {
  const num = typeof paise === 'bigint' ? Number(paise) : paise;
  if (!Number.isFinite(num)) return 0;
  return Math.round(num) / 100;
}

const compareStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Pure Proportional Payment Allocation Engine.
 *
 * Implements dynamic proportional division allocation, delivery date grouping,
 * and reliable internal attribution to oldest invoices first.
 */
export function allocateProportionalPayment(
  input: ProportionalPaymentPolicyInput,
): ProportionalPaymentPolicyResult {
  const paymentPaise = input.paymentPaise !== undefined
    ? Math.max(0, Math.round(input.paymentPaise))
    : toPaise(input.paymentAmount);

  if (input.hasUnresolvedOpeningBalance) {
    throw new FinancialEvidenceError(
      'OPENING_BALANCE_UNRESOLVED',
      'Client has unresolved legacy opening balance evidence without approved reconciliation.'
    );
  }

  const selectedDate = input.selectedDeliveryDate?.trim() || null;
  if (selectedDate && (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate) || Number(selectedDate.slice(0, 4)) < 2000)) {
    throw new FinancialEvidenceError(
      'INVALID_DELIVERY_DATE',
      `Selected delivery date "${selectedDate}" is invalid or before year 2000. Defaulting to historical dates is forbidden.`
    );
  }

  const isDirectSale = Boolean(input.isDirectSale || input.clientId === 'direct');

  // Normalize and group valid unpaid obligations by deliveryDate
  const dateGroups = new Map<string, Array<{
    invoiceId: string;
    orderId?: string;
    division: FinancialDivision;
    deliveryDate: string;
    orderedAt: string;
    unpaidPaise: number;
  }>>();

  for (const o of input.obligations) {
    if (!o) continue;

    const unpaidPaise = o.unpaidPaise !== undefined
      ? Math.max(0, Math.round(o.unpaidPaise))
      : toPaise(o.unpaidAmount || 0);

    if (unpaidPaise <= 0) continue;

    if (!o.invoiceId || typeof o.invoiceId !== 'string' || !o.invoiceId.trim()) {
      throw new FinancialEvidenceError(
        'ORDERING_EVIDENCE_MISSING',
        'Invoice obligation is missing a valid invoiceId.'
      );
    }

    if (o.division !== 'primary' && o.division !== 'bakery') {
      throw new FinancialEvidenceError(
        'ORDERING_EVIDENCE_MISSING',
        `Invoice #${o.invoiceId} has invalid financial division: "${o.division}". Must be 'primary' or 'bakery'.`
      );
    }

    if (!o.deliveryDate || !/^\d{4}-\d{2}-\d{2}$/.test(o.deliveryDate) || Number(o.deliveryDate.slice(0, 4)) < 2000) {
      throw new FinancialEvidenceError(
        'ORDERING_EVIDENCE_MISSING',
        `Invoice #${o.invoiceId} is missing a valid deliveryDate (received "${o.deliveryDate}"). Defaulting to 1970-01-01 is forbidden.`
      );
    }

    if (!o.orderedAt || typeof o.orderedAt !== 'string' || isNaN(Date.parse(o.orderedAt))) {
      throw new FinancialEvidenceError(
        'ORDERING_EVIDENCE_MISSING',
        `Invoice #${o.invoiceId} is missing a reliable ordering timestamp (orderedAt). Fabricating timestamps is forbidden.`
      );
    }

    const dDate = o.deliveryDate;
    const orderedAt = o.orderedAt;

    const list = dateGroups.get(dDate) ?? [];
    list.push({
      invoiceId: o.invoiceId,
      orderId: o.orderId,
      division: o.division,
      deliveryDate: dDate,
      orderedAt,
      unpaidPaise,
    });
    dateGroups.set(dDate, list);
  }

  // Determine chronological ordering of delivery dates:
  // 1. If selectedDate exists, it is evaluated first.
  // 2. All remaining dates are sorted in chronological order (oldest first).
  const allDates = Array.from(dateGroups.keys());
  let orderedDates: string[];

  if (selectedDate && dateGroups.has(selectedDate)) {
    const otherDates = allDates.filter((d) => d !== selectedDate).sort(compareStr);
    orderedDates = [selectedDate, ...otherDates];
  } else {
    orderedDates = allDates.sort(compareStr);
  }

  let remainingPaise = BigInt(paymentPaise);
  let totalAllocatedPaise = 0n;
  let primaryAllocatedPaise = 0n;
  let bakeryAllocatedPaise = 0n;

  const attributions: InvoicePaymentAttribution[] = [];
  const dateSummaries: DeliveryDateAllocationSummary[] = [];

  for (const date of orderedDates) {
    const items = dateGroups.get(date) ?? [];
    const primaryDuePaise = items
      .filter((i) => i.division === 'primary')
      .reduce((sum, i) => sum + BigInt(i.unpaidPaise), 0n);

    const bakeryDuePaise = items
      .filter((i) => i.division === 'bakery')
      .reduce((sum, i) => sum + BigInt(i.unpaidPaise), 0n);

    const groupTotalDuePaise = primaryDuePaise + bakeryDuePaise;

    if (groupTotalDuePaise === 0n) continue;

    const appliedForGroup = remainingPaise < groupTotalDuePaise ? remainingPaise : groupTotalDuePaise;

    let pShare = 0n;
    let bShare = 0n;

    if (appliedForGroup > 0n && groupTotalDuePaise > 0n) {
      pShare = (appliedForGroup * primaryDuePaise) / groupTotalDuePaise;
      bShare = (appliedForGroup * bakeryDuePaise) / groupTotalDuePaise;

      const remainder = appliedForGroup - (pShare + bShare);
      if (remainder > 0n) {
        const pFraction = (appliedForGroup * primaryDuePaise) % groupTotalDuePaise;
        const bFraction = (appliedForGroup * bakeryDuePaise) % groupTotalDuePaise;
        if (pFraction >= bFraction) {
          pShare += remainder;
        } else {
          bShare += remainder;
        }
      }
    }

    // Attribute pShare to Primary invoices on this date (oldest orderedAt first, then invoiceId)
    const primaryItems = items
      .filter((i) => i.division === 'primary')
      .sort((a, b) => compareStr(a.orderedAt, b.orderedAt) || compareStr(a.invoiceId, b.invoiceId));

    let pLeft = pShare;
    for (const item of primaryItems) {
      if (pLeft <= 0n) break;
      const itemUnpaid = BigInt(item.unpaidPaise);
      const allocated = pLeft < itemUnpaid ? pLeft : itemUnpaid;
      if (allocated > 0n) {
        attributions.push({
          invoiceId: item.invoiceId,
          orderId: item.orderId,
          division: 'primary',
          deliveryDate: date,
          amountPaise: Number(allocated),
          amount: toRupees(allocated),
        });
        pLeft -= allocated;
      }
    }

    // Attribute bShare to Bakery invoices on this date (oldest orderedAt first, then invoiceId)
    const bakeryItems = items
      .filter((i) => i.division === 'bakery')
      .sort((a, b) => compareStr(a.orderedAt, b.orderedAt) || compareStr(a.invoiceId, b.invoiceId));

    let bLeft = bShare;
    for (const item of bakeryItems) {
      if (bLeft <= 0n) break;
      const itemUnpaid = BigInt(item.unpaidPaise);
      const allocated = bLeft < itemUnpaid ? bLeft : itemUnpaid;
      if (allocated > 0n) {
        attributions.push({
          invoiceId: item.invoiceId,
          orderId: item.orderId,
          division: 'bakery',
          deliveryDate: date,
          amountPaise: Number(allocated),
          amount: toRupees(allocated),
        });
        bLeft -= allocated;
      }
    }

    primaryAllocatedPaise += pShare;
    bakeryAllocatedPaise += bShare;
    totalAllocatedPaise += appliedForGroup;
    remainingPaise -= appliedForGroup;

    dateSummaries.push({
      deliveryDate: date,
      primaryDuePaise: Number(primaryDuePaise),
      bakeryDuePaise: Number(bakeryDuePaise),
      totalDuePaise: Number(groupTotalDuePaise),
      primaryDue: toRupees(primaryDuePaise),
      bakeryDue: toRupees(bakeryDuePaise),
      totalDue: toRupees(groupTotalDuePaise),
      primaryAllocatedPaise: Number(pShare),
      bakeryAllocatedPaise: Number(bShare),
      totalAllocatedPaise: Number(appliedForGroup),
      primaryAllocated: toRupees(pShare),
      bakeryAllocated: toRupees(bShare),
      totalAllocated: toRupees(appliedForGroup),
    });
  }

  // Direct sales cannot generate advance customer credit
  const excessCreditPaise = isDirectSale ? 0n : remainingPaise;
  const isAdvance = totalAllocatedPaise === 0n && excessCreditPaise > 0n;

  // Selected date vs Previous dates breakdown
  const selectedDateSummary = selectedDate
    ? dateSummaries.find((d) => d.deliveryDate === selectedDate)
    : null;

  const appliedToPrimaryBill = selectedDateSummary?.primaryAllocated ?? 0;
  const appliedToBakeryBill = selectedDateSummary?.bakeryAllocated ?? 0;
  const appliedToBill = toRupees(
    BigInt(selectedDateSummary?.totalAllocatedPaise ?? 0),
  );

  const previousDateSummaries = selectedDate
    ? dateSummaries.filter((d) => d.deliveryDate !== selectedDate)
    : dateSummaries;

  const appliedToSameDivisionPrevious = 0; // Calculated dynamically in context
  const appliedToOtherDivisionPrevious = 0;
  const appliedToPreviousPaise = previousDateSummaries.reduce(
    (sum, d) => sum + BigInt(d.totalAllocatedPaise),
    0n,
  );
  const appliedToPrevious = toRupees(appliedToPreviousPaise);

  const billDuePaise = selectedDateSummary?.totalDuePaise ?? 0;
  const billAllocatedPaise = selectedDateSummary?.totalAllocatedPaise ?? 0;
  const remainingTotalBill = toRupees(Math.max(0, billDuePaise - billAllocatedPaise));
  const remainingBill = toRupees(
    Math.max(0, (selectedDateSummary?.primaryDuePaise ?? 0) - (selectedDateSummary?.primaryAllocatedPaise ?? 0)),
  );
  const remainingOtherBill = toRupees(
    Math.max(0, (selectedDateSummary?.bakeryDuePaise ?? 0) - (selectedDateSummary?.bakeryAllocatedPaise ?? 0)),
  );

  const previousDuePaise = previousDateSummaries.reduce(
    (sum, d) => sum + BigInt(d.totalDuePaise),
    0n,
  );
  const remainingPrevious = toRupees(
    Math.max(0, Number(previousDuePaise - appliedToPreviousPaise)),
  );
  const remainingTotalOutstanding = toRupees(
    Number(BigInt(toPaise(remainingTotalBill)) + BigInt(toPaise(remainingPrevious))),
  );

  return {
    status: 'allocated',
    clientId: input.clientId,
    paymentAmount: toRupees(paymentPaise),
    paymentPaise,
    totalAllocated: toRupees(totalAllocatedPaise),
    totalAllocatedPaise: Number(totalAllocatedPaise),
    excessCredit: toRupees(excessCreditPaise),
    unifiedAdvancePaise: Number(excessCreditPaise),
    isAdvance,

    primaryAllocated: toRupees(primaryAllocatedPaise),
    primaryAllocatedPaise: Number(primaryAllocatedPaise),
    bakeryAllocated: toRupees(bakeryAllocatedPaise),
    bakeryAllocatedPaise: Number(bakeryAllocatedPaise),

    attributions,
    dateSummaries,

    appliedToBill,
    appliedToPrimaryBill,
    appliedToBakeryBill,
    appliedToOtherBill: appliedToBakeryBill,
    totalAppliedToBill: appliedToBill,

    appliedToPrevious,
    appliedToSameDivisionPrevious: toRupees(
      previousDateSummaries.reduce((sum, d) => sum + BigInt(d.primaryAllocatedPaise), 0n),
    ),
    appliedToOtherDivisionPrevious: toRupees(
      previousDateSummaries.reduce((sum, d) => sum + BigInt(d.bakeryAllocatedPaise), 0n),
    ),

    remainingBill,
    remainingOtherBill,
    remainingTotalBill,
    remainingPrevious,
    remainingTotalOutstanding,
  };
}

/**
 * Separate Canonical Rule: Primary-First Advance Credit Application.
 *
 * When customer advance credit (generalCredit) is applied to new orders,
 * it is ALWAYS consumed in the canonical Primary-first order:
 * Primary subtotal is satisfied first, and only remaining credit covers Bakery subtotal.
 */
export function allocatePrimaryFirstCredit(
  availableCreditPaise: number,
  primaryDuePaise: number,
  bakeryDuePaise: number,
): { primaryPaise: number; bakeryPaise: number } {
  const available = Math.max(0, Math.round(availableCreditPaise));
  const primaryDue = Math.max(0, Math.round(primaryDuePaise));
  const bakeryDue = Math.max(0, Math.round(bakeryDuePaise));

  const primaryPaise = Math.min(available, primaryDue);
  const remainingCredit = available - primaryPaise;
  const bakeryPaise = Math.min(remainingCredit, bakeryDue);

  return { primaryPaise, bakeryPaise };
}

/**
 * Rupee-denominated helper for Primary-first credit application.
 */
export function allocatePrimaryFirstCreditRupees(
  availableCredit: number,
  primaryDue: number,
  bakeryDue: number,
): { primaryCredit: number; bakeryCredit: number; totalCreditApplied: number } {
  const result = allocatePrimaryFirstCredit(
    toPaise(availableCredit),
    toPaise(primaryDue),
    toPaise(bakeryDue),
  );
  const primaryCredit = toRupees(result.primaryPaise);
  const bakeryCredit = toRupees(result.bakeryPaise);
  return {
    primaryCredit,
    bakeryCredit,
    totalCreditApplied: toRupees(result.primaryPaise + result.bakeryPaise),
  };
}
