import { ADMISSION_STATUSES, ASSIGNMENT_QUEUE_STATUSES, type AdmissionDto } from '@ims/shared';
import { ClipboardList, Plus } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { ColumnToggle, DataTable, useColumnVisibility, type Column } from '@/components/data/DataTable';
import { Pagination } from '@/components/data/Pagination';
import { DateFilter, FilterSelect, ResetFilters, SearchInput, Toolbar } from '@/components/data/Toolbar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useListParams } from '@/hooks/useListParams';
import { cn } from '@/lib/cn';
import { date, humanize, money } from '@/utils/format';
import { toOptions, useCourses, useLeadSources, useUserOptions } from '../shared/hooks';
import { useAdmissions } from '../students/api';
import { AdmissionDrawer } from './AdmissionDrawer';

const FILTERS = ['status', 'courseId', 'counsellorId', 'sourceId', 'batchStatus', 'from', 'to', 'outstanding'] as const;

export function AdmissionsPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const list = useListParams(FILTERS, { sort: { key: 'admissionDate', order: 'desc' } });
  const admissions = useAdmissions(list.query);
  const courses = useCourses();
  const sources = useLeadSources();
  const people = useUserOptions();
  const openId = params.get('admission');

  const open = (id: string | null) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set('admission', id);
      else next.delete('admission');
      return next;
    });

  const columns: Column<AdmissionDto>[] = [
    {
      id: 'student',
      header: 'Admission',
      sortKey: 'studentName',
      hideable: false,
      cell: (a) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{a.studentName}</p>
          <p className="truncate text-xs text-fg-subtle"><span className="font-mono">{a.admissionNumber}</span> · {a.courseName}</p>
        </div>
      ),
    },
    { id: 'date', header: 'Admitted', sortKey: 'admissionDate', cell: (a) => <span className="text-fg-muted tabular-nums">{date(a.admissionDate)}</span> },
    { id: 'status', header: 'Status', cell: (a) => <StatusBadge status={a.status} /> },
    { id: 'agreed', header: 'Agreed', sortKey: 'agreedFee', align: 'right', cell: (a) => <span className="tabular-nums">{money(a.agreedFeeMinor)}</span> },
    { id: 'paid', header: 'Received', align: 'right', cell: (a) => <span className="text-fg-muted tabular-nums">{money(a.netPaidMinor)}</span> },
    {
      id: 'outstanding',
      header: 'Outstanding',
      sortKey: 'outstanding',
      align: 'right',
      cell: (a) => (
        <span className={cn('tabular-nums', a.overdueMinor > 0 ? 'font-medium text-danger' : a.outstandingMinor > 0 ? 'text-fg' : 'text-fg-subtle')}>
          {money(a.outstandingMinor)}
        </span>
      ),
    },
    { id: 'batch', header: 'Batch', cell: (a) => <StatusBadge status={a.batchStatus} /> },
    { id: 'source', header: 'Source', cell: (a) => <span className="text-fg-muted">{a.sourceName ?? 'Unattributed'}</span> },
    { id: 'counsellor', header: 'Counsellor', defaultHidden: true, cell: (a) => <span className="text-fg-muted">{a.counsellorName ?? '—'}</span> },
    { id: 'discount', header: 'Discount', defaultHidden: true, align: 'right', cell: (a) => <span className="tabular-nums text-fg-muted">{money(a.discountMinor)}</span> },
  ];
  const visibility = useColumnVisibility('admissions', columns);

  return (
    <>
      <PageHeader
        title="Admissions"
        description="Every enrolment with its agreed fee and live balance from the payment ledger."
        breadcrumbs={[{ label: 'Growth' }, { label: 'Admissions' }]}
        actions={auth.can('admissions:write') && <Button onClick={() => navigate('/admissions/new')}><Plus aria-hidden className="size-4" /> Register admission</Button>}
      />
      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Search number, student or phone" />
        <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={ADMISSION_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
        <FilterSelect label="Course" value={list.filters.courseId} onChange={(v) => list.setFilter('courseId', v)} options={toOptions(courses.data)} />
        <FilterSelect label="Source" value={list.filters.sourceId} onChange={(v) => list.setFilter('sourceId', v)} options={[{ value: 'unattributed', label: 'Unattributed' }, ...toOptions(sources.data)]} />
        <FilterSelect label="Counsellor" value={list.filters.counsellorId} onChange={(v) => list.setFilter('counsellorId', v)} options={toOptions(people.data)} />
        <FilterSelect label="Batch" value={list.filters.batchStatus} onChange={(v) => list.setFilter('batchStatus', v)} options={ASSIGNMENT_QUEUE_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
        <FilterSelect label="Balance" value={list.filters.outstanding} onChange={(v) => list.setFilter('outstanding', v)} options={[{ value: 'true', label: 'Has outstanding' }]} allLabel="Any" />
        <DateFilter label="Admitted from" value={list.filters.from} onChange={(v) => list.setFilter('from', v)} max={list.filters.to || undefined} />
        <DateFilter label="to" value={list.filters.to} onChange={(v) => list.setFilter('to', v)} min={list.filters.from || undefined} />
        <ResetFilters onReset={list.reset} disabled={!list.isFiltered} />
        <div className="ml-auto"><ColumnToggle columns={columns} visibility={visibility} /></div>
      </Toolbar>
      <DataTable
        caption="Admissions"
        columns={columns}
        visibility={visibility}
        rows={admissions.data?.items}
        rowKey={(a) => a.id}
        loading={admissions.isPending}
        fetching={admissions.isFetching}
        error={admissions.error}
        onRetry={() => void admissions.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={(a) => open(a.id)}
        empty={<EmptyState icon={ClipboardList} title={list.isFiltered ? 'No admissions match these filters' : 'No admissions yet'} />}
      />
      {admissions.data && (
        <Pagination page={admissions.data.page} totalPages={admissions.data.totalPages} total={admissions.data.total} limit={admissions.data.limit} onPageChange={list.setPage} onLimitChange={list.setLimit} />
      )}
      <AdmissionDrawer admissionId={openId} onOpenChange={(isOpen) => !isOpen && open(null)} />
    </>
  );
}
