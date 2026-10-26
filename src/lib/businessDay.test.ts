import { describe, it, expect } from 'vitest';
import {
  getBusinessDayKey,
  isCurrentBusinessDay,
  isSameBusinessDay,
  formatBusinessDayDisplay,
  getBusinessDayDateRange,
  getBusinessDayStatusLabel,
} from './businessDay';

describe('Business Day Calculation — Strict 2:00 AM IST Cutoff Rule', () => {
  // Helper to construct exact ISO timestamps given an IST time
  // IST is UTC + 5:30 (e.g. 11:30 PM IST = 18:00 UTC)
  const ist = (dateStr: string) => new Date(`${dateStr}+05:30`);

  describe('1. Authoritative 2:00 AM IST Boundary Transitions', () => {
    it('11:30 PM IST belongs to the current calendar date', () => {
      const d = ist('2026-10-24T23:30:00');
      expect(getBusinessDayKey(d)).toBe('2026-10-24');
    });

    it('1:45 AM IST belongs to the PREVIOUS calendar day', () => {
      const d = ist('2026-10-25T01:45:00');
      expect(getBusinessDayKey(d)).toBe('2026-10-24');
    });

    it('1:59:59 AM IST belongs to the PREVIOUS calendar day (final second before rollover)', () => {
      const d = ist('2026-10-25T01:59:59');
      expect(getBusinessDayKey(d)).toBe('2026-10-24');
    });

    it('exactly 2:00:00 AM IST opens the NEW business day', () => {
      const d = ist('2026-10-25T02:00:00');
      expect(getBusinessDayKey(d)).toBe('2026-10-25');
    });

    it('2:01:00 AM IST belongs to the NEW business day', () => {
      const d = ist('2026-10-25T02:01:00');
      expect(getBusinessDayKey(d)).toBe('2026-10-25');
    });

    it('noon (12:00 PM IST) belongs to the current business day', () => {
      const d = ist('2026-10-25T12:00:00');
      expect(getBusinessDayKey(d)).toBe('2026-10-25');
    });
  });

  describe('2. Month-End and Year-End Rollovers', () => {
    it('Oct 31 at 11:59 PM IST belongs to Oct 31', () => {
      const d = ist('2026-10-31T23:59:00');
      expect(getBusinessDayKey(d)).toBe('2026-10-31');
    });

    it('Nov 01 at 01:45 AM IST belongs to Oct 31 (month-end boundary)', () => {
      const d = ist('2026-11-01T01:45:00');
      expect(getBusinessDayKey(d)).toBe('2026-10-31');
    });

    it('Nov 01 at 02:00 AM IST rolls over into Nov 01', () => {
      const d = ist('2026-11-01T02:00:00');
      expect(getBusinessDayKey(d)).toBe('2026-11-01');
    });

    it('Dec 31 at 11:59 PM IST belongs to Dec 31', () => {
      const d = ist('2026-12-31T23:59:00');
      expect(getBusinessDayKey(d)).toBe('2026-12-31');
    });

    it('Jan 01 at 01:50 AM IST belongs to Dec 31 of PREVIOUS year', () => {
      const d = ist('2027-01-01T01:50:00');
      expect(getBusinessDayKey(d)).toBe('2026-12-31');
    });

    it('Jan 01 at 02:00 AM IST rolls over into the NEW year', () => {
      const d = ist('2027-01-01T02:00:00');
      expect(getBusinessDayKey(d)).toBe('2027-01-01');
    });
  });

  describe('3. Edit Lockout & Active Day Checks', () => {
    it('permits editing when expense businessDay matches currently open business day', () => {
      const now = ist('2026-10-25T01:30:00'); // Currently in Oct 24 business day
      expect(isCurrentBusinessDay('2026-10-24', now)).toBe(true);
      expect(isCurrentBusinessDay('2026-10-25', now)).toBe(false);
    });

    it('locks out editing immediately once 2:00 AM IST arrives', () => {
      const postCutoff = ist('2026-10-25T02:00:01'); // Oct 25 business day open
      expect(isCurrentBusinessDay('2026-10-24', postCutoff)).toBe(false); // Oct 24 is now LOCKED
      expect(isCurrentBusinessDay('2026-10-25', postCutoff)).toBe(true);  // Oct 25 is now EDITABLE
    });

    it('verifies two timestamps belong to same business day across midnight', () => {
      const evening = ist('2026-10-24T22:00:00');
      const pastMidnight = ist('2026-10-25T01:30:00');
      expect(isSameBusinessDay(evening, pastMidnight)).toBe(true);
    });

    it('verifies two timestamps separated by 2:00 AM cutoff belong to different business days', () => {
      const beforeCutoff = ist('2026-10-25T01:59:00');
      const afterCutoff = ist('2026-10-25T02:01:00');
      expect(isSameBusinessDay(beforeCutoff, afterCutoff)).toBe(false);
    });
  });

  describe('4. Formatting & Preset Date Ranges', () => {
    it('formats display date in Indian locale cleanly', () => {
      expect(formatBusinessDayDisplay('2026-10-24')).toMatch(/24.*Oct.*2026/);
    });

    it('computes today and yesterday presets', () => {
      const ref = ist('2026-10-25T11:00:00');
      const todayRange = getBusinessDayDateRange('today', undefined, undefined, ref);
      expect(todayRange.fromBusinessDay).toBe('2026-10-25');
      expect(todayRange.toBusinessDay).toBe('2026-10-25');

      const yestRange = getBusinessDayDateRange('yesterday', undefined, undefined, ref);
      expect(yestRange.fromBusinessDay).toBe('2026-10-24');
      expect(yestRange.toBusinessDay).toBe('2026-10-24');
    });

    it('computes this_month starting on 1st of active business day month', () => {
      const ref = ist('2026-10-25T11:00:00');
      const monthRange = getBusinessDayDateRange('this_month', undefined, undefined, ref);
      expect(monthRange.fromBusinessDay).toBe('2026-10-01');
      expect(monthRange.toBusinessDay).toBe('2026-10-25');
    });

    it('generates accurate status label for cutoff countdown', () => {
      const ref = ist('2026-10-24T15:00:00');
      const status = getBusinessDayStatusLabel(ref);
      expect(status.businessDay).toBe('2026-10-24');
      expect(status.closesAtLabel).toContain('2:00 AM IST');
    });
  });
});
