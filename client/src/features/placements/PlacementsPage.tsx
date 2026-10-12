import { PLACEMENT_STAGES, REPORT_PERIODS, resolvePeriod, type ApplicationDto, type PlacementProfileDto, type ReportPeriod } from '@ims/shared';
import { BriefcaseBusiness, CircleCheck, Send, Target, UserCheck, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { BarList } from '@/components/charts/BarList';
import { ChartCard, ColumnChart, DataTableView } from '@/components/charts/ChartKit';
import { DataTable, type Column } from '@/components/data/DataTable';
import { Pagination } from '@/components/data/Pagination';
import { DateFilter, FilterSelect, ResetFilters, SearchInput, Toolbar } from '@/components/data/Toolbar';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useListParams } from '@/hooks/useListParams';
import { cn } from '@/lib/cn';
import { date, getFormatConfig, humanize, month, money, number, percent } from '@/utils/format';
import { toOptions, useCourses, useUserOptions } from '../shared/hooks';
import { useApplications, useCompanies, usePlacementAnalytics, useProfiles } from './api';
import { ProfileDrawer } from './ProfileDrawer';

type Tab = 'pipeline' | 'profiles' | 'applications' | 'analytics';
const TABS: Record<Tab, string> = { pipeline: 'Pipeline', profiles: 'Students', applications: 'Applications', analytics: 'Analytics' };
const BOARD_STAGES = ['eligible', 'resume_preparation', 'ready', 'applied', 'interview_scheduled', 'interviewing', 'selected', 'offer_received', 'joined'] as const;

function Pipeline({ track, courseId, q, onOpen }: { track: string; courseId: string; q: string; onOpen: (id: string) => void }) {
  const profiles = useProfiles({ track, courseId, q, limit: 100 });
  if (profiles.isPending) return <LoadingBlock />;
  if (profiles.isError) return <ErrorState error={profiles.error} onRetry={() => void profiles.refetch()} />;
  const items = profiles.data.items;
  const other = items.filter((p) => !(BOARD_STAGES as readonly string[]).includes(p.stage));
  return (
    <>
      <div className={cn('flex gap-3 overflow-x-auto pb-3', profiles.isFetching && 'opacity-70')}>
        {BOARD_STAGES.map((stage) => {
          const cards = items.filter((p) => p.stage === stage);
          return (
            <section key={stage} aria-label={`${humanize(stage)}: ${cards.length}`} className="flex w-60 shrink-0 flex-col rounded-card border bg-surface-sunken">
              <header className="flex items-center justify-between px-3 py-2.5">
                <h3 className="text-sm font-medium text-fg">{humanize(stage)}</h3>
                <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-fg-muted tabular-nums">{cards.length}</span>
              </header>
              <div className="flex max-h-[60dvh] flex-col gap-2 overflow-y-auto px-2 pb-2">
                {cards.map((p) => (
                  <button key={p.id} type="button" onClick={() => onOpen(p.id)} className="rounded-xl border bg-surface p-3 text-left shadow-card transition-colors hover:border-primary/40">
                    <p className="truncate text-sm font-medium text-fg">{p.studentName}</p>
                    <p className="truncate text-xs text-fg-subtle">{p.courseName}</p>
                    <p className="mt-1 text-xs text-fg-muted">{p.applications} application(s){p.interviewsUpcoming ? ` · ${p.interviewsUpcoming} interview(s) ahead` : ''}</p>
                  </button>
                ))}
                {cards.length === 0 && <p className="py-4 text-center text-xs text-fg-subtle">None</p>}
              </div>
            </section>
          );
        })}
      </div>
      {other.length > 0 && <p className="mt-2 text-xs text-fg-subtle">{other.length} student(s) on hold, withdrawn or not seeking: see the Students tab.</p>}
    </>
  );
}

