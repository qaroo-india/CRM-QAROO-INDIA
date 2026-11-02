import type { ReportJobDto, ReportScheduleDto } from '@ims/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DialogContent, DialogRoot } from '@/components/ui/Dialog';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Switch } from '@/components/ui/Toggle';
import { api, ApiRequestError } from '@/lib/api';
import { toastError } from '@/lib/forms';
import { dateTime } from '@/utils/format';
import { toOptions, useCourses, useLeadSources, useUserOptions } from '../shared/hooks';
import { useReportSchedules } from './api';
import { EmailTransportNotice, splitEmails } from './EmailDialog';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function describe(s: ReportScheduleDto): string {
  if (s.cadence === 'daily') return `Every day at ${s.timeOfDay} · yesterday's report`;
  if (s.cadence === 'weekly') return `Every ${DAYS[s.dayOfWeek ?? 1]} at ${s.timeOfDay} · last week's report`;
  return `Monthly on day ${s.dayOfMonth} at ${s.timeOfDay} · last month's report`;
}

interface FormState {
  name: string;
  cadence: 'daily' | 'weekly' | 'monthly';
  timeOfDay: string;
  dayOfWeek: string;
  dayOfMonth: string;
  format: 'pdf' | 'excel';
  recipients: string;
  courseId: string;
  leadSourceId: string;
  counsellorId: string;
  isActive: boolean;
}

function ScheduleDialog({ open, onOpenChange, schedule }: { open: boolean; onOpenChange: (o: boolean) => void; schedule: ReportScheduleDto | null }) {
  const { institute } = useAuth();
  const queryClient = useQueryClient();
  const courses = useCourses();
  const sources = useLeadSources();
  const people = useUserOptions();
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(
      schedule
        ? {
            name: schedule.name,
            cadence: schedule.cadence,
            timeOfDay: schedule.timeOfDay,
            dayOfWeek: String(schedule.dayOfWeek ?? 1),
            dayOfMonth: String(schedule.dayOfMonth ?? 1),
            format: schedule.format,
            recipients: schedule.recipients.join(', '),
            courseId: schedule.filters.courseId ?? '',
            leadSourceId: schedule.filters.leadSourceId ?? '',
            counsellorId: schedule.filters.counsellorId ?? '',
            isActive: schedule.isActive,
          }
        : { name: '', cadence: 'daily', timeOfDay: '08:00', dayOfWeek: '1', dayOfMonth: '1', format: 'pdf', recipients: (institute?.reportRecipients ?? []).join(', '), courseId: '', leadSourceId: '', counsellorId: '', isActive: true },
    );
  }, [open, schedule, institute]);

  const save = useMutation({
    mutationFn: (f: FormState) => {
      const body = {
        name: f.name,
        cadence: f.cadence,
        timeOfDay: f.timeOfDay,
        dayOfWeek: f.cadence === 'weekly' ? Number(f.dayOfWeek) : null,
        dayOfMonth: f.cadence === 'monthly' ? Number(f.dayOfMonth) : null,
        format: f.format,
        recipients: splitEmails(f.recipients),
        filters: { courseId: f.courseId || undefined, leadSourceId: f.leadSourceId || undefined, counsellorId: f.counsellorId || undefined },
        isActive: f.isActive,
      };
      return schedule ? api.put(`/reports/schedules/${schedule.id}`, body) : api.post('/reports/schedules', body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reports', 'schedules'] });
      toast.success(schedule ? 'Schedule updated' : 'Schedule created');
      onOpenChange(false);
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.fields?.length) setErrors(Object.fromEntries(error.fields.map((f) => [f.path.split('.')[0]!, f.message])));
      else toastError(error);
    },
  });

  if (!form) return null;
  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={schedule ? 'Edit schedule' : 'Schedule a report'}
        description="Each run emails the previous complete day, week or month."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={save.isPending} onClick={() => save.mutate(form)}>{schedule ? 'Save' : 'Create schedule'}</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <EmailTransportNotice />
          <Field label="Name" error={errors.name} required className="sm:col-span-2">
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Daily admissions & collections" />
          </Field>
          <Field label="Frequency" error={errors.cadence}>
            <Select value={form.cadence} onChange={(e) => set({ cadence: e.target.value as FormState['cadence'] })} options={[{ value: 'daily', label: 'Daily (yesterday)' }, { value: 'weekly', label: 'Weekly (last week)' }, { value: 'monthly', label: 'Monthly (last month)' }]} />
          </Field>
          <Field label="Time" hint={`In ${institute?.timezone ?? 'the institute time zone'}`} error={errors.timeOfDay}>
            <Input type="time" value={form.timeOfDay} onChange={(e) => set({ timeOfDay: e.target.value })} />
          </Field>
          {form.cadence === 'weekly' && (
            <Field label="Day of the week" error={errors.dayOfWeek}>
              <Select value={form.dayOfWeek} onChange={(e) => set({ dayOfWeek: e.target.value })} options={DAYS.map((d, i) => ({ value: String(i), label: d }))} />
            </Field>
          )}
          {form.cadence === 'monthly' && (
            <Field label="Day of the month" hint="1–28, so every month has it" error={errors.dayOfMonth}>
              <Select value={form.dayOfMonth} onChange={(e) => set({ dayOfMonth: e.target.value })} options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} />
            </Field>
          )}
          <Field label="Attach as">
            <Select value={form.format} onChange={(e) => set({ format: e.target.value as FormState['format'] })} options={[{ value: 'pdf', label: 'PDF' }, { value: 'excel', label: 'Excel' }]} />
          </Field>
          <Field label="Recipients" hint="Separate with commas" error={errors.recipients} required className="sm:col-span-2">
            <Textarea rows={2} value={form.recipients} onChange={(e) => set({ recipients: e.target.value })} />
          </Field>
          <Field label="Course (optional)">
            <Select value={form.courseId} onChange={(e) => set({ courseId: e.target.value })} options={toOptions(courses.data)} placeholder="All courses" />
          </Field>
          <Field label="Lead source (optional)">
            <Select value={form.leadSourceId} onChange={(e) => set({ leadSourceId: e.target.value })} options={toOptions(sources.data)} placeholder="All sources" />
          </Field>
          <Field label="Counsellor (optional)">
            <Select value={form.counsellorId} onChange={(e) => set({ counsellorId: e.target.value })} options={toOptions(people.data)} placeholder="All counsellors" />
          </Field>
          <div className="flex items-end">
            <Switch label="Active" checked={form.isActive} onCheckedChange={(v: boolean) => set({ isActive: v })} />
          </div>
          <p className="text-xs text-fg-subtle sm:col-span-2">Financial figures are included only while the person who created the schedule has the financial reports permission.</p>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

