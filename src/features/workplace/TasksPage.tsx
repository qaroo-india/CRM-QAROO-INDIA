import { TASK_PRIORITIES, TASK_STATUSES, type TaskDto } from '@ims/shared';
import { ListChecks, MoreHorizontal, Paperclip, Pencil, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { DataTable, type Column } from '@/components/data/DataTable';
import { Pagination } from '@/components/data/Pagination';
import { FilterSelect, ResetFilters, SearchInput, Toolbar } from '@/components/data/Toolbar';
import { Button } from '@/components/ui/Button';
import { DialogContent, DialogRoot } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { PageHeader } from '@/components/ui/PageHeader';
import { SegmentedItem, SegmentedList } from '@/components/ui/Segmented';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useListParams } from '@/hooks/useListParams';
import { api, fetchFile, saveBlob, upload } from '@/lib/api';
import { cn } from '@/lib/cn';
import { toastError } from '@/lib/forms';
import { date, humanize } from '@/utils/format';
import { toOptions, useUserOptions } from '../shared/hooks';
import { useAction, useFieldErrors, useMyBatches, useTasks } from '../campus/api';

function TaskDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing: TaskDto | null }) {
  const { can, user } = useAuth();
  const people = useUserOptions();
  const batches = useMyBatches();
  const fields = useFieldErrors();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ title: '', details: '', assignedToId: '', priority: 'medium', dueDate: '', batchId: '' });

  useEffect(() => {
    if (!open) return;
    fields.clear();
    setFile(null);
    setForm(editing ? { title: editing.title, details: editing.details ?? '', assignedToId: editing.assignedToId ?? '', priority: editing.priority, dueDate: editing.dueDate ?? '', batchId: editing.batchId ?? '' } : { title: '', details: '', assignedToId: user?.id ?? '', priority: 'medium', dueDate: '', batchId: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const save = useAction(
    () => {
      if (editing) return api.put(`/tasks/${editing.id}`, form);
      const data = new FormData();
      for (const [k, v] of Object.entries(form)) if (v) data.set(k, v);
      if (file) data.set('file', file);
      return upload('/tasks', data);
    },
    { invalidate: [['tasks']], success: editing ? 'Task updated' : 'Task created', onDone: () => onOpenChange(false), silentErrors: true },
  );
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const canAssign = can('tasks:assign');

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={editing ? 'Edit task' : 'New task'}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={save.isPending} onClick={() => save.mutate(undefined, { onError: fields.capture })}>{editing ? 'Save' : 'Create'}</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Task" error={fields.errors.title} required className="sm:col-span-2">
            <Input value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={180} />
          </Field>
          <Field label="Details" className="sm:col-span-2">
            <Textarea rows={3} value={form.details} onChange={(e) => set({ details: e.target.value })} />
          </Field>
          <Field label="Assigned to" error={fields.errors.assignedToId} hint={canAssign ? undefined : 'You can create tasks for yourself'}>
            <Select value={form.assignedToId} disabled={!canAssign} onChange={(e) => set({ assignedToId: e.target.value })} options={toOptions(people.data)} />
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => set({ priority: e.target.value })} options={TASK_PRIORITIES.map((p) => ({ value: p, label: humanize(p) }))} />
          </Field>
          <Field label="Due">
            <Input type="date" value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
          </Field>
          <Field label="Batch (optional)">
            <Select value={form.batchId} onChange={(e) => set({ batchId: e.target.value })} options={(batches.data?.items ?? []).map((b) => ({ value: b.id, label: b.batchCode }))} placeholder="None" />
          </Field>
          {!editing && (
            <Field label="Attachment (optional)" error={fields.errors.file} className="sm:col-span-2">
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}><Paperclip aria-hidden className="size-4" /> {file ? 'Choose another' : 'Attach a file'}</Button>
                <span className="truncate text-sm text-fg-muted">{file?.name ?? ''}</span>
                <input ref={fileRef} type="file" className="sr-only" aria-label="Attachment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
            </Field>
          )}
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

export function TasksPage() {
  const { can, user } = useAuth();
  const list = useListParams(['scope', 'status', 'priority', 'overdue'] as const, { sort: { key: 'dueDate', order: 'asc' } });
  const scope = list.filters.scope || 'mine';
  const tasks = useTasks({ ...list.query, scope, sort: undefined, order: undefined });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TaskDto | null>(null);
  const setStatus = useAction(({ id, status }: { id: string; status: string }) => api.post(`/tasks/${id}/status`, { status }), { invalidate: [['tasks']], success: 'Task updated' });

  const attachment = async (t: TaskDto) => {
    try {
      saveBlob(await fetchFile(`/tasks/${t.id}/attachment`, { fallbackName: t.attachmentName ?? 'attachment' }));
    } catch (error) {
      toastError(error);
    }
  };

  const columns: Column<TaskDto>[] = [
    {
      id: 'title',
      header: 'Task',
      hideable: false,
      cell: (t) => (
        <div className="min-w-0">
          <p className={cn('font-medium text-fg', t.status === 'done' && 'text-fg-subtle line-through')}>{t.title}</p>
          <p className="truncate text-xs text-fg-subtle">
            {t.batchCode ? `${t.batchCode} · ` : ''}
            {scope === 'mine' ? `from ${t.createdById === user?.id ? 'you' : (t.createdByName ?? '—')}` : `for ${t.assignedToName ?? '—'}`}
            {t.attachmentName && (
              <button type="button" className="ml-2 inline-flex items-center gap-1 text-primary hover:underline" onClick={() => void attachment(t)}><Paperclip aria-hidden className="size-3" />{t.attachmentName}</button>
            )}
          </p>
        </div>
      ),
    },
    { id: 'priority', header: 'Priority', cell: (t) => <StatusBadge status={t.priority} /> },
    { id: 'due', header: 'Due', cell: (t) => <span className={cn('tabular-nums', t.isOverdue ? 'font-medium text-danger' : 'text-fg-muted')}>{t.dueDate ? date(t.dueDate) : '—'}{t.isOverdue ? ' · overdue' : ''}</span> },
    { id: 'status', header: 'Status', cell: (t) => <StatusBadge status={t.status} /> },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      hideable: false,
      align: 'right',
      cell: (t) => (
        <div className="flex justify-end gap-1">
          {t.status !== 'done' && t.status !== 'cancelled' && (
            <Button size="sm" variant="secondary" loading={setStatus.isPending && setStatus.variables?.id === t.id} onClick={() => setStatus.mutate({ id: t.id, status: t.status === 'todo' ? 'in_progress' : 'done' })}>
              {t.status === 'todo' ? 'Start' : 'Done'}
            </Button>
          )}
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`More for ${t.title}`}><MoreHorizontal aria-hidden className="size-4" /></Button>
            </MenuTrigger>
            <MenuContent>
              {(t.createdById === user?.id || can('tasks:assign')) && <MenuItem icon={<Pencil />} onSelect={() => { setEditing(t); setDialogOpen(true); }}>Edit</MenuItem>}
              {TASK_STATUSES.filter((s) => s !== t.status && (s !== 'cancelled' || t.createdById === user?.id || can('tasks:assign'))).map((s) => (
                <MenuItem key={s} onSelect={() => setStatus.mutate({ id: t.id, status: s })}>Mark {humanize(s).toLowerCase()}</MenuItem>
              ))}
            </MenuContent>
          </Menu>
        </div>
      ),
    },
  ];

  const scopes = [{ value: 'mine', label: 'Assigned to me' }, { value: 'created', label: 'Created by me' }, ...(can('tasks:assign') ? [{ value: 'all', label: 'Everyone' }] : [])];

  return (
    <>
      <PageHeader title="Tasks" description="Your work list. Overdue tasks are flagged, and you get a reminder each day they stay open." actions={<Button onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus aria-hidden className="size-4" /> New task</Button>} />
      <Toolbar>
        <SegmentedList label="Whose tasks" className="flex gap-1 self-end rounded-control border bg-surface p-1">
          {scopes.map((s) => (
            <SegmentedItem key={s.value} selected={scope === s.value} onClick={() => list.setFilter('scope', s.value === 'mine' ? '' : s.value)}>{s.label}</SegmentedItem>
          ))}
        </SegmentedList>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Task" />
        <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={TASK_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
        <FilterSelect label="Priority" value={list.filters.priority} onChange={(v) => list.setFilter('priority', v)} options={TASK_PRIORITIES.map((s) => ({ value: s, label: humanize(s) }))} />
        <FilterSelect label="Due" value={list.filters.overdue} onChange={(v) => list.setFilter('overdue', v)} options={[{ value: 'true', label: 'Overdue only' }]} allLabel="Any" />
        <ResetFilters onReset={list.reset} disabled={!list.isFiltered} />
      </Toolbar>
      <DataTable caption="Tasks" columns={columns} rows={tasks.data?.items} rowKey={(t) => t.id} loading={tasks.isPending} fetching={tasks.isFetching} error={tasks.error} empty={<EmptyState icon={ListChecks} title="Nothing here" description="Tasks assigned to you, or that you create, appear here." />} />
      {tasks.data && <Pagination page={tasks.data.page} totalPages={tasks.data.totalPages} total={tasks.data.total} limit={tasks.data.limit} onPageChange={list.setPage} onLimitChange={list.setLimit} />}
      <TaskDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
    </>
  );
}
