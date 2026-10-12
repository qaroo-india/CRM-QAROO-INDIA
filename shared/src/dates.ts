/**
 * Calendar-day arithmetic and reporting periods.
 *
 * Business dates (admission, receipt, due, expense dates) are plain
 * 'YYYY-MM-DD' strings in the institute's time zone. All arithmetic here works
 * on those strings through UTC midnight, so daylight-saving shifts and the
 * server's own zone can never move a date across a boundary.
 *
 * The only place a real clock enters is `todayInZone`, which asks "what
 * calendar day is it in the institute right now?". Client and server share
 * this file, so a dashboard and its PDF export always agree on what
 * "this month" means.
 */

import type { ReportPeriod } from './constants/domain';

export type DateOnly = string;

export interface DateRange {
  from: DateOnly;
  to: DateOnly;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export class DateError extends Error {
  override readonly name = 'DateError';
}

export function isDateOnly(value: unknown): value is DateOnly {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return toDateOnlyFromUtc(date) === value;
}

function assertDateOnly(value: string, label = 'date'): void {
  if (!isDateOnly(value)) throw new DateError(`${label} must be a real date in YYYY-MM-DD format, got "${value}"`);
}

function toUtc(value: DateOnly): Date {
  assertDateOnly(value);
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function toDateOnlyFromUtc(date: Date): DateOnly {
  return date.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * Clock -> calendar day
 * ------------------------------------------------------------------ */

/** The calendar day an instant falls on in a given IANA zone. */
export function dateInZone(instant: Date | number, timeZone: string): DateOnly {
  const date = typeof instant === 'number' ? new Date(instant) : instant;
  // en-CA formats as YYYY-MM-DD; formatToParts avoids relying on that order.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Today's date in the institute's zone -- never the server's or the browser's. */
export function todayInZone(timeZone: string, now: Date = new Date()): DateOnly {
  return dateInZone(now, timeZone);
}

/** UTC offset of a zone at an instant, in minutes (IST = +330). */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(instant)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{1,2}):?(\d{2})?/.exec(name);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

/**
 * The instant a calendar day begins in a zone: '2026-10-10' in Asia/Kolkata
 * is 2026-10-09T18:30:00Z. Used to filter instant columns (audit times,
 * interview slots) by the institute's calendar days.
 */
export function zonedDayStart(day: DateOnly, timeZone: string): Date {
  const midnightUtc = toUtc(day).getTime();
  const first = midnightUtc - zoneOffsetMinutes(new Date(midnightUtc), timeZone) * 60_000;
  // Re-check at the candidate instant in case a DST change falls in between.
  const second = midnightUtc - zoneOffsetMinutes(new Date(first), timeZone) * 60_000;
  return new Date(second);
}

/** [start of `from`, start of the day after `to`) as instants. */
export function zonedDayBounds(range: DateRange, timeZone: string): { start: Date; end: Date } {
  return { start: zonedDayStart(range.from, timeZone), end: zonedDayStart(addDays(range.to, 1), timeZone) };
}

/* ------------------------------------------------------------------ *
 * Arithmetic
 * ------------------------------------------------------------------ */

export function addDays(value: DateOnly, days: number): DateOnly {
  const date = toUtc(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateOnlyFromUtc(date);
}

/** Adds calendar months, clamping to month end: 31 Jan + 1 month = 28/29 Feb. */
export function addMonths(value: DateOnly, months: number): DateOnly {
  const date = toUtc(value);
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toDateOnlyFromUtc(target);
}

export function addYears(value: DateOnly, years: number): DateOnly {
  return addMonths(value, years * 12);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function diffDays(from: DateOnly, to: DateOnly): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / MS_PER_DAY);
}

/** ISO strings compare correctly as text. */
export function compareDates(a: DateOnly, b: DateOnly): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: DateOnly, b: DateOnly): DateOnly {
  return a <= b ? a : b;
}

export function maxDate(a: DateOnly, b: DateOnly): DateOnly {
  return a >= b ? a : b;
}

export function isWithin(value: DateOnly, range: DateRange): boolean {
  return value >= range.from && value <= range.to;
}

/** 0 = Sunday ... 6 = Saturday. */
export function dayOfWeek(value: DateOnly): number {
  return toUtc(value).getUTCDay();
}

/* ------------------------------------------------------------------ *
 * Boundaries
 * ------------------------------------------------------------------ */

export function startOfWeek(value: DateOnly, weekStartsOn = 1): DateOnly {
  const offset = (dayOfWeek(value) - weekStartsOn + 7) % 7;
  return addDays(value, -offset);
}

export function endOfWeek(value: DateOnly, weekStartsOn = 1): DateOnly {
  return addDays(startOfWeek(value, weekStartsOn), 6);
}

export function startOfMonth(value: DateOnly): DateOnly {
  return `${value.slice(0, 7)}-01`;
}

export function endOfMonth(value: DateOnly): DateOnly {
  return addDays(addMonths(startOfMonth(value), 1), -1);
}

export function startOfQuarter(value: DateOnly): DateOnly {
  const month = Number(value.slice(5, 7));
  const quarterStart = Math.floor((month - 1) / 3) * 3 + 1;
  return `${value.slice(0, 4)}-${String(quarterStart).padStart(2, '0')}-01`;
}

export function endOfQuarter(value: DateOnly): DateOnly {
  return addDays(addMonths(startOfQuarter(value), 3), -1);
}

export function startOfYear(value: DateOnly): DateOnly {
  return `${value.slice(0, 4)}-01-01`;
}

export function endOfYear(value: DateOnly): DateOnly {
  return `${value.slice(0, 4)}-12-31`;
}

/** 'YYYY-MM' for a date. */
export function monthKey(value: DateOnly): string {
  return value.slice(0, 7);
}

/* ------------------------------------------------------------------ *
 * Iteration and chart buckets
 * ------------------------------------------------------------------ */

export function eachDayOfRange(range: DateRange): DateOnly[] {
  const days: DateOnly[] = [];
  const total = diffDays(range.from, range.to);
  if (total < 0) return days;
  if (total > 3700) throw new DateError('date range is too long to enumerate by day');
  for (let i = 0; i <= total; i += 1) days.push(addDays(range.from, i));
  return days;
}

export type Bucket = 'day' | 'week' | 'month';

/** Pick a chart granularity that keeps the number of points readable. */
export function bucketForRange(range: DateRange): Bucket {
  const days = diffDays(range.from, range.to) + 1;
  if (days <= 31) return 'day';
  if (days <= 120) return 'week';
  return 'month';
}

/** Key a date falls under: the day itself, its week's start, or 'YYYY-MM'. */
export function bucketKey(value: DateOnly, bucket: Bucket, weekStartsOn = 1): string {
  if (bucket === 'day') return value;
  if (bucket === 'week') return startOfWeek(value, weekStartsOn);
  return monthKey(value);
}

/** Every bucket key in a range, in order, so charts show zero-value gaps. */
export function eachBucket(range: DateRange, bucket: Bucket, weekStartsOn = 1): string[] {
  if (bucket === 'day') return eachDayOfRange(range);
  const keys: string[] = [];
  if (bucket === 'week') {
    for (let d = startOfWeek(range.from, weekStartsOn); d <= range.to; d = addDays(d, 7)) keys.push(d);
    return keys;
  }
  for (let d = startOfMonth(range.from); d <= range.to; d = addMonths(d, 1)) keys.push(monthKey(d));
  return keys;
}

/* ------------------------------------------------------------------ *
 * Reporting periods
 * ------------------------------------------------------------------ */

export interface PeriodOptions {
  timeZone: string;
  weekStartsOn?: number;
  now?: Date;
  /** Required for 'custom'. */
  from?: DateOnly;
  to?: DateOnly;
}

export interface ResolvedPeriod {
  range: DateRange;
  /** The span this one is compared against ("vs previous period"). */
  previous: DateRange;
  label: string;
}

const PERIOD_LABELS: Record<ReportPeriod, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This week',
  this_month: 'This month',
  previous_month: 'Previous month',
  this_quarter: 'This quarter',
  this_year: 'This year',
  custom: 'Custom range',
};

/** The immediately preceding range of the same length. */
export function precedingRange(range: DateRange): DateRange {
  const length = diffDays(range.from, range.to) + 1;
  const to = addDays(range.from, -1);
  return { from: addDays(to, -(length - 1)), to };
}

/**
 * The same span one month/quarter/year earlier, clamped to that period's end.
 * "1-10 October" compares with "1-10 September", not "21-30 September".
 */
function sameSpanEarlier(range: DateRange, months: number): DateRange {
  // range.from is always a period start (1st of a month, quarter or year), so
  // the earlier period ends the day before it.
  const from = addMonths(range.from, -months);
  const periodEnd = addDays(range.from, -1);
  const to = minDate(addMonths(range.to, -months), periodEnd);
  return { from, to };
}

/** Resolve a named period to an inclusive date range plus its comparison range. */
export function resolvePeriod(period: ReportPeriod, options: PeriodOptions): ResolvedPeriod {
  const weekStartsOn = options.weekStartsOn ?? 1;
  const today = todayInZone(options.timeZone, options.now);
  const label = PERIOD_LABELS[period];

  switch (period) {
    case 'today': {
      const range = { from: today, to: today };
      return { range, previous: precedingRange(range), label };
    }
    case 'yesterday': {
      const day = addDays(today, -1);
      const range = { from: day, to: day };
      return { range, previous: precedingRange(range), label };
    }
    case 'this_week': {
      const range = { from: startOfWeek(today, weekStartsOn), to: today };
      return { range, previous: { from: addDays(range.from, -7), to: addDays(range.to, -7) }, label };
    }
    case 'this_month': {
      const range = { from: startOfMonth(today), to: today };
      return { range, previous: sameSpanEarlier(range, 1), label };
    }
    case 'previous_month': {
      const start = startOfMonth(addMonths(startOfMonth(today), -1));
      const range = { from: start, to: endOfMonth(start) };
      const prevStart = addMonths(start, -1);
      return { range, previous: { from: prevStart, to: endOfMonth(prevStart) }, label };
    }
    case 'this_quarter': {
      const range = { from: startOfQuarter(today), to: today };
      return { range, previous: sameSpanEarlier(range, 3), label };
    }
    case 'this_year': {
      const range = { from: startOfYear(today), to: today };
      return { range, previous: sameSpanEarlier(range, 12), label };
    }
    case 'custom': {
      const { from, to } = options;
      if (!from || !to) throw new DateError('a custom period needs both a start and an end date');
      assertDateOnly(from, 'start date');
      assertDateOnly(to, 'end date');
      if (from > to) throw new DateError('the start date must not be after the end date');
      const range = { from, to };
      return { range, previous: precedingRange(range), label };
    }
  }
}

export const REPORT_TYPES = ['daily', 'weekly', 'monthly', 'yearly', 'custom'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/**
 * Resolve a scheduled-style report (daily/weekly/monthly/yearly) around a
 * reference date to its full period and the period before it.
 */
export function resolveReportRange(
  type: ReportType,
  reference: DateOnly,
  options: { weekStartsOn?: number; from?: DateOnly; to?: DateOnly } = {},
): ResolvedPeriod {
  assertDateOnly(reference, 'reference date');
  const weekStartsOn = options.weekStartsOn ?? 1;

  switch (type) {
    case 'daily': {
      const range = { from: reference, to: reference };
      return { range, previous: precedingRange(range), label: 'Daily report' };
    }
    case 'weekly': {
      const from = startOfWeek(reference, weekStartsOn);
      const range = { from, to: addDays(from, 6) };
      return { range, previous: precedingRange(range), label: 'Weekly report' };
    }
    case 'monthly': {
      const from = startOfMonth(reference);
      const range = { from, to: endOfMonth(from) };
      const prev = addMonths(from, -1);
      return { range, previous: { from: prev, to: endOfMonth(prev) }, label: 'Monthly report' };
    }
    case 'yearly': {
      const from = startOfYear(reference);
      const range = { from, to: endOfYear(from) };
      const prev = addYears(from, -1);
      return { range, previous: { from: prev, to: endOfYear(prev) }, label: 'Yearly report' };
    }
    case 'custom': {
      const { from, to } = options;
      if (!from || !to) throw new DateError('a custom report needs both a start and an end date');
      assertDateOnly(from, 'start date');
      assertDateOnly(to, 'end date');
      if (from > to) throw new DateError('the start date must not be after the end date');
      const range = { from, to };
      return { range, previous: precedingRange(range), label: 'Custom report' };
    }
  }
}

/* ------------------------------------------------------------------ *
 * Display
 * ------------------------------------------------------------------ */

/** '2026-10-10' -> '10 Oct 2026' (en-IN). Formats in UTC so the day never shifts. */
export function formatDateOnly(value: DateOnly | null | undefined, locale = 'en-IN'): string {
  if (!value || !isDateOnly(value)) return '—';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    toUtc(value),
  );
}

/** '2026-10' -> 'Oct 2026'. */
export function formatMonthKey(key: string, locale = 'en-IN'): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    toUtc(`${key}-01`),
  );
}

export function formatRange(range: DateRange, locale = 'en-IN'): string {
  return range.from === range.to
    ? formatDateOnly(range.from, locale)
    : `${formatDateOnly(range.from, locale)} – ${formatDateOnly(range.to, locale)}`;
}
