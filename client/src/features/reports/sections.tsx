/**
 * Building blocks shared by the dashboard and the report page, so a figure
 * is defined, labelled and drawn the same way on both.
 */

import { REPORT_PERIODS, REPORT_TYPES, type AgeingBucket, type DateRange, type ReportDataset } from '@ims/shared';
import { ClipboardList, HandCoins, Megaphone, Percent, Scale, TriangleAlert, UserCheck, Wallet } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { BarList } from '@/components/charts/BarList';
import { ChartCard, ColumnChart, DataTableView, TrendChart } from '@/components/charts/ChartKit';
import { DateFilter, FilterSelect, ResetFilters, Toolbar } from '@/components/data/Toolbar';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { date, humanize, money, moneyCompact, month, number, percent } from '@/utils/format';
import { toOptions, useCourses, useLeadSources, useUserOptions } from '../shared/hooks';
import type { ReportParams } from './api';

export function rangeText(range: DateRange): string {
  return range.from === range.to ? date(range.from) : `${date(range.from)} – ${date(range.to)}`;
}

export function bucketLabel(key: string, bucket: ReportDataset['bucket']): string {
  if (bucket === 'month') return month(key);
  if (bucket === 'week') return `Week of ${date(key)}`;
  return date(key);
}

const shortDay = (key: string) => {
  const [, m, d] = key.split('-');
  return `${Number(d)}/${Number(m)}`;
};
export const axisLabel = (bucket: ReportDataset['bucket']) => (key: string) => (bucket === 'month' ? month(key).split(' ')[0]! : shortDay(key));

export const AGEING_LABELS: Record<AgeingBucket, string> = {
  not_due: 'Not yet due',
  d1_30: '1–30 days overdue',
  d31_60: '31–60 days',
  d61_90: '61–90 days',
  d90_plus: 'Over 90 days',
};

/* ------------------------------------------------------------------ *
 * Filters
 * ------------------------------------------------------------------ */

export function ReportFilterBar({
  mode,
  values,
  set,
  reset,
  isFiltered,
}: {
  mode: 'dashboard' | 'report';
  values: ReportParams;
  set: (changes: Partial<ReportParams>) => void;
  reset: () => void;
  isFiltered: boolean;
}) {
  const courses = useCourses();
  const sources = useLeadSources();
  const people = useUserOptions();
  const custom = mode === 'dashboard' ? values.period === 'custom' : values.type === 'custom';
  return (
    <Toolbar>
      {mode === 'dashboard' ? (
        <FilterSelect label="Period" value={values.period} onChange={(v) => set({ period: (v || 'this_month') as ReportParams['period'] })} options={REPORT_PERIODS.map((p) => ({ value: p, label: humanize(p) }))} allLabel="This month" />
      ) : (
        <FilterSelect label="Report" value={values.type} onChange={(v) => set({ type: (v || 'monthly') as ReportParams['type'] })} options={REPORT_TYPES.map((t) => ({ value: t, label: humanize(t) }))} allLabel="Monthly" />
      )}
      {custom ? (
        <>
          <DateFilter label="From" value={values.from} max={values.to || undefined} onChange={(v) => set({ from: v })} />
          <DateFilter label="To" value={values.to} min={values.from || undefined} onChange={(v) => set({ to: v })} />
        </>
      ) : (
        mode === 'report' && <DateFilter label={values.type === 'daily' ? 'Day' : 'Any day in the period'} value={values.reference} onChange={(v) => set({ reference: v })} />
      )}
      <FilterSelect label="Course" value={values.courseId} onChange={(v) => set({ courseId: v })} options={toOptions(courses.data)} />
      <FilterSelect label="Lead source" value={values.leadSourceId} onChange={(v) => set({ leadSourceId: v })} options={toOptions(sources.data)} />
      <FilterSelect label="Counsellor" value={values.counsellorId} onChange={(v) => set({ counsellorId: v })} options={toOptions(people.data)} />
      <ResetFilters onReset={reset} disabled={!isFiltered && !custom && !values.reference && values.period === 'this_month' && values.type === 'monthly'} />
    </Toolbar>
  );
}

