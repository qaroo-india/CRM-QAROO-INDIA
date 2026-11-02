import { BATCH_STATUSES, addMonths, diffDays, startOfMonth, todayInZone, trainerSchema, type QueueItem, type TrainerDto } from '@ims/shared';
import { CalendarRange, GraduationCap, Hourglass, Plus, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { DataTable, type Column } from '@/components/data/DataTable';
import { Pagination } from '@/components/data/Pagination';
import { FilterSelect, ResetFilters, SearchInput, Toolbar } from '@/components/data/Toolbar';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { DialogRoot, DrawerContent } from '@/components/ui/Dialog';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { Input, Select } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { SegmentedItem, SegmentedList } from '@/components/ui/Segmented';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Switch } from '@/components/ui/Toggle';
import { useListParams } from '@/hooks/useListParams';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { handleFormError, useZodForm } from '@/lib/forms';
import { date, getFormatConfig, humanize, month, number, relative } from '@/utils/format';
import { useTeachingCourses } from '../campus/api';
import { toOptions } from '../shared/hooks';
import { PortalAccessCard } from '../staff/PortalAccessCard';
import { useBatches, useBatchMutation, useQueue, useTrainers } from './api';
import { AssignDialog, BatchFormDrawer, CapacityMeter } from './components';

type Tab = 'batches' | 'queue' | 'schedule' | 'trainers';
const TAB_LABELS: Record<Tab, string> = { batches: 'Batches', queue: 'Assignment queue', schedule: 'Schedule', trainers: 'Trainers' };

function BatchGrid({ courseId, status, q }: { courseId: string; status: string; q: string }) {
  const batches = useBatches({ courseId, status, q, limit: 100, order: 'asc' });
  if (batches.isPending) return <LoadingBlock />;
  if (batches.isError) return <ErrorState error={batches.error} onRetry={() => void batches.refetch()} />;
  if (batches.data.items.length === 0) return <EmptyState icon={GraduationCap} title="No batches match" />;
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-3', batches.isFetching && 'opacity-70')}>
      {batches.data.items.map((b) => (
        <Link key={b.id} to={`/batches/${b.id}`} className="block rounded-card border bg-surface p-4 shadow-card transition-[border-color,transform] hover:-translate-y-0.5 hover:border-primary/40">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium text-fg">{b.name}</p>
              <p className="truncate text-xs text-fg-subtle"><span className="font-mono">{b.batchCode}</span> · {b.courseName}</p>
            </div>
            <StatusBadge status={b.status} />
          </div>
          <p className="mt-3 text-xs text-fg-muted">{date(b.startDate)}{b.endDate ? ` – ${date(b.endDate)}` : ''}{b.schedule ? ` · ${b.schedule}` : ''}</p>
          <p className="text-xs text-fg-muted">Trainer: {b.trainerName ?? 'not assigned'}</p>
          <CapacityMeter className="mt-3" enrolled={b.enrolled} capacity={b.capacity} />
        </Link>
      ))}
    </div>
  );
}

