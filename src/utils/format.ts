/**
 * Display formatting. Money comes from @ims/shared's formatMoney so screens,
 * PDFs and Excel exports render identical figures. Currency, locale and time
 * zone come from the institute settings, set once the session loads.
 */

import { formatDateOnly, formatMoney, formatMonthKey, toMajorNumber } from '@ims/shared';

interface FormatConfig {
  currency: string;
  locale: string;
  timeZone: string;
}

const config: FormatConfig = { currency: 'INR', locale: 'en-IN', timeZone: 'Asia/Kolkata' };

export function setFormatConfig(next: Partial<FormatConfig>): void {
  Object.assign(config, next);
}

export function getFormatConfig(): Readonly<FormatConfig> {
  return config;
}

/* ------------------------------------------------------------------ *
 * Money
 * ------------------------------------------------------------------ */

/** 12500050 -> "₹1,25,000.50". */
export function money(minor: number | null | undefined, options: { compactDecimals?: boolean } = {}): string {
  if (minor === null || minor === undefined) return '—';
  return formatMoney(minor, { currency: config.currency, locale: config.locale, ...options });
}

/** 125000000 -> "₹12.5L" in en-IN. For KPI tiles and chart axes. */
export function moneyCompact(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '—';
  return new Intl.NumberFormat(config.locale, {
    style: 'currency',
    currency: config.currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(toMajorNumber(minor));
}

/* ------------------------------------------------------------------ *
 * Numbers
 * ------------------------------------------------------------------ */

export function number(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(config.locale).format(value);
}

/** 0.4567 -> "45.7%". Returns "—" for a ratio that has no denominator. */
export function percent(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  return new Intl.NumberFormat(config.locale, {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(ratio);
}

/* ------------------------------------------------------------------ *
 * Dates and times
 * ------------------------------------------------------------------ */

/** '2026-10-10' -> '10 Oct 2026'. Never shifts the day. */
export function date(value: string | null | undefined): string {
  return formatDateOnly(value ?? null, config.locale);
}

export function month(key: string): string {
  return formatMonthKey(key, config.locale);
}

/** An instant shown as wall-clock time in the INSTITUTE's zone. */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return formatInZone(iso, config.timeZone, config.locale);
}

export function formatInZone(iso: string, timeZone: string, locale = 'en-IN'): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(value);
  } catch {
    return value.toISOString();
  }
}

/** Server status page: seconds included. */
export function formatInZoneLong(iso: string, timeZone: string, locale = 'en-IN'): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'medium' }).format(value);
  } catch {
    return value.toISOString();
  }
}

/** "just now", "5m ago", "3h ago", "2d ago", then a date. */
export function relative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const diff = Math.max(0, now - new Date(iso).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return dateTime(iso);
}

/* ------------------------------------------------------------------ *
 * Durations (system status)
 * ------------------------------------------------------------------ */

/** 93784 -> "1d 2h", 3725 -> "1h 2m", 125 -> "2m 5s", 9 -> "9s". Two units max. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  const seconds = s % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Milliseconds elapsed -> "just now" / "12s ago" / "3m ago" / "2h ago". */
export function formatElapsed(elapsedMs: number): string {
  const seconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

/** Sub-millisecond latencies keep two decimals; larger ones round. */
export function formatLatency(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 10 ? `${ms.toFixed(2)} ms` : `${Math.round(ms)} ms`;
}

/** Human label for a snake_case enum value: "pending_payment" -> "Pending payment". */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Priya Sharma" -> "PS". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}