/* ------------------------------------------------------------------ *
 * Drill-down links: only offered when the target page can show the
 * exact same slice, so a click never lands on different numbers.
 * ------------------------------------------------------------------ */

function link(path: string, params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

export function useDrill(data: ReportDataset | undefined) {
  const { can } = useAuth();
  if (!data) return {} as Record<'leads' | 'admissions' | 'payments' | 'expenses' | 'outstanding' | 'overdue', string | undefined>;
  const { range, filters: f } = data;
  const onlyCourse = !f.leadSourceId && !f.counsellorId;
  const noDims = onlyCourse && !f.courseId;
  return {
    leads: can('leads:read') ? link('/leads', { from: range.from, to: range.to, sourceId: f.leadSourceId, courseId: f.courseId, counsellorId: f.counsellorId }) : undefined,
    admissions: can('admissions:read')
      ? link('/admissions', { from: range.from, to: range.to, status: 'pending_payment,active,completed,withdrawn', sourceId: f.leadSourceId, courseId: f.courseId, counsellorId: f.counsellorId })
      : undefined,
    payments: can('payments:read') && onlyCourse ? link('/payments', { from: range.from, to: range.to, status: 'succeeded', courseId: f.courseId }) : undefined,
    expenses: can('expenses:read') && noDims ? link('/expenses', { from: range.from, to: range.to }) : undefined,
    outstanding: can('admissions:read') ? link('/admissions', { outstanding: 'true', sourceId: f.leadSourceId, courseId: f.courseId, counsellorId: f.counsellorId }) : undefined,
    overdue: can('feePlans:read') && onlyCourse ? link('/instalments', { view: 'overdue', courseId: f.courseId }) : undefined,
  };
}

/* ------------------------------------------------------------------ *
 * KPI tiles
 * ------------------------------------------------------------------ */

export function KpiGrid({ data, loading, stale }: { data: ReportDataset | undefined; loading: boolean; stale: boolean }) {
  const s = data?.summary;
  const f = s?.finance;
  const drill = useDrill(data);
  const vs = 'vs previous period';
  const delta = (m: { current: number; previous: number | null } | undefined, upIsGood = true) =>
    m && m.previous !== null ? { current: m.current, previous: m.previous, upIsGood, label: vs } : undefined;
  const leadSpark = data?.trend.map((t) => t.leads);
  const admissionSpark = data?.trend.map((t) => t.admissions);
  const cashSpark = data?.cashTrend?.map((t) => t.collectedMinor - t.refundedMinor);
  const showFinance = loading || data?.includesFinance;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="New enquiries" icon={Megaphone} loading={loading} stale={stale} value={s ? number(s.leads.current) : '—'} delta={delta(s?.leads)} sparkline={leadSpark} to={drill.leads} hint="Leads with an enquiry date in the period. Each lead counts once." />
      <StatCard label="Admissions" icon={ClipboardList} loading={loading} stale={stale} value={s ? number(s.admissions.current) : '—'} delta={delta(s?.admissions)} sparkline={admissionSpark} to={drill.admissions} hint="Admissions dated in the period, excluding cancelled ones." />
      <StatCard
        label="Lead conversion"
        icon={Percent}
        loading={loading}
        stale={stale}
        value={s ? percent(s.conversionRate.current) : '—'}
        hint={`Of the leads that enquired in the period, the share converted by its end (${s ? `${number(s.convertedLeads.current)} of ${number(s.leads.current)}` : '…'}). Previous period: ${s ? percent(s.conversionRate.previous) : '…'}.`}
      />
      <StatCard label="Students placed" icon={UserCheck} loading={loading} stale={stale} value={s ? number(s.placementsJoined.current) : '—'} delta={delta(s?.placementsJoined)} hint="Unique students whose joining date falls in the period. An offer alone is not a placement." />
      {showFinance && (
        <>
          <StatCard label="Net collections" icon={Wallet} loading={loading} stale={stale} value={f ? moneyCompact(f.netCollectedMinor.current) : '—'} delta={delta(f?.netCollectedMinor)} sparkline={cashSpark} to={drill.payments} hint={f ? `Receipts ${money(f.collectedMinor.current)} minus refunds ${money(f.refundedMinor.current)}, by payment date. Reversed receipts are excluded.` : undefined} />
          <StatCard label="Outstanding fees" icon={Scale} loading={loading} stale={stale} value={f ? moneyCompact(f.outstandingMinor) : '—'} to={drill.outstanding} hint={data ? `Owed at the end of ${date(data.asOf)} on admissions made by then, after discounts, waivers and refunds.` : undefined} />
          <StatCard label="Overdue" icon={TriangleAlert} loading={loading} stale={stale} value={f ? moneyCompact(f.overdueMinor) : '—'} to={drill.overdue} hint={data ? `Instalments due before ${date(data.asOf)} and still unpaid at its end.` : undefined} />
          {f?.expensesMinor === null ? (
            <StatCard label="Expenses" icon={HandCoins} value="—" hint="Expenses are institute-wide, so they are hidden while a course, source or counsellor filter is on." />
          ) : (
            <StatCard label="Expenses" icon={HandCoins} loading={loading} stale={stale} value={f?.expensesMinor ? moneyCompact(f.expensesMinor.current) : '—'} delta={delta(f?.expensesMinor ?? undefined, false)} to={drill.expenses} hint={f?.netCashFlowMinor ? `Recorded and approved expenses by expense date. Net cash flow: ${money(f.netCashFlowMinor.current)}.` : undefined} />
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Charts
 * ------------------------------------------------------------------ */

interface CardProps {
  data: ReportDataset | undefined;
  loading: boolean;
  stale?: boolean;
  className?: string;
}

export function EnquiryTrendCard({ data, loading, stale, className }: CardProps) {
  const bucket = data?.bucket ?? 'day';
  return (
    <ChartCard
      className={className}
      title="Enquiries and admissions"
      subtitle={data ? `Per ${bucket} · ${rangeText(data.range)}` : undefined}
      loading={loading}
      stale={stale}
      table={<DataTableView rows={data?.trend ?? []} columns={[{ key: 'k', label: humanize(bucket), render: (r) => bucketLabel(r.key, bucket) }, { key: 'l', label: 'Enquiries', align: 'right', render: (r) => number(r.leads) }, { key: 'a', label: 'Admissions', align: 'right', render: (r) => number(r.admissions) }]} />}
    >
      <TrendChart data={data?.trend ?? []} xKey="key" series={[{ key: 'leads', label: 'Enquiries' }, { key: 'admissions', label: 'Admissions' }]} formatValue={number} formatX={axisLabel(bucket)} />
    </ChartCard>
  );
}

export function CashTrendCard({ data, loading, stale, className }: CardProps) {
  if (!loading && !data?.cashTrend) return null;
  const bucket = data?.bucket ?? 'day';
  const rows = (data?.cashTrend ?? []).map((r) => ({ ...r, netMinor: r.collectedMinor - r.refundedMinor, expenses: r.expensesMinor ?? 0 }));
  const withExpenses = data?.cashTrend?.[0]?.expensesMinor !== null;
  return (
    <ChartCard
      className={className}
      title={withExpenses ? 'Net collections vs expenses' : 'Net collections'}
      subtitle={data ? `Per ${bucket} · receipts minus refunds` : undefined}
      loading={loading}
      stale={stale}
      table={
        <DataTableView
          rows={rows}
          columns={[
            { key: 'k', label: humanize(bucket), render: (r) => bucketLabel(r.key, bucket) },
            { key: 'c', label: 'Collected', align: 'right', render: (r) => money(r.collectedMinor) },
            { key: 'r', label: 'Refunded', align: 'right', render: (r) => money(r.refundedMinor) },
            { key: 'n', label: 'Net', align: 'right', render: (r) => money(r.netMinor) },
            ...(withExpenses ? [{ key: 'e', label: 'Expenses', align: 'right' as const, render: (r: (typeof rows)[number]) => money(r.expensesMinor) }] : []),
          ]}
        />
      }
    >
      <ColumnChart data={rows} xKey="key" series={withExpenses ? [{ key: 'netMinor', label: 'Net collections' }, { key: 'expenses', label: 'Expenses' }] : [{ key: 'netMinor', label: 'Net collections' }]} formatValue={(v) => money(v)} formatAxis={moneyCompact} formatX={axisLabel(bucket)} />
    </ChartCard>
  );
}

export function SourcesCard({ data, loading, stale, className }: CardProps) {
  const rows = data?.sources ?? [];
  return (
    <ChartCard
      className={className}
      title="Lead sources"
      subtitle="Admissions attributed, with lead conversion"
      loading={loading}
      stale={stale}
      table={
        <DataTableView
          rows={rows}
          columns={[
            { key: 'n', label: 'Source', render: (r) => r.name },
            { key: 'l', label: 'Leads', align: 'right', render: (r) => number(r.leads) },
            { key: 'c', label: 'Converted', align: 'right', render: (r) => number(r.converted) },
            { key: 'r', label: 'Rate', align: 'right', render: (r) => percent(r.conversionRate) },
            { key: 'a', label: 'Admissions', align: 'right', render: (r) => number(r.admissions) },
            ...(data?.includesFinance ? [{ key: 'm', label: 'Net collected', align: 'right' as const, render: (r: (typeof rows)[number]) => money(r.collectedMinor) }] : []),
          ]}
        />
      }
    >
      <div className="h-full overflow-y-auto pr-1">
        <BarList items={rows.map((r) => ({ key: r.leadSourceId, label: r.name, value: r.admissions, display: `${number(r.admissions)} admitted`, secondary: `${number(r.leads)} leads · ${percent(r.conversionRate)}` }))} />
      </div>
    </ChartCard>
  );
}

export function CoursesCard({ data, loading, stale, className }: CardProps) {
  const rows = data?.courses ?? [];
  const fin = data?.includesFinance;
  return (
    <ChartCard
      className={className}
      title="Course enrolment"
      subtitle="Admissions in the period"
      loading={loading}
      stale={stale}
      table={
        <DataTableView
          rows={rows}
          columns={[
            { key: 'n', label: 'Course', render: (r) => r.name },
            { key: 'l', label: 'Enquiries', align: 'right', render: (r) => number(r.leads) },
            { key: 'a', label: 'Admissions', align: 'right', render: (r) => number(r.admissions) },
            ...(fin
              ? [
                  { key: 'f', label: 'Agreed fees', align: 'right' as const, render: (r: (typeof rows)[number]) => money(r.agreedFeeMinor) },
                  { key: 'c', label: 'Net collected', align: 'right' as const, render: (r: (typeof rows)[number]) => money(r.collectedMinor) },
                  { key: 'o', label: 'Outstanding', align: 'right' as const, render: (r: (typeof rows)[number]) => money(r.outstandingMinor) },
                ]
              : []),
          ]}
        />
      }
    >
      <div className="h-full overflow-y-auto pr-1">
        <BarList items={rows.filter((r) => r.admissions > 0).map((r) => ({ key: r.courseId, label: r.name, value: r.admissions, display: number(r.admissions), secondary: fin ? `${moneyCompact(r.outstandingMinor)} owed` : undefined }))} />
      </div>
    </ChartCard>
  );
}

export function AgeingCard({ data, loading, stale, className }: CardProps) {
  if (!loading && !data?.ageing) return null;
  const rows = (data?.ageing ?? []).map((a) => ({ ...a, label: AGEING_LABELS[a.bucket] }));
  return (
    <ChartCard
      className={className}
      title="Outstanding by age"
      subtitle={data ? `As of ${date(data.asOf)} · oldest debt counted first` : undefined}
      loading={loading}
      stale={stale}
      table={<DataTableView rows={rows} columns={[{ key: 'b', label: 'Age', render: (r) => r.label }, { key: 'a', label: 'Amount', align: 'right', render: (r) => money(r.amountMinor) }]} />}
    >
      <ColumnChart data={rows} xKey="label" series={[{ key: 'amountMinor', label: 'Owed' }]} formatValue={(v) => money(v)} formatAxis={moneyCompact} formatX={(l) => l.replace(' overdue', '')} />
    </ChartCard>
  );
}

export function ExpenseCategoriesCard({ data, loading, stale, className }: CardProps) {
  if (!loading && !data?.expenseCategories) return null;
  const rows = data?.expenseCategories ?? [];
  return (
    <ChartCard
      className={className}
      title="Expenses by category"
      loading={loading}
      stale={stale}
      table={<DataTableView rows={rows} columns={[{ key: 'n', label: 'Category', render: (r) => r.name }, { key: 'c', label: 'Entries', align: 'right', render: (r) => number(r.count) }, { key: 'a', label: 'Amount', align: 'right', render: (r) => money(r.amountMinor) }]} />}
    >
      <div className="h-full overflow-y-auto pr-1">
        <BarList items={rows.map((r) => ({ key: r.categoryId, label: r.name, value: r.amountMinor, display: money(r.amountMinor, { compactDecimals: true }) }))} />
      </div>
    </ChartCard>
  );
}

export function PlacementCard({ data, loading, stale, className }: CardProps) {
  const rows = (data?.placements ?? []).map((p) => ({ ...p, label: p.track === 'technical' ? 'Technical' : 'Non-technical' }));
  return (
    <ChartCard
      className={className}
      title="Placement: technical vs non-technical"
      subtitle="Students who became eligible in the period"
      loading={loading}
      stale={stale}
      table={<DataTableView rows={rows} columns={[{ key: 't', label: 'Track', render: (r) => r.label }, { key: 'e', label: 'Eligible', align: 'right', render: (r) => number(r.eligible) }, { key: 'o', label: 'Offered', align: 'right', render: (r) => number(r.offered) }, { key: 'j', label: 'Joined', align: 'right', render: (r) => number(r.joined) }, { key: 'r', label: 'Placement rate', align: 'right', render: (r) => percent(r.placementRate) }]} />}
    >
      <ColumnChart data={rows} xKey="label" series={[{ key: 'eligible', label: 'Eligible' }, { key: 'offered', label: 'Offered' }, { key: 'joined', label: 'Joined' }]} formatValue={number} />
    </ChartCard>
  );
}

export function CounsellorTable({ data, loading }: CardProps) {
  const rows = data?.counsellors ?? [];
  return (
    <Card className="overflow-hidden">
      <header className="px-5 pt-4">
        <h3 className="text-sm font-semibold text-fg">Counsellor performance</h3>
        <p className="text-xs text-fg-subtle">Leads by assigned counsellor; admissions and collections by the admission's counsellor</p>
      </header>
      <div className="overflow-x-auto px-3 pt-2 pb-4">
        {loading ? (
          <p className="px-2 py-6 text-sm text-fg-subtle">Loading…</p>
        ) : (
          <DataTableView
            rows={rows}
            columns={[
              { key: 'n', label: 'Counsellor', render: (r) => r.name },
              { key: 'l', label: 'Leads', align: 'right', render: (r) => number(r.leads) },
              { key: 'c', label: 'Converted', align: 'right', render: (r) => number(r.converted) },
              { key: 'r', label: 'Conversion', align: 'right', render: (r) => percent(r.conversionRate) },
              { key: 'a', label: 'Admissions', align: 'right', render: (r) => number(r.admissions) },
              ...(data?.includesFinance ? [{ key: 'm', label: 'Net collected', align: 'right' as const, render: (r: (typeof rows)[number]) => money(r.collectedMinor) }] : []),
            ]}
          />
        )}
      </div>
    </Card>
  );
}

