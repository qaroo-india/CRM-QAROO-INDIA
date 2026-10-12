import { ADMISSION_STATUSES, type StudentDto } from '@ims/shared';
import { FileUp, Plus, UsersRound } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { ColumnToggle, DataTable, useColumnVisibility, type Column } from '@/components/data/DataTable';
import { Pagination } from '@/components/data/Pagination';
import { FilterSelect, ResetFilters, SearchInput, Toolbar } from '@/components/data/Toolbar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { useListParams } from '@/hooks/useListParams';
import { cn } from '@/lib/cn';
import { date, humanize, money, number } from '@/utils/format';
import { toOptions, useActionParam, useCourses } from '../shared/hooks';
import { useStudents } from './api';
import { StudentFormDrawer } from './StudentFormDrawer';
import { ImportDialog } from '../import/ImportDialog';

export function StudentsPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const list = useListParams(['courseId', 'admissionStatus'] as const, { sort: { key: 'createdAt', order: 'desc' } });
  const students = useStudents(list.query);
  const courses = useCourses();
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const openNew = useCallback(() => setOpen(true), []);
  useActionParam('new', openNew);

  const columns: Column<StudentDto>[] = [
    {
      id: 'name',
      header: 'Student',
      sortKey: 'fullName',
      hideable: false,
      cell: (s) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{s.fullName}</p>
          <p className="truncate text-xs text-fg-subtle"><span className="font-mono">{s.studentCode}</span> · {s.phone}</p>
        </div>
      ),
    },
    { id: 'course', header: 'Latest course', cell: (s) => <span className="text-fg-muted">{s.latestCourseName ?? '—'}</span> },
    { id: 'admissions', header: 'Admissions', align: 'right', cell: (s) => <span className="tabular-nums">{number(s.admissionCount)}</span> },
    {
      id: 'outstanding',
      header: 'Outstanding',
      sortKey: 'outstanding',
      align: 'right',
      cell: (s) => <span className={cn('tabular-nums', s.outstandingMinor > 0 ? 'font-medium text-fg' : 'text-fg-subtle')}>{money(s.outstandingMinor)}</span>,
    },
    { id: 'email', header: 'Email', defaultHidden: true, cell: (s) => <span className="text-fg-muted">{s.email ?? '—'}</span> },
    { id: 'city', header: 'City', defaultHidden: true, cell: (s) => <span className="text-fg-muted">{s.city ?? '—'}</span> },
    { id: 'created', header: 'Registered', sortKey: 'createdAt', cell: (s) => <span className="text-fg-muted tabular-nums">{date(s.createdAt.slice(0, 10))}</span> },
  ];
  const visibility = useColumnVisibility('students', columns);

  return (
    <>
      <PageHeader
        title="Students"
        description="One profile per person, with every admission, payment, batch and placement linked to it."
        breadcrumbs={[{ label: 'Growth' }, { label: 'Students' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            {auth.can('data:import') && auth.can('students:write') && <Button variant="secondary" onClick={() => setImportOpen(true)}><FileUp aria-hidden className="size-4" /> Import</Button>}
            {auth.can('students:write') && <Button onClick={openNew}><Plus aria-hidden className="size-4" /> Register student</Button>}
          </div>
        }
      />
      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Search name, code, phone or email" />
        <FilterSelect label="Course" value={list.filters.courseId} onChange={(v) => list.setFilter('courseId', v)} options={toOptions(courses.data)} />
        <FilterSelect label="Admission status" value={list.filters.admissionStatus} onChange={(v) => list.setFilter('admissionStatus', v)} options={ADMISSION_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
        <ResetFilters onReset={list.reset} disabled={!list.isFiltered} />
        <div className="ml-auto"><ColumnToggle columns={columns} visibility={visibility} /></div>
      </Toolbar>
      <DataTable
        caption="Students"
        columns={columns}
        visibility={visibility}
        rows={students.data?.items}
        rowKey={(s) => s.id}
        loading={students.isPending}
        fetching={students.isFetching}
        error={students.error}
        onRetry={() => void students.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={(s) => navigate(`/students/${s.id}`)}
        empty={<EmptyState icon={UsersRound} title={list.isFiltered ? 'No students match these filters' : 'No students yet'} description={list.isFiltered ? undefined : 'Students are created when you register an admission, or here directly.'} />}
      />
      {students.data && (
        <Pagination page={students.data.page} totalPages={students.data.totalPages} total={students.data.total} limit={students.data.limit} onPageChange={list.setPage} onLimitChange={list.setLimit} />
      )}
      <StudentFormDrawer student={null} open={open} onOpenChange={setOpen} onSaved={(s) => navigate(`/students/${s.id}`)} />
      <ImportDialog entity="students" open={importOpen} onOpenChange={setImportOpen} />
    </>
  );
}