function QueueTab({ courseId, q }: { courseId: string; q: string }) {
  const auth = useAuth();
  const [page, setPage] = useState(1);
  const [batchStatus, setBatchStatus] = useState('');
  const queue = useQueue({ courseId, q, page, batchStatus, limit: 25 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const mark = useBatchMutation(({ id, status }: { id: string; status: string }) => api.post(`/admissions/${id}/batch-status`, { batchStatus: status }), 'Queue status updated');

  const items = queue.data?.items ?? [];
  const chosen = items.filter((i) => selected.has(i.admissionId));
  const sameCourse = chosen.length > 0 && chosen.every((i) => i.courseId === chosen[0]!.courseId);
  const options = sameCourse ? chosen[0]!.openBatches : [];
  const targetBatch = options.find((b) => b.id === target);

  const columns: Column<QueueItem>[] = [
    { id: 'student', header: 'Student', hideable: false, cell: (i) => <div><Link to={`/students/${i.studentId}`} className="font-medium text-fg hover:text-primary" onClick={(e) => e.stopPropagation()}>{i.studentName}</Link><p className="text-xs text-fg-subtle"><span className="font-mono">{i.admissionNumber}</span> · {i.studentPhone}</p></div> },
    { id: 'course', header: 'Course', cell: (i) => <span className="text-fg-muted">{i.courseName}</span> },
    { id: 'admitted', header: 'Admitted', cell: (i) => <span className="tabular-nums text-fg-muted">{date(i.admissionDate)}</span> },
    { id: 'waiting', header: 'Waiting', align: 'right', cell: (i) => <span className={cn('tabular-nums', i.daysWaiting > 14 ? 'font-medium text-warning' : 'text-fg-muted')}>{i.daysWaiting} d</span> },
    { id: 'queue', header: 'Queue status', cell: (i) => <StatusBadge status={i.batchStatus} /> },
    { id: 'open', header: 'Open batches', cell: (i) => <span className="text-xs text-fg-muted">{i.openBatches.length ? i.openBatches.map((b) => `${b.batchCode} (${b.seatsLeft})`).join(', ') : 'None with seats'}</span> },
    {
      id: 'mark',
      header: <span className="sr-only">Queue</span>,
      hideable: false,
      cell: (i) =>
        auth.can('batches:assign') ? (
          <Select
            aria-label={`Queue status for ${i.studentName}`}
            className="h-8 w-44 text-xs"
            value={i.batchStatus}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => mark.mutate({ id: i.admissionId, status: e.target.value })}
            options={['not_assigned', 'waiting_for_next_batch', 'eligible'].map((s) => ({ value: s, label: humanize(s) }))}
          />
        ) : null,
    },
  ];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-subtle">Queue status</span>
          <Select className="h-9 w-48" value={batchStatus} onChange={(e) => { setBatchStatus(e.target.value); setPage(1); }} placeholder="All waiting" options={['not_assigned', 'waiting_for_next_batch', 'eligible'].map((s) => ({ value: s, label: humanize(s) }))} />
        </label>
        {auth.can('batches:assign') && selected.size > 0 && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-fg-subtle">Assign {selected.size} to</span>
              <Select className="h-9 w-56" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={sameCourse ? 'Choose a batch…' : 'Select students of one course'} disabled={!sameCourse} options={options.map((b) => ({ value: b.id, label: `${b.batchCode} · ${b.seatsLeft} left` }))} />
            </label>
            <Button className="h-9" size="sm" disabled={!targetBatch} onClick={() => setAssignOpen(true)}>Assign</Button>
          </>
        )}
      </div>
      <DataTable
        caption="Students waiting for a batch"
        columns={columns}
        rows={queue.data?.items}
        rowKey={(i) => i.admissionId}
        loading={queue.isPending}
        fetching={queue.isFetching}
        error={queue.error}
        selection={auth.can('batches:assign') ? { selected, onChange: setSelected } : undefined}
        empty={<EmptyState icon={Hourglass} title="Nobody is waiting for a batch" />}
      />
      {queue.data && <Pagination page={queue.data.page} totalPages={queue.data.totalPages} total={queue.data.total} limit={queue.data.limit} onPageChange={setPage} />}
      <AssignDialog batch={targetBatch ?? null} items={chosen} open={assignOpen} onOpenChange={setAssignOpen} onDone={() => { setSelected(new Set()); setTarget(''); }} />
    </>
  );
}

