import { addDays, CLASS_SESSION_KINDS, startOfWeek, todayInZone, type ClassSessionDto } from '@ims/shared';
import { CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, CircleCheck, CircleX, ExternalLink, MapPin, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { FilterSelect, Toolbar } from '@/components/data/Toolbar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DialogContent, DialogRoot } from '@/components/ui/Dialog';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Checkbox, Switch } from '@/components/ui/Toggle';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { getFormatConfig, humanize } from '@/utils/format';
import { useTrainers } from '../batches/api';
import { useActionParam } from '../shared/hooks';
import { useAction, useFieldErrors, useMyBatches, useSchedule } from '../campus/api';
import { dayLabel, splitInstant, timeOf, toInstant, WEEKDAYS } from '../campus/time';

interface Form {
  batchId: string;
  title: string;
  kind: string;
  date: string;
  time: string;
  durationMinutes: string;
  location: string;
  meetingLink: string;
  description: string;
  trainerId: string;
  repeat: boolean;
  weekdays: number[];
  until: string;
}

function ClassDialog({ open, onOpenChange, editing, defaultBatchId }: { open: boolean; onOpenChange: (o: boolean) => void; editing: ClassSessionDto | null; defaultBatchId: string }) {
  const { accountType } = useAuth();
  const batches = useMyBatches();
  const trainers = useTrainers();
  const fields = useFieldErrors();
  const today = todayInZone(getFormatConfig().timeZone);
  const [form, setForm] = useState<Form | null>(null);

  useEffect(() => {
    if (!open) return;
    fields.clear();
    if (editing) {
      const { date, time } = splitInstant(editing.startsAt);
      setForm({ batchId: editing.batchId, title: editing.title, kind: editing.kind, date, time, durationMinutes: String(editing.durationMinutes), location: editing.location ?? '', meetingLink: editing.meetingLink ?? '', description: editing.description ?? '', trainerId: editing.trainerId ?? '', repeat: false, weekdays: [], until: '' });
    } else {
      setForm({ batchId: defaultBatchId, title: '', kind: 'lecture', date: today, time: '10:00', durationMinutes: '60', location: '', meetingLink: '', description: '', trainerId: '', repeat: false, weekdays: [], until: addDays(today, 27) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const save = useAction(
    (f: Form) => {
      const body = {
        title: f.title,
        kind: f.kind,
        startsAt: toInstant(f.date, f.time),
        durationMinutes: Number(f.durationMinutes),
        location: f.location,
        meetingLink: f.meetingLink,
        description: f.description,
        trainerId: f.trainerId || undefined,
      };
      if (editing) return api.put(`/schedule/${editing.id}`, body);
      return api.post<ClassSessionDto[]>('/schedule', { ...body, batchId: f.batchId, ...(f.repeat && { repeat: { weekdays: f.weekdays, until: f.until } }) });
    },
    {
      invalidate: [['schedule']],
      success: (r) => (Array.isArray(r) && r.length > 1 ? `${r.length} classes scheduled` : editing ? 'Class updated' : 'Class scheduled'),
      onDone: () => onOpenChange(false),
      silentErrors: true,
    },
  );

  if (!form) return null;
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const toggleDay = (d: number) => set({ weekdays: form.weekdays.includes(d) ? form.weekdays.filter((x) => x !== d) : [...form.weekdays, d].sort() });
  const batchOptions = (batches.data?.items ?? []).filter((b) => b.status !== 'completed' && b.status !== 'cancelled').map((b) => ({ value: b.id, label: `${b.batchCode} · ${b.name}` }));

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={editing ? 'Edit class' : 'Schedule a class'}
        description={`Times are in ${getFormatConfig().timeZone}.`}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={save.isPending} onClick={() => save.mutate(form, { onError: fields.capture })}>{editing ? 'Save' : 'Schedule'}</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Batch" error={fields.errors.batchId} required className="sm:col-span-2">
            <Select value={form.batchId} disabled={Boolean(editing)} onChange={(e) => set({ batchId: e.target.value })} options={batchOptions} placeholder="Choose a batch" />
          </Field>
          <Field label="Title" error={fields.errors.title} required className="sm:col-span-2">
            <Input value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. SQL joins" maxLength={160} />
          </Field>
          <Field label="Type">
            <Select value={form.kind} onChange={(e) => set({ kind: e.target.value })} options={CLASS_SESSION_KINDS.map((k) => ({ value: k, label: humanize(k) }))} />
          </Field>
          {accountType === 'team' && (
            <Field label="Trainer" hint="Defaults to the batch trainer">
              <Select value={form.trainerId} onChange={(e) => set({ trainerId: e.target.value })} options={(trainers.data ?? []).filter((t) => t.isActive).map((t) => ({ value: t.id, label: t.name }))} placeholder="Batch trainer" />
            </Field>
          )}
          <Field label="Date" error={fields.errors.startsAt} required>
            <Input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
          </Field>
          <Field label="Start time" required>
            <Input type="time" value={form.time} onChange={(e) => set({ time: e.target.value })} />
          </Field>
          <Field label="Duration (minutes)" error={fields.errors.durationMinutes}>
            <Input type="number" min={5} max={720} step={5} value={form.durationMinutes} onChange={(e) => set({ durationMinutes: e.target.value })} />
          </Field>
          <Field label="Room / location">
            <Input value={form.location} onChange={(e) => set({ location: e.target.value })} maxLength={120} />
          </Field>
          <Field label="Online meeting link" error={fields.errors.meetingLink} className="sm:col-span-2">
            <Input value={form.meetingLink} onChange={(e) => set({ meetingLink: e.target.value })} placeholder="https://…" />
          </Field>
          <Field label="Notes for students" className="sm:col-span-2">
            <Textarea rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          {!editing && (
            <div className="space-y-3 rounded-card border p-3 sm:col-span-2">
              <Switch label="Repeat every week" checked={form.repeat} onCheckedChange={(v: boolean) => set({ repeat: v, weekdays: v && form.weekdays.length === 0 ? [new Date(`${form.date}T00:00:00Z`).getUTCDay()] : form.weekdays })} />
              {form.repeat && (
                <>
                  <div className="flex flex-wrap gap-3" role="group" aria-label="Days">
                    {WEEKDAYS.map((d, i) => <Checkbox key={d} label={d} checked={form.weekdays.includes(i)} onCheckedChange={() => toggleDay(i)} />)}
                  </div>
                  <Field label="Until" error={fields.errors.repeat}>
                    <Input type="date" value={form.until} min={form.date} onChange={(e) => set({ until: e.target.value })} />
                  </Field>
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

export function SchedulePage() {
  const { can, accountType } = useAuth();
  const [params, setParams] = useSearchParams();
  const tz = getFormatConfig().timeZone;
  const today = todayInZone(tz);
  const weekFrom = params.get('week') ?? startOfWeek(today);
  const batchId = params.get('batchId') ?? '';
  const trainerId = params.get('trainerId') ?? '';
  const weekTo = addDays(weekFrom, 6);
  const sessions = useSchedule({ from: weekFrom, to: weekTo, batchId: batchId || undefined, trainerId: trainerId || undefined });
  const batches = useMyBatches();
  const trainers = useTrainers();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClassSessionDto | null>(null);
  const [cancelling, setCancelling] = useState<ClassSessionDto | null>(null);
  const canWrite = can('schedule:write');

  const openNew = useCallback(() => {
    setEditing(null);
    setDialogOpen(true);
  }, []);
  useActionParam('new', openNew);

  const setParam = (key: string, value: string) =>
    setParams((c) => {
      const p = new URLSearchParams(c);
      if (value) p.set(key, value);
      else p.delete(key);
      return p;
    });

  const status = useAction(({ id, status: s, cancelReason }: { id: string; status: string; cancelReason?: string }) => api.post(`/schedule/${id}/status`, { status: s, cancelReason }), {
    invalidate: [['schedule']],
    success: 'Class updated',
    onDone: () => setCancelling(null),
  });

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekFrom, i)), [weekFrom]);
  const byDay = (day: string) => (sessions.data ?? []).filter((s) => s.date === day);
  const weekLabel = `${dayLabel(weekFrom)} – ${dayLabel(weekTo)}`;

  return (
    <>
      <PageHeader
        title="Class schedule"
        description={accountType === 'faculty' ? 'Your classes, week by week.' : 'Lectures, practicals and revision sessions for every batch.'}
        actions={canWrite && <Button onClick={openNew}><Plus aria-hidden className="size-4" /> Schedule a class</Button>}
      />
      <Toolbar>
        <div className="flex items-end gap-1">
          <Button variant="secondary" size="icon" aria-label="Previous week" onClick={() => setParam('week', addDays(weekFrom, -7))}><ChevronLeft aria-hidden className="size-4" /></Button>
          <Button variant="secondary" className="h-9" onClick={() => setParam('week', '')}>This week</Button>
          <Button variant="secondary" size="icon" aria-label="Next week" onClick={() => setParam('week', addDays(weekFrom, 7))}><ChevronRight aria-hidden className="size-4" /></Button>
          <span className="ml-2 self-center text-sm font-medium text-fg">{weekLabel}</span>
        </div>
        <FilterSelect label="Batch" value={batchId} onChange={(v) => setParam('batchId', v)} options={(batches.data?.items ?? []).map((b) => ({ value: b.id, label: b.batchCode }))} />
        {accountType === 'team' && <FilterSelect label="Trainer" value={trainerId} onChange={(v) => setParam('trainerId', v)} options={(trainers.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />}
      </Toolbar>

      {sessions.isPending ? (
        <LoadingBlock />
      ) : sessions.isError ? (
        <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />
      ) : (sessions.data ?? []).length === 0 ? (
        <EmptyState icon={CalendarDays} title="No classes this week" description={canWrite ? 'Schedule one, or set a weekly repeat for a whole batch.' : undefined} action={canWrite ? <Button onClick={openNew}>Schedule a class</Button> : undefined} />
      ) : (
        <div className={cn('grid gap-3 md:grid-cols-2 xl:grid-cols-3', sessions.isFetching && 'opacity-70')}>
          {days.map((day) => {
            const list = byDay(day);
            if (list.length === 0) return null;
            return (
              <Card key={day} className="p-4">
                <h2 className={cn('mb-3 text-sm font-semibold', day === today ? 'text-primary' : 'text-fg')}>{dayLabel(day)}{day === today ? ' · today' : ''}</h2>
                <ul className="space-y-2.5">
                  {list.map((s) => (
                    <li key={s.id} className={cn('rounded-xl border p-3', s.status === 'cancelled' && 'opacity-60')}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-fg-subtle tabular-nums">{timeOf(s.startsAt)} – {timeOf(s.endsAt)}</p>
                          <p className={cn('truncate font-medium text-fg', s.status === 'cancelled' && 'line-through')}>{s.title}</p>
                          <p className="truncate text-xs text-fg-muted">{s.batchCode} · {s.trainerName ?? 'No trainer'}</p>
                        </div>
                        {canWrite && s.status !== 'cancelled' && (
                          <Menu>
                            <MenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label={`Actions for ${s.title}`}><MoreHorizontal aria-hidden className="size-4" /></Button>
                            </MenuTrigger>
                            <MenuContent>
                              {s.status === 'scheduled' && <MenuItem icon={<Pencil />} onSelect={() => { setEditing(s); setDialogOpen(true); }}>Edit</MenuItem>}
                              {s.status === 'scheduled' && <MenuItem icon={<CircleCheck />} onSelect={() => status.mutate({ id: s.id, status: 'completed' })}>Mark held</MenuItem>}
                              {s.status === 'completed' && <MenuItem icon={<CircleCheck />} onSelect={() => status.mutate({ id: s.id, status: 'scheduled' })}>Undo "held"</MenuItem>}
                              <MenuItem icon={<CircleX />} tone="danger" onSelect={() => setCancelling(s)}>Cancel class</MenuItem>
                            </MenuContent>
                          </Menu>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge>{humanize(s.kind)}</Badge>
                        <StatusBadge status={s.status} label={s.status === 'completed' ? 'Held' : undefined} />
                        {s.attendanceTaken && <Badge tone="success"><CalendarCheck aria-hidden className="size-3" /> Attendance</Badge>}
                      </div>
                      {s.cancelReason && <p className="mt-1.5 text-xs text-danger">{s.cancelReason}</p>}
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        {s.location && <span className="flex items-center gap-1 text-fg-muted"><MapPin aria-hidden className="size-3" />{s.location}</span>}
                        {s.meetingLink && <a href={s.meetingLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline"><ExternalLink aria-hidden className="size-3" />Join link</a>}
                        {can('attendance:write') && s.status !== 'cancelled' && day <= today && (
                          <Link to={`/attendance?batchId=${s.batchId}&date=${day}&classId=${s.id}`} className="text-primary hover:underline">{s.attendanceTaken ? 'Edit attendance' : 'Take attendance'}</Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      <ClassDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} defaultBatchId={batchId} />
      <ConfirmDialog
        open={Boolean(cancelling)}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={`Cancel "${cancelling?.title}"?`}
        description="Students with a portal login are told, with your reason."
        confirmLabel="Cancel class"
        tone="danger"
        requireReason
        reasonLabel="Reason"
        loading={status.isPending}
        onConfirm={(reason) => cancelling && status.mutate({ id: cancelling.id, status: 'cancelled', cancelReason: reason })}
      />
    </>
  );
}
