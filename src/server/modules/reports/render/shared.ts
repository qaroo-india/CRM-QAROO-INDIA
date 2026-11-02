/**
 * Wording and formatting shared by the PDF and Excel renderers, so both
 * files describe a figure the same way the screen does.
 */

import { formatDateOnly, formatMoney, type InstituteInfo, type ReportDataset } from '@ims/shared';

export type MetricKind = 'count' | 'money' | 'ratio';

export interface SummaryRow {
  label: string;
  kind: MetricKind;
  current: number | null;
  /** null when there is no comparison (balances are a point in time). */
  previous: number | null;
}

export function summaryRows(data: ReportDataset): SummaryRow[] {
  const s = data.summary;
  const rows: SummaryRow[] = [
    { label: 'Enquiries', kind: 'count', current: s.leads.current, previous: s.leads.previous },
    { label: 'Enquiries converted by period end', kind: 'count', current: s.convertedLeads.current, previous: s.convertedLeads.previous },
    { label: 'Lead conversion rate', kind: 'ratio', current: s.conversionRate.current, previous: s.conversionRate.previous },
    { label: 'Admissions (excl. cancelled)', kind: 'count', current: s.admissions.current, previous: s.admissions.previous },
    { label: 'Students placed (joined)', kind: 'count', current: s.placementsJoined.current, previous: s.placementsJoined.previous },
  ];
  const f = s.finance;
  if (f) {
    rows.push(
      { label: 'Fees agreed on new admissions', kind: 'money', current: f.agreedFeeMinor.current, previous: f.agreedFeeMinor.previous },
      { label: 'Collected (receipts)', kind: 'money', current: f.collectedMinor.current, previous: f.collectedMinor.previous },
      { label: 'Refunded', kind: 'money', current: f.refundedMinor.current, previous: f.refundedMinor.previous },
      { label: 'Net collections', kind: 'money', current: f.netCollectedMinor.current, previous: f.netCollectedMinor.previous },
      { label: 'Number of receipts', kind: 'count', current: f.receipts.current, previous: f.receipts.previous },
    );
    if (f.expensesMinor) rows.push({ label: 'Expenses', kind: 'money', current: f.expensesMinor.current, previous: f.expensesMinor.previous });
    if (f.netCashFlowMinor) rows.push({ label: 'Net cash flow', kind: 'money', current: f.netCashFlowMinor.current, previous: f.netCashFlowMinor.previous });
    rows.push(
      // Point-in-time balances: the as-of day is stated in the report header.
      { label: 'Outstanding fees (at period end)', kind: 'money', current: f.outstandingMinor, previous: null },
      { label: 'Overdue instalments (at period end)', kind: 'money', current: f.overdueMinor, previous: null },
    );
  }
  return rows;
}

/** "+12.5%", "−3 pts" or "—". Ratios compare in percentage points. */
export function changeText(row: SummaryRow, locale: string): string {
  if (row.current === null || row.previous === null) return '—';
  if (row.kind === 'ratio') {
    const pts = (row.current - row.previous) * 100;
    return `${pts > 0 ? '+' : pts < 0 ? '−' : ''}${Math.abs(pts).toLocaleString(locale, { maximumFractionDigits: 1 })} pts`;
  }
  if (row.previous === 0) return row.current === 0 ? '0%' : 'new';
  const change = (row.current - row.previous) / Math.abs(row.previous);
  return `${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change).toLocaleString(locale, { style: 'percent', maximumFractionDigits: 1 })}`;
}

export function formatters(institute: InstituteInfo) {
  const money = (minor: number | null | undefined) => (minor === null || minor === undefined ? '—' : formatMoney(minor, { currency: institute.currency, locale: institute.locale }));
  const day = (value: string | null | undefined) => formatDateOnly(value ?? null, institute.locale);
  const count = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString(institute.locale));
  const ratio = (r: number | null | undefined) => (r === null || r === undefined ? '—' : r.toLocaleString(institute.locale, { style: 'percent', maximumFractionDigits: 1 }));
  const value = (kind: MetricKind, v: number | null) => (kind === 'money' ? money(v) : kind === 'ratio' ? ratio(v) : count(v));
  const range = (r: { from: string; to: string }) => (r.from === r.to ? day(r.from) : `${day(r.from)} – ${day(r.to)}`);
  /** Chart labels: "₹6.6L", "₹1.2Cr" for INR; locale compact notation otherwise. */
  const compactMoney = (minor: number) => {
    const major = minor / 100;
    if (institute.currency === 'INR') {
      const abs = Math.abs(major);
      const fmt = (v: number, unit: string) => `₹${v.toLocaleString(institute.locale, { maximumFractionDigits: v < 10 ? 1 : 0 })}${unit}`;
      if (abs >= 1e7) return fmt(major / 1e7, 'Cr');
      if (abs >= 1e5) return fmt(major / 1e5, 'L');
      if (abs >= 1e3) return fmt(major / 1e3, 'K');
      return fmt(major, '');
    }
    return new Intl.NumberFormat(institute.locale, { style: 'currency', currency: institute.currency, notation: 'compact', maximumFractionDigits: 1 }).format(major);
  };
  return { money, day, count, ratio, value, range, compactMoney };
}

export const label = (value: string) => value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function filterLine(data: ReportDataset): string | null {
  const parts = [
    data.filters.courseName && `Course: ${data.filters.courseName}`,
    data.filters.leadSourceName && `Source: ${data.filters.leadSourceName}`,
    data.filters.counsellorName && `Counsellor: ${data.filters.counsellorName}`,
  ].filter(Boolean);
  return parts.length ? `Filtered to ${parts.join(' · ')}` : null;
}

export const AGEING_TEXT: Record<string, string> = {
  not_due: 'Not yet due',
  d1_30: '1–30 days overdue',
  d31_60: '31–60 days overdue',
  d61_90: '61–90 days overdue',
  d90_plus: 'Over 90 days overdue',
};

/** "monthly-report_2026-03-01_2026-03-31" (no spaces, safe in a header). */
export function reportBaseName(data: ReportDataset): string {
  const kind = data.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report';
  return `${kind}_${data.range.from}_${data.range.to}`;
}
