import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  bucketForRange,
  dateInZone,
  diffDays,
  eachBucket,
  endOfMonth,
  endOfQuarter,
  formatDateOnly,
  isDateOnly,
  precedingRange,
  resolvePeriod,
  resolveReportRange,
  startOfQuarter,
  startOfWeek,
  todayInZone,
  zonedDayStart,
} from './dates';

const IST = 'Asia/Kolkata';

describe('isDateOnly', () => {
  it('accepts real dates only', () => {
    expect(isDateOnly('2026-10-10')).toBe(true);
    expect(isDateOnly('2028-02-29')).toBe(true); // leap year
    expect(isDateOnly('2026-02-29')).toBe(false); // not a leap year
    expect(isDateOnly('2026-13-01')).toBe(false);
    expect(isDateOnly('2026-1-1')).toBe(false);
    expect(isDateOnly(20261010)).toBe(false);
  });
});

describe('arithmetic', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('clamps month addition to the month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
  });

  it('counts days between dates', () => {
    expect(diffDays('2026-10-01', '2026-10-31')).toBe(30);
    expect(diffDays('2026-10-31', '2026-10-01')).toBe(-30);
  });
});

describe('boundaries', () => {
  it('finds the week start for Monday and Sunday weeks', () => {
    // 2026-10-10 is a Saturday.
    expect(startOfWeek('2026-10-10', 1)).toBe('2026-10-05');
    expect(startOfWeek('2026-10-10', 0)).toBe('2026-10-04');
    expect(startOfWeek('2026-10-05', 1)).toBe('2026-10-05');
  });

  it('finds month and quarter ends', () => {
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(startOfQuarter('2026-11-20')).toBe('2026-10-01');
    expect(endOfQuarter('2026-11-20')).toBe('2026-12-31');
  });
});

describe('time zones', () => {
  it("uses the institute's calendar day, not UTC's", () => {
    // 18:45 UTC on 10 Oct is 00:15 on 11 Oct in India.
    const instant = new Date('2026-10-10T18:45:00Z');
    expect(dateInZone(instant, 'UTC')).toBe('2026-10-10');
    expect(dateInZone(instant, IST)).toBe('2026-10-11');
    expect(todayInZone(IST, instant)).toBe('2026-10-11');
  });
});

describe('zonedDayStart', () => {
  it('finds the instant a calendar day begins in a zone', () => {
    expect(zonedDayStart('2026-10-10', IST).toISOString()).toBe('2026-10-09T18:30:00.000Z');
    expect(zonedDayStart('2026-10-10', 'UTC').toISOString()).toBe('2026-10-10T00:00:00.000Z');
  });

  it('handles daylight-saving zones on both sides of a change', () => {
    // New York: EST (UTC-5) on 1 March, EDT (UTC-4) from 8 March 2026.
    expect(zonedDayStart('2026-03-01', 'America/New_York').toISOString()).toBe('2026-03-01T05:00:00.000Z');
    expect(zonedDayStart('2026-03-09', 'America/New_York').toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });
});

describe('resolvePeriod', () => {
  // A Saturday, 15:00 IST.
  const now = new Date('2026-10-10T09:30:00Z');
  const opts = { timeZone: IST, now, weekStartsOn: 1 };

  it('resolves today and yesterday', () => {
    expect(resolvePeriod('today', opts).range).toEqual({ from: '2026-10-10', to: '2026-10-10' });
    expect(resolvePeriod('today', opts).previous).toEqual({ from: '2026-10-09', to: '2026-10-09' });
    expect(resolvePeriod('yesterday', opts).range).toEqual({ from: '2026-10-09', to: '2026-10-09' });
  });

  it('resolves this week to date, compared with the same days last week', () => {
    const p = resolvePeriod('this_week', opts);
    expect(p.range).toEqual({ from: '2026-10-05', to: '2026-10-10' });
    expect(p.previous).toEqual({ from: '2026-09-28', to: '2026-10-03' });
  });

  it('compares month-to-date with the same span of the previous month', () => {
    const p = resolvePeriod('this_month', opts);
    expect(p.range).toEqual({ from: '2026-10-01', to: '2026-10-10' });
    expect(p.previous).toEqual({ from: '2026-09-01', to: '2026-09-10' });
  });

  it('clamps the comparison at month end', () => {
    const p = resolvePeriod('this_month', { ...opts, now: new Date('2026-03-31T06:00:00Z') });
    expect(p.range).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(p.previous).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('resolves the full previous month', () => {
    const p = resolvePeriod('previous_month', { ...opts, now: new Date('2026-01-15T06:00:00Z') });
    expect(p.range).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(p.previous).toEqual({ from: '2025-11-01', to: '2025-11-30' });
  });

  it('resolves quarter and year to date', () => {
    expect(resolvePeriod('this_quarter', opts).range).toEqual({ from: '2026-10-01', to: '2026-10-10' });
    expect(resolvePeriod('this_quarter', opts).previous).toEqual({ from: '2026-07-01', to: '2026-07-10' });
    expect(resolvePeriod('this_year', opts).range).toEqual({ from: '2026-01-01', to: '2026-10-10' });
    expect(resolvePeriod('this_year', opts).previous).toEqual({ from: '2025-01-01', to: '2025-10-10' });
  });

  it('validates custom ranges and compares with the preceding equal span', () => {
    const p = resolvePeriod('custom', { ...opts, from: '2026-10-01', to: '2026-10-07' });
    expect(p.previous).toEqual({ from: '2026-09-24', to: '2026-09-30' });
    expect(() => resolvePeriod('custom', { ...opts, from: '2026-10-07', to: '2026-10-01' })).toThrow();
    expect(() => resolvePeriod('custom', { ...opts, from: '2026-10-01' })).toThrow();
  });

  it('decides "today" in the institute zone even near midnight UTC', () => {
    const p = resolvePeriod('today', { ...opts, now: new Date('2026-10-10T19:00:00Z') });
    expect(p.range.from).toBe('2026-10-11');
  });
});

describe('resolveReportRange', () => {
  it('resolves full calendar periods around a reference date', () => {
    expect(resolveReportRange('weekly', '2026-10-10').range).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(resolveReportRange('monthly', '2026-02-14').range).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(resolveReportRange('monthly', '2026-03-14').previous).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(resolveReportRange('yearly', '2026-06-01').previous).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });
});

describe('chart buckets', () => {
  it('chooses a readable granularity', () => {
    expect(bucketForRange({ from: '2026-10-01', to: '2026-10-31' })).toBe('day');
    expect(bucketForRange({ from: '2026-08-01', to: '2026-10-31' })).toBe('week');
    expect(bucketForRange({ from: '2026-01-01', to: '2026-12-31' })).toBe('month');
  });

  it('lists every bucket so empty periods still plot as zero', () => {
    expect(eachBucket({ from: '2026-10-30', to: '2026-11-02' }, 'day')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(eachBucket({ from: '2026-11-15', to: '2027-01-10' }, 'month')).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(eachBucket({ from: '2026-10-07', to: '2026-10-20' }, 'week', 1)).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
    ]);
  });
});

describe('precedingRange and display', () => {
  it('builds the preceding equal span', () => {
    expect(precedingRange({ from: '2026-10-10', to: '2026-10-10' })).toEqual({ from: '2026-10-09', to: '2026-10-09' });
  });

  it('formats without shifting the day', () => {
    expect(formatDateOnly('2026-10-10')).toBe('10 Oct 2026');
    expect(formatDateOnly(null)).toBe('—');
  });
});