function Analytics({ track, courseId }: { track: string; courseId: string }) {
  const [period, setPeriod] = useState<ReportPeriod>('this_year');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const resolved = period === 'custom' && custom.from && custom.to ? { from: custom.from, to: custom.to } : resolvePeriod(period === 'custom' ? 'this_year' : period, { timeZone: getFormatConfig().timeZone }).range;
  const analytics = usePlacementAnalytics({ ...resolved, track, courseId: courseId || undefined });
  const a = analytics.data;
  const f = a?.funnel;
  const trackKey = track === 'technical' ? 'technical' : 'nonTechnical';

  return (
    <div className="space-y-5">
      <Toolbar>
        <FilterSelect label="Cohort: eligible during" value={period} onChange={(v) => setPeriod((v || 'this_year') as ReportPeriod)} options={REPORT_PERIODS.map((p) => ({ value: p, label: humanize(p) }))} allLabel="This year" />
        {period === 'custom' && (
          <>
            <DateFilter label="From" value={custom.from} onChange={(v) => setCustom((c) => ({ ...c, from: v }))} />
            <DateFilter label="To" value={custom.to} onChange={(v) => setCustom((c) => ({ ...c, to: v }))} />
          </>
        )}
      </Toolbar>
      <p className="-mt-2 text-xs text-fg-subtle">
        Rate = students who joined ÷ students who became eligible from {date(resolved.from)} to {date(resolved.to)}, excluding those withdrawn or not seeking. Each student counts once, however many offers they hold.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Eligible cohort" value={f ? number(f.eligible) : '—'} icon={Users} loading={analytics.isPending} stale={analytics.isFetching} hint={f ? `${f.excluded} withdrawn or not seeking` : undefined} />
        <StatCard label="Applied" value={f ? number(f.applied) : '—'} icon={Send} loading={analytics.isPending} stale={analytics.isFetching} />
        <StatCard label="Interviewed" value={f ? number(f.interviewed) : '—'} icon={Target} loading={analytics.isPending} stale={analytics.isFetching} hint="Completed at least one interview round (passed or failed)." />
        <StatCard label="Offered" value={f ? number(f.offered) : '—'} icon={CircleCheck} loading={analytics.isPending} stale={analytics.isFetching} hint="Unique students with at least one offer." />
        <StatCard label="Placement rate" value={f ? `${percent(f.placementRate)} · ${number(f.joined)} joined` : '—'} icon={UserCheck} loading={analytics.isPending} stale={analytics.isFetching} hint="Only joining counts as placed." />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Students who joined, by month"
          subtitle="By joining date"
          loading={analytics.isPending}
          stale={analytics.isFetching}
          table={<DataTableView rows={a?.monthlyJoined ?? []} columns={[{ key: 'm', label: 'Month', render: (r) => month(r.month) }, { key: 'v', label: 'Joined', align: 'right', render: (r) => number(r[trackKey]) }]} />}
        >
          <ColumnChart data={a?.monthlyJoined ?? []} xKey="month" series={[{ key: trackKey, label: 'Joined' }]} formatValue={(v) => number(v)} formatX={(m) => month(m)} />
        </ChartCard>
        <ChartCard
          title="Placement rate by course"
          loading={analytics.isPending}
          stale={analytics.isFetching}
          table={<DataTableView rows={a?.byCourse ?? []} columns={[{ key: 'c', label: 'Course', render: (r) => r.courseName }, { key: 'e', label: 'Eligible', align: 'right', render: (r) => r.eligible }, { key: 'j', label: 'Joined', align: 'right', render: (r) => r.joined }, { key: 'r', label: 'Rate', align: 'right', render: (r) => percent(r.placementRate) }]} />}
        >
          <BarList items={(a?.byCourse ?? []).map((c) => ({ key: c.courseId, label: c.courseName, value: c.placementRate ?? 0, display: percent(c.placementRate), secondary: `${c.joined}/${c.eligible - c.excluded}` }))} />
        </ChartCard>
      </div>
      <ChartCard
        title="Hiring companies"
        subtitle="Applications made in the period"
        loading={analytics.isPending}
        height={200}
        table={<DataTableView rows={a?.byCompany ?? []} columns={[{ key: 'c', label: 'Company', render: (r) => r.companyName }, { key: 'a', label: 'Applications', align: 'right', render: (r) => r.applications }, { key: 'o', label: 'Offers', align: 'right', render: (r) => r.offers }, { key: 'j', label: 'Joined', align: 'right', render: (r) => r.joined }]} />}
      >
        <BarList items={(a?.byCompany ?? []).slice(0, 8).map((c) => ({ key: c.companyId, label: c.companyName, value: c.applications, display: `${c.applications} applications`, secondary: `${c.offers} offers · ${c.joined} joined` }))} />
      </ChartCard>
    </div>
  );
}

