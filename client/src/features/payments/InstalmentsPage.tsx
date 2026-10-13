import { INSTALMENT_VIEWS, type InstalmentRow } from '@ims/shared';
import { CalendarClock } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { DataTable, type Column } from '@/components/data/DataTable';
import { Pagination } from '@/components/data/Pagination';
import { DateFilter, FilterSelect, ResetFilters, SearchInput, Toolbar } from '@/components/data/Toolbar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { SegmentedItem, SegmentedList } from '@/components/ui/Segmented';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useListParams } from '@/hooks/useListParams';
import { cn } from '@/lib/cn';
import { date, humanize, money, moneyCompact, number } from '@/utils/format';
import { toOptions, useCourses } from '../shared/hooks';
import { useAdmission } from '../students/api';
import { useInstalments } from './api';
import { RecordPaymentDialog } from './RecordPaymentDialog';

const VIEW_LABELS: Record<(typeof INSTALMENT_VIEWS)[number], string> = {
  overdue: 'Overdue',
  due_soon: 'Due in 7 days',
  upcoming: 'Upcoming',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  all_open: 'All open',
};

export function InstalmentsPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const list = useListParams(['view', 'from', 'to', 'courseId'] as const, { sort: { key: 'dueDate', order: 'asc' } });
  const view = (list.filters.view || 'overdue') as (typeof INSTALMENT_VIEWS)[number];
  const instalments = useInstalments({ ...list.query, view, sort: undefined });
  const courses = useCourses();
  const [payFor, setPayFor] = useState<string | null>(null);
  const admission = useAdmission(payFor);

  const columns: Column<InstalmentRow>[] = [
    {
      id: 'student',
      header: 'Student',
      hideable: false,
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{r.studentName}</p>
          <p className="truncate text-xs text-fg-subtle"><span className="font-mono">{r.admissionNumber}</span> · {r.courseName} · {r.studentPhone}</p>
        </div>
      ),
    },
    { id: 'instalment', header: 'Instalment', cell: (r) => <span className="text-fg-muted">#{r.sequence} {r.kind === 'instalment' ? '' : humanize(r.kind)}</span> },
    { id: 'due', header: 'Due', cell: (r) => <span className={cn('tabular-nums', r.status === 'overdue' ? 'font-medium text-danger' : 'text-fg-muted')}>{date(r.dueDate)}</span> },
    { id: 'amount', header: 'Amount', align: 'right', cell: (r) => <span className="tabular-nums">{money(r.amountMinor)}</span> },
    { id: 'paid', header: 'Paid', align: 'right', cell: (r) => <span className="tabular-nums text-fg-muted">{money(r.paidMinor)}</span> },
    { id: 'remaining', header: 'Remaining', align: 'right', cell: (r) => <span className="font-medium tabular-nums">{money(r.remainingMinor)}</span> },
    { id: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
    {
      id: 'action',
      header: <span className="sr-only">Actions</span>,
      hideable: false,
      align: 'right',
      cell: (r) =>
        auth.can('payments:write') && r.remainingMinor > 0 ? (
          <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setPayFor(r.admissionId); }}>Record payment</Button>
        ) : null,
    },
  ];

  const summary = instalments.data?.summary;

  return (
    <>
      <PageHeader
        title="Instalment plans"
        description="What is due, overdue and settled across every admission. Paid amounts come straight from receipts."
        breadcrumbs={[{ label: 'Finance' }, { label: 'Instalment plans' }]}
      />
      <SegmentedList label="Instalment views" className="mb-4 flex flex-wrap gap-1 rounded-control border bg-surface p-1">
        {INSTALMENT_VIEWS.map((v) => (
          <SegmentedItem
            key={v}
           
           
            selected={view === v}
            onClick={() => list.setFilter('view', v)}
          >
            {VIEW_LABELS[v]}
          </SegmentedItem>
        ))}
      </SegmentedList>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label={`${VIEW_LABELS[view]}: instalments`} value={instalments.data ? number(instalments.data.total) : '—'} icon={CalendarClock} loading={instalments.isPending} stale={instalments.isFetching} />
        <StatCard label="Scheduled amount" value={summary ? moneyCompact(summary.scheduledMinor) : '—'} loading={instalments.isPending} stale={instalments.isFetching} />
        <StatCard label="Still to collect" value={summary ? moneyCompact(summary.remainingMinor) : '—'} loading={instalments.isPending} stale={instalments.isFetching} hint="Scheduled amount minus allocations from succeeded receipts." />
      </div>
      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Student, code, phone or admission" />
        <DateFilter label="Due from" value={list.filters.from} onChange={(v) => list.setFilter('from', v)} />
        <DateFilter label="Due to" value={list.filters.to} onChange={(v) => list.setFilter('to', v)} />
        <FilterSelect label="Course" value={list.filters.courseId} onChange={(v) => list.setFilter('courseId', v)} options={toOptions(courses.data)} />
        <ResetFilters onReset={list.reset} disabled={!list.isFiltered} />
      </Toolbar>
      <DataTable
        caption="Instalments"
        columns={columns}
        rows={instalments.data?.items}
        rowKey={(r) => r.id}
        loading={instalments.isPending}
        fetching={instalments.isFetching}
        error={instalments.error}
        onRetry={() => void instalments.refetch()}
        onRowClick={(r) => navigate(`/students/${r.studentId}?tab=instalments`)}
        empty={<EmptyState icon={CalendarClock} title={view === 'overdue' ? 'Nothing is overdue' : 'No instalments in this view'} />}
      />
      {instalments.data && <Pagination page={instalments.data.page} totalPages={instalments.data.totalPages} total={instalments.data.total} limit={instalments.data.limit} onPageChange={list.setPage} onLimitChange={list.setLimit} />}
      <RecordPaymentDialog open={!!payFor && !!admission.data} onOpenChange={(open) => !open && setPayFor(null)} admission={admission.data ?? null} />
    </>
  );
}