function ScheduleTab({ courseId }: { courseId: string }) {
  const batches = useBatches({ courseId, status: 'planned,enrolling,running', limit: 100, order: 'asc' });
  const today = todayInZone(getFormatConfig().timeZone);
  const start = startOfMonth(addMonths(today, -1));
  const months = Array.from({ length: 7 }, (_, i) => addMonths(start, i));
  const end = addMonths(start, 7);
  const span = diffDays(start, end);
  if (batches.isPending) return <LoadingBlock />;
  const items = (batches.data?.items ?? []).filter((b) => (b.endDate ?? addMonths(b.startDate, 3)) >= start && b.startDate < end);
  if (items.length === 0) return <EmptyState icon={CalendarRange} title="No running or upcoming batches in this window" />;
  const pos = (d: string) => Math.min(100, Math.max(0, (diffDays(start, d) / span) * 100));

  return (
    <Card>
      <CardContent className="overflow-x-auto">
        <div className="min-w-[44rem]">
          <div className="mb-2 grid grid-cols-[12rem_1fr] text-xs text-fg-subtle">
            <span />
            <div className="relative h-5">
              {months.map((m) => <span key={m} className="absolute" style={{ left: `${pos(m)}%` }}>{month(m.slice(0, 7))}</span>)}
            </div>
          </div>
          <ul className="space-y-2">
            {items.map((b) => {
              const left = pos(b.startDate);
              const right = pos(b.endDate ?? addMonths(b.startDate, 3));
              return (
                <li key={b.id} className="grid grid-cols-[12rem_1fr] items-center gap-2">
                  <Link to={`/batches/${b.id}`} className="truncate text-sm text-fg hover:text-primary">{b.batchCode} <span className="text-xs text-fg-subtle">{b.courseName}</span></Link>
                  <div className="relative h-6 rounded bg-surface-sunken">
                    <span aria-hidden className="absolute top-0 bottom-0 w-px bg-danger/60" style={{ left: `${pos(today)}%` }} />
                    <div className="absolute top-1 bottom-1 rounded bg-series-1/80" style={{ left: `${left}%`, width: `${Math.max(1, right - left)}%` }} title={`${date(b.startDate)} – ${b.endDate ? date(b.endDate) : 'open'}`} />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-fg-subtle">Bars run from start to end date (open-ended batches show three months). The red line is today.</p>
        </div>
      </CardContent>
    </Card>
  );
}

function TrainerDrawer({ trainer, open, onOpenChange }: { trainer: TrainerDto | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const defaults = useMemo(() => ({ name: trainer?.name ?? '', email: trainer?.email ?? '', phone: trainer?.phone ?? '', expertise: trainer?.expertise ?? '', isActive: trainer?.isActive ?? true }), [trainer]);
  const form = useZodForm(trainerSchema, { defaultValues: defaults });
  const [enableFacultyLogin, setEnableFacultyLogin] = useState(true);
  const [portalPassword, setPortalPassword] = useState('Faculty@1234');

  useEffect(() => {
    if (open) {
      form.reset(defaults);
      setEnableFacultyLogin(true);
      setPortalPassword('Faculty@1234');
    }
  }, [open, defaults, form]);

  const save = useBatchMutation(
    (v: Record<string, unknown>) =>
      trainer
        ? api.put(`/trainers/${trainer.id}`, {
            ...v,
            ...(enableFacultyLogin && portalPassword ? { portalPassword } : {}),
          })
        : api.post('/trainers', {
            ...v,
            ...(enableFacultyLogin && portalPassword ? { portalPassword } : {}),
          }),
    'Trainer saved',
  );
  const errors = form.formState.errors;
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={trainer ? `Edit ${trainer.name}` : 'Add trainer'} width="md" footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v, { onSuccess: () => onOpenChange(false), onError: (e) => handleFormError(form, e) }))}>Save</Button></>}>
        <form noValidate className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <Field label="Name" error={errors.name?.message} required><Input {...form.register('name')} /></Field>
          <Field label="Email" error={errors.email?.message}><Input type="email" {...form.register('email')} /></Field>
          <Field label="Phone"><Input type="tel" {...form.register('phone')} /></Field>
          <Field label="Expertise"><Input {...form.register('expertise')} /></Field>
          <Switch id="trainer-active" checked={form.watch('isActive') ?? true} onCheckedChange={(v) => form.setValue('isActive', v)} label="Active" />

          {Boolean(form.watch('email')) && (
            <div className="space-y-3 rounded-control border bg-surface-sunken p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-fg">Faculty login</span>
                <Switch
                  id="trainer-portal"
                  checked={enableFacultyLogin}
                  onCheckedChange={setEnableFacultyLogin}
                  label="Enable login"
                />
              </div>
              {enableFacultyLogin && (
                <div className="space-y-2 pt-1">
                  <label className="block text-xs font-medium text-fg-muted">Password for {form.watch('email')}</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 rounded border bg-surface px-3 py-1.5 font-mono text-sm text-fg"
                      value={portalPassword}
                      onChange={(e) => setPortalPassword(e.target.value)}
                      placeholder="Minimum 10 characters"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
                        const rand = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
                        setPortalPassword(`Faculty@${rand}2026`);
                      }}
                    >
                      Generate
                    </Button>
                  </div>
                  <p className="text-xs text-fg-subtle">Faculty can sign in with their email and this password immediately.</p>
                </div>
              )}
            </div>
          )}
        </form>
        {trainer?.portal && (
          <div className="mt-6 space-y-2 border-t pt-5">
            <h3 className="text-sm font-semibold text-fg">Current login status</h3>
            <PortalAccessCard bare kind="trainer" recordId={trainer.id} name={trainer.name} email={trainer.email} portal={trainer.portal} invalidate={[['trainers']]} />
          </div>
        )}
      </DrawerContent>
    </DialogRoot>
  );
}