export function PlacementsPage() {
  const { track: trackParam } = useParams();
  const track = trackParam === 'non-technical' ? 'non_technical' : 'technical';
  const [params, setParams] = useSearchParams();
  const list = useListParams(['courseId', 'stage', 'coordinatorId', 'outcome', 'companyId'] as const, { sort: { key: 'updatedAt', order: 'desc' } });
  const tab = ((Object.keys(TABS) as Tab[]).includes(params.get('tab') as Tab) ? params.get('tab') : 'pipeline') as Tab;
  const openId = params.get('profile');
  const courses = useCourses();
  const people = useUserOptions();
  const companies = useCompanies();
  const profiles = useProfiles({ ...list.query, track, outcome: undefined, companyId: undefined });
  const applications = useApplications({ ...list.query, track, stage: undefined, coordinatorId: undefined, courseId: undefined });
  const setParam = (key: string, value: string | null) => setParams((c) => { const p = new URLSearchParams(c); if (value) p.set(key, value); else p.delete(key); return p; });
  const placementCourses = (courses.data ?? []).filter((c) => c.placementTrack === track || c.placementTrack === 'both');

  const profileColumns: Column<PlacementProfileDto>[] = [
    { id: 'student', header: 'Student', hideable: false, cell: (p) => <div><p className="font-medium text-fg">{p.studentName}</p><p className="text-xs text-fg-subtle">{p.courseName} · {p.studentPhone}</p></div> },
    { id: 'stage', header: 'Stage', cell: (p) => <StatusBadge status={p.stage} /> },
    { id: 'eligible', header: 'Eligible', cell: (p) => <span className="tabular-nums text-fg-muted">{date(p.eligibleOn)}</span> },
    { id: 'resume', header: 'Resume', cell: (p) => <StatusBadge status={p.resumeStatus} /> },
    { id: 'apps', header: 'Applications', align: 'right', cell: (p) => p.applications },
    { id: 'coordinator', header: 'Coordinator', cell: (p) => <span className="text-fg-muted">{p.coordinatorName ?? '—'}</span> },
  ];
  const applicationColumns: Column<ApplicationDto>[] = [
    { id: 'student', header: 'Student', hideable: false, cell: (a) => <button type="button" className="font-medium text-fg hover:text-primary" onClick={(e) => { e.stopPropagation(); setParam('profile', a.profileId); }}>{a.studentName}</button> },
    { id: 'company', header: 'Company', cell: (a) => <span>{a.companyName}</span> },
    { id: 'job', header: 'Role', cell: (a) => <span className="text-fg-muted">{a.jobTitle}</span> },
    { id: 'applied', header: 'Applied', cell: (a) => <span className="tabular-nums text-fg-muted">{date(a.appliedOn)}</span> },
    { id: 'interviews', header: 'Interviews', align: 'right', cell: (a) => a.interviews.length },
    { id: 'outcome', header: 'Outcome', cell: (a) => <StatusBadge status={a.outcome} /> },
    { id: 'package', header: 'Package', align: 'right', cell: (a) => (a.offerPackageMinor === null ? '—' : money(a.offerPackageMinor, { compactDecimals: true })) },
  ];

  return (
    <>
      <PageHeader
        title={track === 'technical' ? 'Technical placement' : 'Non-technical placement'}
        description="Eligibility, applications, interviews and offers. A student counts as placed only after joining."
        breadcrumbs={[{ label: 'Placement' }, { label: track === 'technical' ? 'Technical' : 'Non-technical' }]}
        actions={<Link to={track === 'technical' ? '/placements/non-technical' : '/placements/technical'} className="text-sm text-primary hover:underline">Switch to {track === 'technical' ? 'non-technical' : 'technical'}</Link>}
      />
      <div role="tablist" aria-label="Placement views" className="mb-4 flex flex-wrap gap-1 rounded-control border bg-surface p-1">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setParam('tab', t)} className={cn('rounded-lg px-3 py-1.5 text-sm font-medium transition-colors', tab === t ? 'bg-primary-soft text-primary' : 'text-fg-muted hover:text-fg')}>{TABS[t]}</button>
        ))}
      </div>
      {tab !== 'analytics' && (
        <Toolbar>
          <SearchInput value={list.q} onChange={list.setQ} placeholder={tab === 'applications' ? 'Student, company or role' : 'Student or admission'} />
          {tab !== 'applications' && <FilterSelect label="Course" value={list.filters.courseId} onChange={(v) => list.setFilter('courseId', v)} options={toOptions(placementCourses)} />}
          {tab === 'profiles' && <FilterSelect label="Stage" value={list.filters.stage} onChange={(v) => list.setFilter('stage', v)} options={PLACEMENT_STAGES.map((s) => ({ value: s, label: humanize(s) }))} />}
          {tab === 'profiles' && <FilterSelect label="Coordinator" value={list.filters.coordinatorId} onChange={(v) => list.setFilter('coordinatorId', v)} options={toOptions(people.data)} />}
          {tab === 'applications' && <FilterSelect label="Outcome" value={list.filters.outcome} onChange={(v) => list.setFilter('outcome', v)} options={['in_progress', 'selected', 'rejected', 'offer_received', 'offer_declined', 'joined', 'withdrawn'].map((o) => ({ value: o, label: humanize(o) }))} />}
          {tab === 'applications' && <FilterSelect label="Company" value={list.filters.companyId} onChange={(v) => list.setFilter('companyId', v)} options={toOptions(companies.data)} />}
          <ResetFilters onReset={list.reset} disabled={!list.isFiltered} />
        </Toolbar>
      )}
      {tab === 'pipeline' && <Pipeline track={track} courseId={list.filters.courseId} q={list.q} onOpen={(id) => setParam('profile', id)} />}
      {tab === 'profiles' && (
        <>
          <DataTable caption="Placement students" columns={profileColumns} rows={profiles.data?.items} rowKey={(p) => p.id} loading={profiles.isPending} fetching={profiles.isFetching} error={profiles.error} onRowClick={(p) => setParam('profile', p.id)} empty={<EmptyState icon={BriefcaseBusiness} title="No students in placement yet" description="Profiles open automatically when a student completes a course with placement support." />} />
          {profiles.data && <Pagination page={profiles.data.page} totalPages={profiles.data.totalPages} total={profiles.data.total} limit={profiles.data.limit} onPageChange={list.setPage} onLimitChange={list.setLimit} />}
        </>
      )}
      {tab === 'applications' && (
        <>
          <DataTable caption="Applications" columns={applicationColumns} rows={applications.data?.items} rowKey={(a) => a.id} loading={applications.isPending} fetching={applications.isFetching} error={applications.error} onRowClick={(a) => setParam('profile', a.profileId)} empty={<EmptyState icon={Send} title="No applications yet" />} />
          {applications.data && <Pagination page={applications.data.page} totalPages={applications.data.totalPages} total={applications.data.total} limit={applications.data.limit} onPageChange={list.setPage} onLimitChange={list.setLimit} />}
        </>
      )}
      {tab === 'analytics' && <Analytics track={track} courseId={list.filters.courseId} />}
      <ProfileDrawer profileId={openId} onOpenChange={(o) => !o && setParam('profile', null)} />
    </>
  );
}