export function Schedules() {
  const schedules = useReportSchedules();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ReportScheduleDto | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<ReportScheduleDto | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/reports/schedules/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reports', 'schedules'] });
      toast.success('Schedule deleted. Its past reports stay in History.');
      setDeleting(null);
    },
    onError: (e) => toastError(e),
  });
  const run = useMutation({
    mutationFn: (id: string) => api.post<ReportJobDto | null>(`/reports/schedules/${id}/run`),
    onSuccess: (job) => {
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
      const d = job?.deliveries[0];
      if (!job) toast.error('The report could not be generated. See notifications for details.');
      else if (d?.status === 'sent') toast[d.transport === 'log' ? 'warning' : 'success'](d.transport === 'log' ? 'Generated, but NOT delivered (development email mode)' : `Sent to ${d.recipients.join(', ')}`);
      else toast.error(`Email failed: ${d?.lastError ?? 'unknown error'}`);
    },
    onError: (e) => toastError(e),
  });

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={openNew}><Plus aria-hidden className="size-4" /> New schedule</Button>
      </div>
      {schedules.isPending ? (
        <LoadingBlock />
      ) : schedules.isError ? (
        <ErrorState error={schedules.error} onRetry={() => void schedules.refetch()} />
      ) : schedules.data.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No scheduled reports" description="Send the daily, weekly or monthly report to the owners automatically." action={<Button onClick={openNew}>Create a schedule</Button>} />
      ) : (
        <ul className="space-y-2">
          {schedules.data.map((s) => (
            <li key={s.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-medium text-fg">{s.name} <span className="text-xs text-fg-subtle uppercase">{s.format}</span></p>
                  <p className="text-sm text-fg-muted">{describe(s)}</p>
                  <p className="text-xs text-fg-subtle">To {s.recipients.join(', ')} · next {s.isActive ? dateTime(s.nextRunAt) : '—'}{s.lastRunAt ? ` · last ${dateTime(s.lastRunAt)}` : ''}</p>
                </div>
                <div className="flex items-center gap-1">
                  <StatusBadge status={s.isActive ? 'active' : 'inactive'} />
                  <Button size="sm" variant="ghost" loading={run.isPending && run.variables === s.id} onClick={() => run.mutate(s.id)} title="Send the previous period now"><Play aria-hidden className="size-4" /> Run now</Button>
                  <Button size="icon" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => { setEditing(s); setDialogOpen(true); }}><Pencil aria-hidden className="size-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => setDeleting(s)}><Trash2 aria-hidden className="size-4" /></Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <ScheduleDialog open={dialogOpen} onOpenChange={setDialogOpen} schedule={editing} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        description="It stops sending. Reports it already generated stay in History."
        confirmLabel="Delete schedule"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
