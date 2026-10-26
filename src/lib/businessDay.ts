/**
 * Daily Fresh ERP — Business Day & Timezone Utility
 *
 * Implements the mandatory 2:00 AM IST Business-Day specification:
 * - A business day begins at 02:00:00 AM IST on calendar date D
 * - A business day ends at 01:59:59 AM IST on calendar date D+1
 *
 * All conversions strictly target the 'Asia/Kolkata' timezone regardless of
 * the client browser, device, or Node environment timezone.
 */

import { type ExpenseDatePreset } from '../types/expense.types';

export const BUSINESS_DAY_TIMEZONE = 'Asia/Kolkata';
export const BUSINESS_DAY_SHIFT_HOURS = 2;
export const BUSINESS_DAY_SHIFT_MS = BUSINESS_DAY_SHIFT_HOURS * 60 * 60 * 1000; // 7,200,000 ms

/**
 * Returns the authoritative business-day key ('YYYY-MM-DD') for any given instant.
 *
 * Mathematical derivation:
 * 1. Takes the timestamp T.
 * 2. Subtracts exactly 2 hours (7,200,000 ms).
 * 3. Formats the shifted instant in 'Asia/Kolkata' as 'YYYY-MM-DD'.
 */
export function getBusinessDayKey(date: Date = new Date()): string {
  const shiftedMs = date.getTime() - BUSINESS_DAY_SHIFT_MS;
  const shiftedDate = new Date(shiftedMs);

  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_DAY_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(shiftedDate);
  } catch {
    // Fallback if Intl is unavailable
    const iso = shiftedDate.toISOString();
    return iso.slice(0, 10);
  }
}

/**
 * Checks whether a given businessDay key matches the currently open business day.
 */
export function isCurrentBusinessDay(businessDayKey: string, now: Date = new Date()): boolean {
  if (!businessDayKey) return false;
  return businessDayKey === getBusinessDayKey(now);
}

/**
 * Checks whether two instants belong to the exact same business day.
 */
export function isSameBusinessDay(dateA: Date, dateB: Date): boolean {
  return getBusinessDayKey(dateA) === getBusinessDayKey(dateB);
}

/**
 * Returns human-readable label for a business day (e.g. '24 Oct 2026').
 */
export function formatBusinessDayDisplay(businessDayKey: string): string {
  if (!businessDayKey || !/^\d{4}-\d{2}-\d{2}$/.test(businessDayKey)) {
    return businessDayKey || '-';
  }
  const [year, month, day] = businessDayKey.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: BUSINESS_DAY_TIMEZONE,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(d);
  } catch {
    return businessDayKey;
  }
}

/**
 * Returns user-facing status label regarding the active business day.
 * Example: 'Business Day: 24 Oct 2026 (Open until 2:00 AM IST, 25 Oct)'
 */
export function getBusinessDayStatusLabel(referenceDate: Date = new Date()): {
  businessDay: string;
  formattedDate: string;
  closesAtLabel: string;
} {
  const currentKey = getBusinessDayKey(referenceDate);
  const formattedDate = formatBusinessDayDisplay(currentKey);

  // Compute next 2:00 AM cutoff
  // Current key is YYYY-MM-DD. Next calendar day at 2:00 AM IST is cutoff.
  const [year, month, day] = currentKey.split('-').map(Number);
  // UTC date of the calendar start of this business day
  const baseMidnight = new Date(Date.UTC(year, month - 1, day));
  // Add 1 day to find the calendar day of cutoff
  baseMidnight.setUTCDate(baseMidnight.getUTCDate() + 1);

  const nextDayFormatted = new Intl.DateTimeFormat('en-IN', {
    timeZone: BUSINESS_DAY_TIMEZONE,
    day: '2-digit',
    month: 'short',
  }).format(baseMidnight);

  return {
    businessDay: currentKey,
    formattedDate,
    closesAtLabel: `Open until 2:00 AM IST, ${nextDayFormatted}`,
  };
}

export interface BusinessDayDateRange {
  fromBusinessDay: string;
  toBusinessDay: string;
  label: string;
}

/**
 * Computes business-day boundaries for filtering and reports.
 */
export function getBusinessDayDateRange(
  preset: ExpenseDatePreset,
  customFrom?: string,
  customTo?: string,
  referenceDate: Date = new Date()
): BusinessDayDateRange {
  const currentKey = getBusinessDayKey(referenceDate);

  if (preset === 'today') {
    return {
      fromBusinessDay: currentKey,
      toBusinessDay: currentKey,
      label: `Today (${formatBusinessDayDisplay(currentKey)})`,
    };
  }

  if (preset === 'yesterday') {
    // Yesterday's business day is 24 hours prior to reference shifted
    const prevDate = new Date(referenceDate.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayKey = getBusinessDayKey(prevDate);
    return {
      fromBusinessDay: yesterdayKey,
      toBusinessDay: yesterdayKey,
      label: `Yesterday (${formatBusinessDayDisplay(yesterdayKey)})`,
    };
  }

  if (preset === 'this_week') {
    // Week starting Monday (IST)
    const shifted = new Date(referenceDate.getTime() - BUSINESS_DAY_SHIFT_MS);
    // Find current day of week (0 is Sunday, 1 is Monday)
    const dayOfWeek = shifted.getUTCDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    const mondayShifted = new Date(shifted.getTime() - diffToMonday * 24 * 60 * 60 * 1000);
    const mondayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_DAY_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(mondayShifted);

    return {
      fromBusinessDay: mondayKey,
      toBusinessDay: currentKey,
      label: `This Week (${formatBusinessDayDisplay(mondayKey)} – Today)`,
    };
  }

  if (preset === 'this_month') {
    const [year, month] = currentKey.split('-');
    const firstDayKey = `${year}-${month}-01`;
    return {
      fromBusinessDay: firstDayKey,
      toBusinessDay: currentKey,
      label: `This Month (${formatBusinessDayDisplay(firstDayKey)} – Today)`,
    };
  }

  if (preset === 'last7') {
    const shifted = new Date(referenceDate.getTime() - BUSINESS_DAY_SHIFT_MS);
    const start7Shifted = new Date(shifted.getTime() - 6 * 24 * 60 * 60 * 1000);
    const start7Key = new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_DAY_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(start7Shifted);
    return {
      fromBusinessDay: start7Key,
      toBusinessDay: currentKey,
      label: `Last 7 Days (${formatBusinessDayDisplay(start7Key)} – Today)`,
    };
  }

  if (preset === 'all') {
    return {
      fromBusinessDay: '2024-01-01',
      toBusinessDay: currentKey,
      label: 'All Time',
    };
  }

  // Custom
  const from = customFrom || currentKey;
  const to = customTo || currentKey;
  const normalizedFrom = from <= to ? from : to;
  const normalizedTo = from <= to ? to : from;

  return {
    fromBusinessDay: normalizedFrom,
    toBusinessDay: normalizedTo,
    label:
      normalizedFrom === normalizedTo
        ? formatBusinessDayDisplay(normalizedFrom)
        : `${formatBusinessDayDisplay(normalizedFrom)} – ${formatBusinessDayDisplay(normalizedTo)}`,
  };
}
