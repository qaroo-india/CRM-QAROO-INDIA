import { BATCH_STATUSES, batchSchema, todayInZone, type BatchDto, type BatchInput, type QueueItem } from '@ims/shared';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { DialogContent, DialogRoot, DrawerContent } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/Toggle';
import { api, ApiRequestError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { handleFormError, useZodForm } from '@/lib/forms';
import { getFormatConfig, humanize } from '@/utils/format';
import { toOptions, useCourses } from '../shared/hooks';
import { useBatchMutation, useTrainers } from './api';

/** Capacity meter: fill carries severity, the words carry the meaning. */
export function CapacityMeter({ enrolled, capacity, className }: { enrolled: number; capacity: number; className?: string }) {
  const ratio = capacity > 0 ? enrolled / capacity : 0;
  const tone = ratio > 1 ? 'bg-danger' : ratio >= 0.9 ? 'bg-warning' : 'bg-primary';
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-fg-muted">{enrolled} / {capacity} seats</span>
        <span className={cn('font-medium', ratio > 1 ? 'text-danger' : ratio >= 0.9 ? 'text-warning' : 'text-fg-subtle')}>
          {ratio > 1 ? `${enrolled - capacity} over capacity` : ratio >= 1 ? 'Full' : `${capacity - enrolled} left`}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken" role="meter" aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={enrolled} aria-label="Seats filled">
        <div className={cn('h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none', tone)} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
    </div>
  );
}

export function BatchFormDrawer({ batch, open, onOpenChange }: { batch: BatchDto | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  // Loaded only when the drawer opens: pages that merely mount it (faculty
  // included, who cannot read the course catalogue) should not fetch it.
  const courses = useCourses(false, open);
  const trainers = useTrainers();
  const defaults = useMemo<BatchInput>(
    () =>
      batch
        ? { batchCode: batch.batchCode, name: batch.name, courseId: batch.courseId, trainerId: batch.trainerId ?? '', startDate: batch.startDate, endDate: batch.endDate ?? '', capacity: batch.capacity, schedule: batch.schedule ?? '', status: batch.status as BatchInput['status'], notes: batch.notes ?? '' }
        : { batchCode: '', name: '', courseId: '', trainerId: '', startDate: todayInZone(getFormatConfig().timeZone), endDate: '', capacity: 25, schedule: '', status: 'planned', notes: '' },
    [batch],
  );
  const form = useZodForm(batchSchema, { defaultValues: defaults });
  useEffect(() => {
    if (open) form.reset(defaults);
  }, [open, defaults, form]);
  const save = useBatchMutation((v: BatchInput) => (batch ? api.put(`/batches/${batch.id}`, v) : api.post('/batches', v)), batch ? 'Batch updated' : 'Batch created');
  const errors = form.formState.errors;

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={batch ? `Edit ${batch.batchCode}` : 'New batch'}
        dismissible={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v as BatchInput, { onSuccess: () => onOpenChange(false), onError: (e) => handleFormError(form, e) }))}>{batch ? 'Save' : 'Create batch'}</Button>
          </>
        }
      >
        <form noValidate className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <Field label="Code" error={errors.batchCode?.message} required><Input className="font-mono uppercase" {...form.register('batchCode')} /></Field>
            <Field label="Name" error={errors.name?.message} required><Input {...form.register('name')} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Course" error={errors.courseId?.message} required><Select placeholder="Select…" options={toOptions(courses.data)} {...form.register('courseId')} /></Field>
            <Field label="Trainer" error={errors.trainerId?.message}><Select placeholder="Not assigned" options={toOptions(trainers.data?.filter((t) => t.isActive))} {...form.register('trainerId')} /></Field>
            <Field label="Starts" error={errors.startDate?.message} required><Input type="date" {...form.register('startDate')} /></Field>
            <Field label="Ends" error={errors.endDate?.message}><Input type="date" {...form.register('endDate')} /></Field>
            <Field label="Capacity" error={errors.capacity?.message} required><Input type="number" min={1} max={1000} {...form.register('capacity')} /></Field>
            <Field label="Status" error={errors.status?.message}><Select options={BATCH_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} {...form.register('status')} /></Field>
          </div>
          <Field label="Schedule" hint="e.g. Mon/Wed/Fri 7-9 PM" error={errors.schedule?.message}><Input {...form.register('schedule')} /></Field>
          <Field label="Notes"><Textarea rows={2} {...form.register('notes')} /></Field>
        </form>
      </DrawerContent>
    </DialogRoot>
  );
}

/** Assign queued students to a batch; offers the owner an audited override when full. */
export function AssignDialog({ batch, items, open, onOpenChange, onDone }: { batch: { id: string; batchCode: string; seatsLeft: number } | null; items: QueueItem[]; open: boolean; onOpenChange: (o: boolean) => void; onDone?: () => void }) {
  const auth = useAuth();
  const [day, setDay] = useState(todayInZone(getFormatConfig().timeZone));
  const [override, setOverride] = useState(false);
  const [fullError, setFullError] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setOverride(false); setFullError(null); }
  }, [open]);
  const assign = useBatchMutation((body: Record<string, unknown>) => api.post('/batch-assignments', body), `Assigned ${items.length} student(s)`);
  if (!batch) return null;
  const over = items.length > batch.seatsLeft;

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Assign to ${batch.batchCode}`}
        description={`${items.length} student(s) · ${batch.seatsLeft} seat(s) left`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              disabled={over && !(auth.isOwner && override)}
              loading={assign.isPending}
              onClick={() =>
                assign.mutate(
                  { batchId: batch.id, admissionIds: items.map((i) => i.admissionId), assignedOn: day, allowOverCapacity: override },
                  {
                    onSuccess: () => { onOpenChange(false); onDone?.(); },
                    onError: (e) => { if (e instanceof ApiRequestError && e.code === 'BATCH_FULL') setFullError(e.message); },
                  },
                )
              }
            >
              Assign
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">{items.map((i) => <li key={i.admissionId} className="text-fg">{i.studentName} <span className="font-mono text-xs text-fg-subtle">{i.admissionNumber}</span></li>)}</ul>
          <Field label="Assigned on"><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
          {(over || fullError) && (
            <div className="space-y-2 rounded-control border border-warning/35 bg-warning-soft p-3 text-sm">
              <p className="flex items-center gap-2 font-medium text-fg"><TriangleAlert aria-hidden className="size-4 text-warning" /> Over capacity</p>
              <p className="text-fg-muted">{fullError ?? `This batch has only ${batch.seatsLeft} seat(s).`}</p>
              {auth.isOwner && <Checkbox id="override" checked={override} onCheckedChange={(v) => setOverride(v === true)} label="Override the capacity limit (recorded in the audit history)" />}
            </div>
          )}
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
