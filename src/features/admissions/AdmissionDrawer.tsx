import { todayInZone, type AdmissionDto } from '@ims/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Ban, CircleCheck as CheckIcon, LogOut, Play } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { DialogContent, DialogRoot, DrawerContent } from '@/components/ui/Dialog';
import { ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Checkbox } from '@/components/ui/Toggle';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { toastError } from '@/lib/forms';
import { date, getFormatConfig, money } from '@/utils/format';
import { toOptions, useUserOptions } from '../shared/hooks';
import { useAdmission } from '../students/api';
import { AdmissionFinancePanel } from './AdmissionFinancePanel';

type Action = 'activate' | 'complete' | 'withdraw' | 'cancel';

const ACTION_COPY: Record<Action, { title: string; confirm: string; description: string; tone: 'default' | 'danger' }> = {
  activate: { title: 'Activate admission', confirm: 'Activate', description: 'Marks the student as actively enrolled.', tone: 'default' },
  complete: { title: 'Mark course completed', confirm: 'Mark completed', description: 'Ends the enrolment and, for placement courses, makes the student eligible for placement.', tone: 'default' },
  withdraw: { title: 'Withdraw admission', confirm: 'Withdraw', description: 'The student leaves the course. Payments already received stay on record.', tone: 'danger' },
  cancel: { title: 'Cancel admission', confirm: 'Cancel admission', description: 'Use only for admissions entered in error or abandoned before any payment. The fee leaves receivables.', tone: 'danger' },
};

function useStatusMutation(admissionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { action: Action; date: string; reason?: string; writeOffBalance?: boolean }) =>
      api.post<AdmissionDto>(`/admissions/${admissionId}/status`, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(['admissions', 'detail', updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: ['admissions', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['students'] });
      toast.success(`Admission ${updated.status.replace(/_/g, ' ')}`);
    },
    onError: (error) => toastError(error),
  });
}

function StatusActionDialog({ admission, action, onClose }: { admission: AdmissionDto; action: Action | null; onClose: () => void }) {
  const mutation = useStatusMutation(admission.id);
  const [day, setDay] = useState(todayInZone(getFormatConfig().timeZone));
  const [reason, setReason] = useState('');
  const [writeOff, setWriteOff] = useState(false);
  if (!action) return null;
  const copy = ACTION_COPY[action];
  const needsReason = action === 'withdraw' || action === 'cancel';

  return (
    <DialogRoot open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={copy.title}
        description={copy.description}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>Back</Button>
            <Button
              variant={copy.tone === 'danger' ? 'danger' : 'primary'}
              disabled={needsReason && reason.trim().length < 3}
              loading={mutation.isPending}
              onClick={() =>
                mutation.mutate(
                  { action, date: day, reason: reason.trim() || undefined, writeOffBalance: action === 'withdraw' ? writeOff : undefined },
                  { onSuccess: onClose },
                )
              }
            >
              {copy.confirm}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Effective date" required>
            <Input type="date" value={day} min={admission.admissionDate} onChange={(e) => setDay(e.target.value)} />
          </Field>
          {needsReason && (
            <Field label="Reason" required hint="Recorded in the audit history.">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
            </Field>
          )}
          {action === 'withdraw' && admission.outstandingMinor > 0 && (
            <Checkbox
              id="write-off"
              checked={writeOff}
              onCheckedChange={(v) => setWriteOff(v === true)}
              label={`Write off the unpaid ${money(admission.outstandingMinor)}`}
              description="Otherwise the balance stays receivable and continues to show as outstanding."
            />
          )}
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'danger' | 'success' }) {
  return (
    <div className="rounded-xl border bg-surface-sunken p-3">
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className={cn('mt-0.5 text-base font-semibold text-fg', tone === 'danger' && 'text-danger', tone === 'success' && 'text-success')}>{value}</p>
    </div>
  );
}

function AssignmentEditor({ admission }: { admission: AdmissionDto }) {
  const queryClient = useQueryClient();
  const people = useUserOptions();
  const [counsellorId, setCounsellorId] = useState(admission.counsellorId ?? '');
  const [notes, setNotes] = useState(admission.notes ?? '');
  const dirty = counsellorId !== (admission.counsellorId ?? '') || notes !== (admission.notes ?? '');
  const save = useMutation({
    mutationFn: () => api.patch<AdmissionDto>(`/admissions/${admission.id}`, { counsellorId: counsellorId || null, notes: notes || null }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['admissions', 'detail', updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: ['admissions', 'list'] });
      toast.success('Admission updated');
    },
    onError: (error) => toastError(error),
  });
  return (
    <div className="space-y-3">
      <Field label="Counsellor">
        <Select value={counsellorId} onChange={(e) => setCounsellorId(e.target.value)} options={toOptions(people.data)} placeholder="Unassigned" />
      </Field>
      <Field label="Notes">
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
      </Field>
      <Button size="sm" variant="secondary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
    </div>
  );
}