function TrainersTab() {
  const auth = useAuth();
  const trainers = useTrainers();
  const [editing, setEditing] = useState<TrainerDto | null>(null);
  const [open, setOpen] = useState(false);
  const columns: Column<TrainerDto>[] = [
    { id: 'name', header: 'Trainer', hideable: false, cell: (t) => <div><p className="font-medium text-fg">{t.name}</p><p className="text-xs text-fg-subtle">{[t.email, t.phone].filter(Boolean).join(' · ') || '—'}</p></div> },
    { id: 'expertise', header: 'Expertise', cell: (t) => <span className="text-fg-muted">{t.expertise ?? '—'}</span> },
    { id: 'batches', header: 'Live batches', align: 'right', cell: (t) => number(t.activeBatches) },
    { id: 'status', header: 'Status', cell: (t) => <StatusBadge status={t.isActive ? 'active' : 'draft'} label={t.isActive ? 'Active' : 'Inactive'} /> },
    { id: 'login', header: 'Faculty login', cell: (t) => <span className="text-sm text-fg-muted">{t.portal?.isActive ? (t.portal.lastLoginAt ? `Signed in ${relative(t.portal.lastLoginAt)}` : 'Not signed in yet') : t.portal ? 'Switched off' : '—'}</span> },
  ];
  return (
    <>
      {auth.can('batches:write') && <div className="mb-3 flex justify-end"><Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><UserRound aria-hidden className="size-4" /> Add trainer</Button></div>}
      <DataTable caption="Trainers" columns={columns} rows={trainers.data} rowKey={(t) => t.id} loading={trainers.isPending} error={trainers.error} onRowClick={auth.can('batches:write') ? (t) => { setEditing(t); setOpen(true); } : undefined} empty={<EmptyState icon={UserRound} compact title="No trainers yet" />} />
      <TrainerDrawer trainer={editing ? (trainers.data?.find((t) => t.id === editing.id) ?? editing) : null} open={open} onOpenChange={setOpen} />
    </>
  );
}

export function BatchesPage() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const list = useListParams(['courseId', 'status'] as const, { sort: { key: 'startDate', order: 'asc' } });
  const courses = useTeachingCourses();
  const [creating, setCreating] = useState(false);
  // Faculty see their own batches; the queue and trainer list are office work.
  const tabs: Tab[] = auth.accountType === 'faculty' ? ['batches', 'schedule'] : ['batches', 'queue', 'schedule', 'trainers'];
  const tab = (tabs.includes(params.get('tab') as Tab) ? params.get('tab') : 'batches') as Tab;

  return (
    <>
      <PageHeader
        title="Batches & trainers"
        description="Batches by course, the queue of students waiting for one, and who teaches what."
        breadcrumbs={[{ label: 'Delivery' }, { label: 'Batches & trainers' }]}
        actions={auth.can('batches:write') && <Button onClick={() => setCreating(true)}><Plus aria-hidden className="size-4" /> New batch</Button>}
      />
      <SegmentedList label="Batch views" className="mb-4 flex flex-wrap gap-1 rounded-control border bg-surface p-1">
        {tabs.map((t) => (
          <SegmentedItem key={t} selected={tab === t} onClick={() => setParams((c) => { const p = new URLSearchParams(c); p.set('tab', t); return p; })}>
            {TAB_LABELS[t]}
          </SegmentedItem>
        ))}
      </SegmentedList>
      {tab !== 'trainers' && (
        <Toolbar>
          <SearchInput value={list.q} onChange={list.setQ} placeholder={tab === 'queue' ? 'Student, phone or admission' : 'Batch name or code'} />
          <FilterSelect label="Course" value={list.filters.courseId} onChange={(v) => list.setFilter('courseId', v)} options={toOptions(courses.data)} />
          {tab === 'batches' && <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={BATCH_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />}
          <ResetFilters onReset={list.reset} disabled={!list.isFiltered} />
        </Toolbar>
      )}
      {tab === 'batches' && <BatchGrid courseId={list.filters.courseId} status={list.filters.status} q={list.q} />}
      {tab === 'queue' && <QueueTab courseId={list.filters.courseId} q={list.q} />}
      {tab === 'schedule' && <ScheduleTab courseId={list.filters.courseId} />}
      {tab === 'trainers' && <TrainersTab />}
      <BatchFormDrawer batch={null} open={creating} onOpenChange={setCreating} />
    </>
  );
}

