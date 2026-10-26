/**
 * Daily Fresh ERP — Server Business Day Calculation Engine
 *
 * Implements the mandatory 2:00 AM IST Business-Day specification using trusted server time:
 * - A business day begins at 02:00:00.000 AM IST on calendar date D.
 * - A business day ends at 01:59:59.999 AM IST on calendar date D+1.
 *
 * Mathematically derived by subtracting exactly 2 hours (7,200,000 ms) from trusted server instant T,
 * and extracting date parts strictly in the 'Asia/Kolkata' timezone.
 */

export const BUSINESS_DAY_TIMEZONE = 'Asia/Kolkata';
export const BUSINESS_DAY_SHIFT_HOURS = 2;
export const BUSINESS_DAY_SHIFT_MS = BUSINESS_DAY_SHIFT_HOURS * 60 * 60 * 1000; // 7,200,000 ms

/**
 * Computes the authoritative business-day key ('YYYY-MM-DD') from a trusted server timestamp.
 * Invariant across Node.js 20/22 runtime locales by extracting numeric parts with Intl.DateTimeFormat.
 */
export function getServerBusinessDayKey(serverTimestampMs: number = Date.now()): string {
  const shiftedMs = serverTimestampMs - BUSINESS_DAY_SHIFT_MS;
  const shiftedDate = new Date(shiftedMs);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_DAY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(shiftedDate);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;

  if (!year || !month || !day || year.length !== 4 || month.length !== 2 || day.length !== 2) {
    throw new Error(`Critical business-day date formatting failure: ${year}-${month}-${day}`);
  }

  return `${year}-${month}-${day}`;
}

/**
 * Validates whether an existing expense's businessDay matches the currently open server business day.
 */
export function isServerBusinessDayCurrent(businessDayKey: string, serverTimestampMs: number = Date.now()): boolean {
  if (!businessDayKey || typeof businessDayKey !== 'string') return false;
  return businessDayKey === getServerBusinessDayKey(serverTimestampMs);
}
