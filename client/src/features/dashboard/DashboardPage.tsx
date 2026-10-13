import type { DashboardData } from '@ims/shared';
import { CalendarClock, ClipboardCheck, GraduationCap, HandCoins, Landmark, LineChart, PhoneCall, UsersRound } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { ChartCard, ColumnChart, DataTableView } from '@/components/charts/ChartKit';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { cn } from '@/lib/cn';
import { date, money, moneyCompact, month, number, percent } from '@/utils/format';
import { useDashboard, useReportParams } from '../reports/api';
import {
  AgeingCard,
  CashTrendCard,
  CounsellorTable,
  CoursesCard,
  EnquiryTrendCard,
  ExpenseCategoriesCard,
  KpiGrid,
  PlacementCard,
  rangeText,
  ReportFilterBar,
  SourcesCard,
} from '../reports/sections';

function LiveStrip({ data }: { data: DashboardData | undefined }) {
  const { can } = useAuth();
  const live = data?.live;
  const items = [
    { label: 'Active students', value: live?.activeStudents, icon: UsersRound, to: can('admissions:read') ? '/admissions?status=active' : undefined },
    { label: 'Awaiting first payment', value: live?.pendingPaymentAdmissions, icon: ClipboardCheck, to: can('admissions:read') ? '/admissions?status=pending_payment' : undefined },
    { label: 'Not in a batch', value: live?.unassignedStudents, icon: GraduationCap, to: can('batches:read') ? '/batches?tab=queue' : undefined, warn: (live?.unassignedStudents ?? 0) > 0 },
    { label: 'Follow-ups today', value: live?.followUpsDueToday, icon: PhoneCall, to: can('leads:read') ? '/leads?followUp=today' : undefined },
    { label: 'Missed follow-ups', value: live?.overdueFollowUps, icon: PhoneCall, to: can('leads:read') ? '/leads?followUp=overdue' : undefined, warn: (live?.overdueFollowUps ?? 0) > 0 },
    ...(live?.instalmentsDueThisWeek !== null && live?.instalmentsDueThisWeek !== undefined
      ? [
          { label: 'Instalments due in 7 days', value: live.instalmentsDueThisWeek, icon: CalendarClock, to: can('feePlans:read') ? '/instalments?view=due_soon' : undefined },
          { label: 'Overdue instalments', value: live.overdueInstalments ?? 0, icon: CalendarClock, to: can('feePlans:read') ? '/instalments?view=overdue' : undefined, warn: (live.overdueInstalments ?? 0) > 0 },
          { label: 'Expenses to approve', value: live.pendingExpenseApprovals ?? 0, icon: HandCoins, to: can('expenses:read') ? '/expenses?status=pending' : undefined },
          { label: 'Loans in progress', value: live.activeLoans ?? 0, icon: Landmark, to: can('loans:read') ? '/loans?status=applied,under_review,approved' : undefined },
        ]
      : []),
  ];
  return (
    <section aria-label="Today at a glance" className="stagger grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-9">
      {items.map((item) => {
        const body = (
          <>
            <item.icon aria-hidden className={cn('size-4 shrink-0', item.warn ? 'text-warning' : 'text-fg-subtle')} />
            <span className="min-w-0">
              <span className="block text-lg leading-tight font-semibold text-fg tabular-nums">{item.value === undefined ? '—' : number(item.value)}</span>
              <span className="block truncate text-xs text-fg-muted">{item.label}</span>
            </span>
          </>
        );
        const className = 'flex items-center gap-3 rounded-xl border bg-surface px-3 py-2.5 shadow-card';
        return item.to ? (
          <Link key={item.label} to={item.to} className={cn(className, 'transition-colors hover:border-primary/40')}>
            {body}
          </Link>
        ) : (
          <div key={item.label} className={className}>
            {body}
          </div>
        );
      })}
    </section>
  );
}

function MonthlyGrowthCard({ data, loading, stale }: { data: DashboardData | undefined; loading: boolean; stale: boolean }) {
  const rows = data?.monthly ?? [];
  const fin = data?.includesFinance;
  return (
    <ChartCard
      title="Monthly growth"
      subtitle="Admissions over the last 12 months"
      loading={loading}
      stale={stale}
      table={
        <DataTableView
          rows={rows}
          columns={[
            { key: 'm', label: 'Month', render: (r) => month(r.month) },
            { key: 'l', label: 'Enquiries', align: 'right', render: (r) => number(r.leads) },
            { key: 'a', label: 'Admissions', align: 'right', render: (r) => number(r.admissions) },
            ...(fin ? [{ key: 'c', label: 'Net collected', align: 'right' as const, render: (r: (typeof rows)[number]) => money(r.netCollectedMinor) }] : []),
          ]}
        />
      }
    >
      <ColumnChart data={rows} xKey="month" series={[{ key: 'admissions', label: 'Admissions' }]} formatValue={number} formatX={(m) => month(m).split(' ')[0]!} />
    </ChartCard>
  );
}