export function AdmissionDrawer({ admissionId, onOpenChange }: { admissionId: string | null; onOpenChange: (open: boolean) => void }) {
  const auth = useAuth();
  const admission = useAdmission(admissionId);
  const [action, setAction] = useState<Action | null>(null);
  const a = admission.data;
  const canWrite = auth.can('admissions:write');

  return (
    <DialogRoot open={!!admissionId} onOpenChange={onOpenChange}>
      <DrawerContent
        title={a ? `${a.admissionNumber} · ${a.studentName}` : 'Admission'}
        description={a ? `${a.courseName} · admitted ${date(a.admissionDate)}` : undefined}
        width="xl"
        footer={
          a && (
            <Link
              to={`/students/${a.studentId}`}
              onClick={() => onOpenChange(false)}
              className="inline-flex h-10 items-center gap-2 rounded-control border border-border-strong bg-surface-raised px-4 text-sm font-medium text-fg transition-colors hover:border-primary/50"
            >
              Student profile <ArrowRight aria-hidden className="size-4" />
            </Link>
          )
        }
      >
        {admission.isPending ? (
          <LoadingBlock />
        ) : admission.isError ? (
          <ErrorState error={admission.error} onRetry={() => void admission.refetch()} />
        ) : a ? (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={a.status} />
              <StatusBadge status={a.batchStatus} label={`Batch: ${a.batchStatus.replace(/_/g, ' ')}`} />
              {a.sourceName ? <span className="text-xs text-fg-subtle">Source: {a.sourceName}</span> : <span className="text-xs text-fg-subtle">Unattributed (no linked enquiry)</span>}
            </div>

            <section aria-label="Balance" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="Agreed fee" value={money(a.agreedFeeMinor)} />
              <Stat label="Net received" value={money(a.netPaidMinor)} tone={a.netPaidMinor > 0 ? 'success' : undefined} />
              <Stat label="Outstanding" value={money(a.outstandingMinor)} tone={a.outstandingMinor > 0 ? 'danger' : undefined} />
              <Stat label="Overdue" value={money(a.overdueMinor)} tone={a.overdueMinor > 0 ? 'danger' : undefined} />
              <Stat label="Adjustments" value={money(a.adjustmentsMinor)} />
              <Stat label="Refunded" value={money(a.refundedMinor)} />
            </section>

            <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
              <dt className="text-fg-subtle">Course fee</dt>
              <dd className="text-fg">{money(a.listFeeMinor)}{a.discountMinor > 0 && <span className="text-fg-muted"> − {money(a.discountMinor)} discount</span>}</dd>
              <dt className="text-fg-subtle">Admission fee due</dt>
              <dd className="text-fg">{money(a.admissionFeeRequiredMinor)}</dd>
              <dt className="text-fg-subtle">Counsellor</dt>
              <dd className="text-fg">{a.counsellorName ?? 'Unassigned'}</dd>
              {a.activatedOn && (<><dt className="text-fg-subtle">Activated</dt><dd className="text-fg">{date(a.activatedOn)}</dd></>)}
              {a.completedOn && (<><dt className="text-fg-subtle">Completed</dt><dd className="text-fg">{date(a.completedOn)}</dd></>)}
              {a.withdrawnOn && (<><dt className="text-fg-subtle">Withdrawn</dt><dd className="text-fg">{date(a.withdrawnOn)}</dd></>)}
              {a.cancelledOn && (<><dt className="text-fg-subtle">Cancelled</dt><dd className="text-fg">{date(a.cancelledOn)}</dd></>)}
              {a.statusReason && (<><dt className="text-fg-subtle">Reason</dt><dd className="text-fg">{a.statusReason}</dd></>)}
            </dl>

            <AdmissionFinancePanel admission={a} />

            {canWrite && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-fg">Lifecycle</h3>
                <div className="flex flex-wrap gap-2">
                  {a.status === 'pending_payment' && (
                    <Button variant="secondary" size="sm" onClick={() => setAction('activate')}><Play aria-hidden className="size-3.5" /> Activate</Button>
                  )}
                  {a.status === 'active' && (
                    <Button variant="secondary" size="sm" onClick={() => setAction('complete')}><CheckIcon aria-hidden className="size-3.5" /> Mark completed</Button>
                  )}
                  {['pending_payment', 'active'].includes(a.status) && (
                    <Button variant="danger" size="sm" onClick={() => setAction('withdraw')}><LogOut aria-hidden className="size-3.5" /> Withdraw</Button>
                  )}
                  {['pending_payment', 'active'].includes(a.status) && auth.can('admissions:cancel') && (
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={a.netPaidMinor > 0}
                      title={a.netPaidMinor > 0 ? 'Money has been received: refund it first, or withdraw instead.' : undefined}
                      onClick={() => setAction('cancel')}
                    >
                      <Ban aria-hidden className="size-3.5" /> Cancel
                    </Button>
                  )}
                </div>
                {a.netPaidMinor > 0 && ['pending_payment', 'active'].includes(a.status) && auth.can('admissions:cancel') && (
                  <p className="text-xs text-fg-subtle">Cancelling is unavailable because money has been received. Refund it first, or withdraw instead.</p>
                )}
              </section>
            )}

            {canWrite && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-fg">Assignment &amp; notes</h3>
                <AssignmentEditor key={a.id} admission={a} />
              </section>
            )}
            <StatusActionDialog admission={a} action={action} onClose={() => setAction(null)} />
          </div>
        ) : null}
      </DrawerContent>
    </DialogRoot>
  );
}
