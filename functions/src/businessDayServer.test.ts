import { describe, it, expect } from 'vitest';
import {
  getServerBusinessDayKey,
  isServerBusinessDayCurrent,
  BUSINESS_DAY_TIMEZONE,
  BUSINESS_DAY_SHIFT_MS,
} from './businessDayServer';

describe('Server Business Day Calculation Engine (Asia/Kolkata, 2:00 AM IST Cutoff)', () => {
  it('has correct timezone and shift constants', () => {
    expect(BUSINESS_DAY_TIMEZONE).toBe('Asia/Kolkata');
    expect(BUSINESS_DAY_SHIFT_MS).toBe(7200000); // 2 hours = 7,200,000 ms
  });

  describe('Cutoff Boundaries (1:59:59.999 AM vs 2:00:00.000 AM vs 2:00:00.001 AM IST)', () => {
    // Oct 25, 2026 in IST (+05:30):
    // 01:59:59.999 AM IST = 2026-10-24T20:29:59.999Z
    // 02:00:00.000 AM IST = 2026-10-24T20:30:00.000Z
    // 02:00:00.001 AM IST = 2026-10-24T20:30:00.001Z

    it('assigns 2026-10-24 to 01:59:59.999 AM IST (1 ms before 2:00 AM cutoff)', () => {
      const ms = new Date('2026-10-24T20:29:59.999Z').getTime();
      expect(getServerBusinessDayKey(ms)).toBe('2026-10-24');
    });

    it('assigns 2026-10-25 to exact 02:00:00.000 AM IST cutoff (new business day opens)', () => {
      const ms = new Date('2026-10-24T20:30:00.000Z').getTime();
      expect(getServerBusinessDayKey(ms)).toBe('2026-10-25');
    });

    it('assigns 2026-10-25 to 02:00:00.001 AM IST (1 ms after 2:00 AM cutoff)', () => {
      const ms = new Date('2026-10-24T20:30:00.001Z').getTime();
      expect(getServerBusinessDayKey(ms)).toBe('2026-10-25');
    });
  });

  describe('Midnight Does Not Close Business Day', () => {
    it('assigns 2026-10-24 to midnight 00:00:00.000 AM IST (night shift still open)', () => {
      // Oct 25, 2026, 00:00:00 AM IST = 2026-10-24T18:30:00.000Z
      const ms = new Date('2026-10-24T18:30:00.000Z').getTime();
      expect(getServerBusinessDayKey(ms)).toBe('2026-10-24');
    });

    it('assigns 2026-10-24 to 01:00:00.000 AM IST', () => {
      // Oct 25, 2026, 01:00:00 AM IST = 2026-10-24T19:30:00.000Z
      const ms = new Date('2026-10-24T19:30:00.000Z').getTime();
      expect(getServerBusinessDayKey(ms)).toBe('2026-10-24');
    });

    it('assigns 2026-10-24 to normal evening 11:30 PM IST', () => {
      // Oct 24, 2026, 11:30:00 PM IST = 2026-10-24T18:00:00.000Z
      const ms = new Date('2026-10-24T18:00:00.000Z').getTime();
      expect(getServerBusinessDayKey(ms)).toBe('2026-10-24');
    });
  });

  describe('Month-End Transitions (Non-Leap Year)', () => {
    it('preserves Feb 28 business day on Mar 01 at 01:59:59 AM IST', () => {
      // Mar 01, 2026, 01:59:59 AM IST = 2026-02-28T20:29:59.000Z
      const ms = new Date('2026-02-28T20:29:59.000Z').getTime();
      expect(getServerBusinessDayKey(ms)).toBe('2026-02-28');
    });

    it('transitions to Mar 01 business day on Mar 01 at 02:00:00 AM IST', () => {
      // Mar 01, 2026, 02:00:00 AM IST = 2026-02-28T20:30:00.000Z
      const ms = new Date('2026-02-28T20:30:00.000Z').getTime();
      expect(getServerBusinessDayKey(ms)).toBe('2026-03-01');
    });
  });

  describe('Leap Year Transitions (2028)', () => {
    it('preserves Feb 29 leap day on Mar 01, 2028 at 01:59:59 AM IST', () => {
      // Mar 01, 2028, 01:59:59 AM IST = 2028-02-29T20:29:59.000Z
      const ms = new Date('2028-02-29T20:29:59.000Z').getTime();
      expect(getServerBusinessDayKey(ms)).toBe('2028-02-29');
    });

    it('transitions to Mar 01, 2028 business day on Mar 01, 2028 at 02:00:00 AM IST', () => {
      // Mar 01, 2028, 02:00:00 AM IST = 2028-02-29T20:30:00.000Z
      const ms = new Date('2028-02-29T20:30:00.000Z').getTime();
      expect(getServerBusinessDayKey(ms)).toBe('2028-03-01');
    });
  });

  describe('Year-End Transitions (Dec 31 -> Jan 01)', () => {
    it('preserves Dec 31 business day on Jan 01, 2027 at 01:59:59 AM IST', () => {
      // Jan 01, 2027, 01:59:59 AM IST = 2026-12-31T20:29:59.000Z
      const ms = new Date('2026-12-31T20:29:59.000Z').getTime();
      expect(getServerBusinessDayKey(ms)).toBe('2026-12-31');
    });

    it('transitions to Jan 01, 2027 business day on Jan 01, 2027 at 02:00:00 AM IST', () => {
      // Jan 01, 2027, 02:00:00 AM IST = 2026-12-31T20:30:00.000Z
      const ms = new Date('2026-12-31T20:30:00.000Z').getTime();
      expect(getServerBusinessDayKey(ms)).toBe('2027-01-01');
    });
  });

  describe('Client Clock Manipulation Resistance', () => {
    it('derives business day from server time, regardless of what client claims', () => {
      // Suppose server instant is 2026-10-25 10:00:00 AM IST (2026-10-25T04:30:00.000Z)
      const serverNow = new Date('2026-10-25T04:30:00.000Z').getTime();
      const serverKey = getServerBusinessDayKey(serverNow);
      expect(serverKey).toBe('2026-10-25');

      // Even if a client device advances its clock to 2026-10-30,
      // the server function is passed serverNow and produces 2026-10-25.
      expect(isServerBusinessDayCurrent('2026-10-25', serverNow)).toBe(true);
      expect(isServerBusinessDayCurrent('2026-10-30', serverNow)).toBe(false);
      expect(isServerBusinessDayCurrent('2026-10-24', serverNow)).toBe(false);
    });

    it('handles invalid or empty businessDay keys gracefully', () => {
      expect(isServerBusinessDayCurrent('', Date.now())).toBe(false);
      expect(isServerBusinessDayCurrent(null as any, Date.now())).toBe(false);
      expect(isServerBusinessDayCurrent(undefined as any, Date.now())).toBe(false);
      expect(isServerBusinessDayCurrent(12345 as any, Date.now())).toBe(false);
    });
  });
});