function BatchProgressCard({ data, loading }: { data: DashboardData | undefined; loading: boolean }) {
  const batches = data?.batches ?? [];
  return (
    <Card className="flex flex-col">
      <header className="flex items-start justify-between gap-3 px-5 pt-4">
        <div>
          <h3 className="text-sm font-semibold text-fg">Batch progress</h3>
          <p className="text-xs text-fg-subtle">Seats filled and course calendar elapsed</p>
        </div>
        <Link to="/batches" className="text-xs text-primary hover:underline">All batches</Link>
      </header>
      <ul className="flex-1 space-y-3 px-5 pt-3 pb-4">
        {loading && <li className="text-sm text-fg-subtle">Loading…</li>}
        {!loading && batches.length === 0 && <li className="py-6 text-center text-sm text-fg-subtle">No planned or running batches.</li>}
        {batches.map((b) => {
          const fill = b.capacity > 0 ? b.enrolled / b.capacity : 0;
          return (
            <li key={b.id}>
              <Link to={`/batches/${b.id}`} className="block rounded-lg p-1 -m-1 transition-colors hover:bg-surface-raised">
                <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-fg">
                    {b.name} <span className="text-xs text-fg-subtle">{b.courseName}</span>
                  </span>
                  <StatusBadge status={b.status} />
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs text-fg-muted">
                  <div>
                    <div className="mb-1 flex justify-between"><span>Seats</span><span className="tabular-nums">{b.enrolled}/{b.capacity}</span></div>
                    <div className="h-1.5 rounded-full bg-surface-sunken" aria-hidden><div className={cn('h-1.5 rounded-full', fill >= 1 ? 'bg-warning' : 'bg-series-1')} style={{ width: `${Math.min(100, fill * 100)}%` }} /></div>
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between"><span>{b.progress === null ? `Starts ${date(b.startDate)}` : 'Calendar'}</span><span className="tabular-nums">{b.progress === null ? '' : percent(b.progress, 0)}</span></div>
                    <div className="h-1.5 rounded-full bg-surface-sunken" aria-hidden><div className="h-1.5 rounded-full bg-series-2" style={{ width: `${(b.progress ?? 0) * 100}%` }} /></div>
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function DashboardPage() {
  const { values, set, reset, query, ready, isFiltered } = useReportParams('dashboard');
  const dashboard = useDashboard(query, ready);
  const data = dashboard.data;
  const loading = dashboard.isPending && ready;
  const stale = dashboard.isFetching && !dashboard.isPending;

  return (
    <>
      <PageHeader
        title="Executive dashboard"
        description={
          data
            ? `${data.label}: ${rangeText(data.range)} · compared with ${rangeText(data.previous)} · balances as of ${date(data.asOf)} (${data.timeZone})`
            : 'Admissions, collections, receivables and placement at a glance.'
        }
        actions={
          <Link to="/reports" className="inline-flex h-9 items-center gap-2 rounded-control border border-border-strong bg-surface-raised px-3 text-sm font-medium text-fg hover:border-primary/50">
            <LineChart aria-hidden className="size-4" /> Reports & exports
          </Link>
        }
      />
      <div className="space-y-5">
        <ReportFilterBar mode="dashboard" values={values} set={set} reset={reset} isFiltered={isFiltered} />
        {!ready && <p className="text-sm text-fg-muted">Choose both a start and an end date for the custom period.</p>}
        {dashboard.isError ? (
          <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
        ) : (
          <>
            {data && isFiltered && (
              <p className="text-xs text-fg-subtle">
                Filtered to {[data.filters.courseName, data.filters.leadSourceName, data.filters.counsellorName].filter(Boolean).join(' · ')}. Expenses are institute-wide and are hidden while filtered.
              </p>
            )}
            <KpiGrid data={data} loading={loading} stale={stale} />
            <LiveStrip data={data} />
            <div className="grid gap-4 xl:grid-cols-2">
              <EnquiryTrendCard data={data} loading={loading} stale={stale} />
              <CashTrendCard data={data} loading={loading} stale={stale} />
              <MonthlyGrowthCard data={data} loading={loading} stale={stale} />
              <AgeingCard data={data} loading={loading} stale={stale} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              <SourcesCard data={data} loading={loading} stale={stale} />
              <CoursesCard data={data} loading={loading} stale={stale} />
              <ExpenseCategoriesCard data={data} loading={loading} stale={stale} />
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <BatchProgressCard data={data} loading={loading} />
              <PlacementCard data={data} loading={loading} stale={stale} />
            </div>
            <CounsellorTable data={data} loading={loading} />
            {data && <p className="text-xs text-fg-subtle">Updated {new Date(data.generatedAt).toLocaleTimeString()} · refreshes every 5 minutes. {data.includesFinance ? `Net collections ${moneyCompact(data.summary.finance?.netCollectedMinor.current ?? 0)} for the period.` : 'Financial figures need the "financial reports" permission.'}</p>}
          </>
        )}
      </div>
    </>
  );
}
