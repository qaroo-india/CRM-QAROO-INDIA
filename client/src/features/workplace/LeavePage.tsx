import { addDays, diffDays, LEAVE_STATUSES, LEAVE_TYPES, todayInZone, type LeaveDto } from '@ims/shared';
import { Check, PlaneTakeoff, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { DataTable, type Column } from '@/components/data/DataTable';
import { Pagination } from '@/components/data/Pagination';
import { FilterSelect, ResetFilters, Toolbar } from '@/components/data/Toolbar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DialogContent, DialogRoot } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useListParams } from '@/hooks/useListParams';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { date, getFormatConfig, humanize } from '@/utils/format';
import { useAction, useFieldErrors, useLeave, useLeaveToday } from '../campus/api';

function RequestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const today = todayInZone(getFormatConfig().timeZone);
  const fields = useFieldErrors();
  const [form, setForm] = useState({ type: 'casual', startDate: today, endDate: today, reason: '' });
  useEffect(() => {
    if (open) {
      fields.clear();
      setForm({ type: 'casual', startDate: addDays(today, 1), endDate: addDays(today, 1), reason: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const save = useAction(() => api.post('/leave', form), { invalidate: [['leave']], success: 'Leave requested', onDone: () => onOpenChange(false), silentErrors: true });
  const days = form.startDate && form.endDate && form.endDate >= form.startDate ? diffDays(form.startDate, form.endDate) + 1 : 0;
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Request leave"
        description={days ? `${days} calendar day${days === 1 ? '' : 's'}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={save.isPending} onClick={() => save.mutate(undefined, { onError: fields.capture })}>Send request</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" className="sm:col-span-2">
            <Select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} options={LEAVE_TYPES.map((t) => ({ value: t, label: humanize(t) }))} />
          </Field>
          <Field label="From" error={fields.errors.startDate} required>
            <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate }))} />
          </Field>
          <Field label="To" error={fields.errors.endDate} required>
            <Input type="date" value={form.endDate} min={form.startDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
          </Field>
          <Field label="Reason" className="sm:col-span-2">
            <Textarea rows={2} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          </Field>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

export function LeavePage() {
  const { can, user } = useAuth();
  const canApprove = can('leave:approve');
  const list = useListParams(['scope', 'status'] as const, { sort: { key: 'startDate', order: 'desc' } });
  const scope = canApprove && list.filters.scope === 'team' ? 'team' : 'mine';
  const leave = useLeave({ ...list.query, scope, sort: undefined, order: undefined });
  const away = useLeaveToday(canApprove);
  const [open, setOpen] = useState(false);
  const [rejecting, setRejecting] = useState<LeaveDto | null>(null);
  const today = todayInZone(getFormatConfig().timeZone);

  const decide = useAction(({ id, decision, reviewNote }: { id: string; decision: 'approve' | 'reject'; reviewNote?: string }) => api.post(`/leave/${id}/decision`, { decision, reviewNote }), { invalidate: [['leave']], success: 'Decision recorded', onDone: () => setRejecting(null) });
  const cancel = useAction((id: string) => api.post(`/leave/${id}/cancel`), { invalidate: [['leave']], success: 'Leave cancelled' });

  const columns: Column<LeaveDto>[] = [
    ...(scope === 'team' ? [{ id: 'who', header: 'Who', hideable: false, cell: (l: LeaveDto) => <span className="font-medium text-fg">{l.userName}</span> } as Column<LeaveDto>] : []),
    { id: 'type', header: 'Type', cell: (l) => humanize(l.type) },
    { id: 'dates', header: 'Dates', cell: (l) => <span className="tabular-nums">{l.startDate === l.endDate ? date(l.startDate) : `${date(l.startDate)} – ${date(l.endDate)}`} <span className="text-fg-subtle">({l.dayCount}d)</span></span> },
    { id: 'reason', header: 'Reason', cell: (l) => <span className="text-fg-muted">{l.reason ?? '—'}</span> },
    { id: 'status', header: 'Status', cell: (l) => <div><StatusBadge status={l.status} />{l.reviewNote && <p className="text-xs text-fg-subtle">{l.reviewNote}</p>}</div> },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      hideable: false,
      align: 'right',
      cell: (l) => (
        <div className="flex justify-end gap-1">
          {scope === 'team' && l.status === 'pending' && l.userId !== user?.id && (
            <>
              <Button size="sm" variant="secondary" loading={decide.isPending && decide.variables?.id === l.id} onClick={() => decide.mutate({ id: l.id, decision: 'approve' })}><Check aria-hidden className="size-4" /> Approve</Button>
              <Button size="sm" variant="ghost" onClick={() => setRejecting(l)}><X aria-hidden className="size-4" /> Reject</Button>
            </>
          )}
          {scope === 'mine' && (l.status === 'pending' || (l.status === 'approved' && l.startDate > today)) && (
            <Button size="sm" variant="ghost" loading={cancel.isPending && cancel.variables === l.id} onClick={() => cancel.mutate(l.id)}>Cancel</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Leave" description="Request time off; a manager with leave approval decides. Overlapping requests are refused." actions={<Button onClick={() => setOpen(true)}><Plus aria-hidden className="size-4" /> Request leave</Button>} />
      {canApprove && (away.data ?? []).length > 0 && (
        <Card className="mb-4 flex flex-wrap items-center gap-2 p-3 text-sm">
          <PlaneTakeoff aria-hidden className="size-4 text-fg-subtle" />
          <span className="font-medium text-fg">Away today:</span>
          {(away.data ?? []).map((l) => <span key={l.id} className="rounded-full bg-surface-raised px-2 py-0.5 text-fg-muted">{l.userName} · {humanize(l.type)} until {date(l.endDate)}</span>)}
        </Card>
      )}
      <Toolbar>
        {canApprove && (
          <div role="tablist" aria-label="Whose leave" className="flex gap-1 self-end rounded-control border bg-surface p-1">
            {(['mine', 'team'] as const).map((s) => (
              <button key={s} role="tab" type="button" aria-selected={scope === s} onClick={() => list.setFilter('scope', s === 'mine' ? '' : s)} className={cn('rounded-lg px-3 py-1.5 text-sm font-medium transition-colors', scope === s ? 'bg-primary-soft text-primary' : 'text-fg-muted hover:text-fg')}>{s === 'mine' ? 'My leave' : 'Team requests'}</button>
            ))}
          </div>
        )}
        <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={LEAVE_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
        <ResetFilters onReset={list.reset} disabled={!list.isFiltered} />
      </Toolbar>
      <DataTable caption="Leave" columns={columns} rows={leave.data?.items} rowKey={(l) => l.id} loading={leave.isPending} fetching={leave.isFetching} error={leave.error} empty={<EmptyState icon={PlaneTakeoff} title={scope === 'team' ? 'No requests' : 'No leave yet'} />} />
      {leave.data && <Pagination page={leave.data.page} totalPages={leave.data.totalPages} total={leave.data.total} limit={leave.data.limit} onPageChange={list.setPage} onLimitChange={list.setLimit} />}
      <RequestDialog open={open} onOpenChange={setOpen} />
      <ConfirmDialog open={Boolean(rejecting)} onOpenChange={(o) => !o && setRejecting(null)} title={`Reject ${rejecting?.userName}'s leave?`} description="They will see your reason." confirmLabel="Reject" tone="danger" requireReason reasonLabel="Reason" loading={decide.isPending} onConfirm={(reason) => rejecting && decide.mutate({ id: rejecting.id, decision: 'reject', reviewNote: reason })} />
    </>
  );
}
