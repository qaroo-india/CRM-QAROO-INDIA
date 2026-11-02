import { todayInZone, type AssignmentDto } from '@ims/shared';
import { ArrowLeft, ArrowRightLeft, Pencil, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { DataTable, type Column } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { DialogContent, DialogRoot } from '@/components/ui/Dialog';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { api } from '@/lib/api';
import { date, getFormatConfig } from '@/utils/format';
import { useBatch, useBatches, useBatchMutation, useQueue } from './api';
import { AssignDialog, BatchFormDrawer, CapacityMeter } from './components';

function TransferDialog({ assignment, courseId, fromBatchId, onClose }: { assignment: AssignmentDto | null; courseId: string; fromBatchId: string; onClose: () => void }) {
  const targets = useBatches({ courseId, status: 'planned,enrolling,running', limit: 100 });
  const [to, setTo] = useState('');
  const [day, setDay] = useState(todayInZone(getFormatConfig().timeZone));
  const [reason, setReason] = useState('');
  const transfer = useBatchMutation(() => api.post(`/batch-assignments/${assignment!.id}/transfer`, { toBatchId: to, date: day, reason }), 'Student transferred');
  if (!assignment) return null;
  return (
    <DialogRoot open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Transfer ${assignment.studentName}`}
        description="The current assignment is closed and kept in history."
        size="sm"
        footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!to || reason.trim().length < 3} loading={transfer.isPending} onClick={() => transfer.mutate(undefined, { onSuccess: onClose })}>Transfer</Button></>}
      >
        <div className="space-y-4">
          <Field label="To batch" required><Select value={to} onChange={(e) => setTo(e.target.value)} placeholder="Choose…" options={(targets.data?.items ?? []).filter((b) => b.id !== fromBatchId).map((b) => ({ value: b.id, label: `${b.batchCode} · ${b.seatsLeft} seats left`, disabled: b.seatsLeft === 0 }))} /></Field>
          <Field label="Effective date" required><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
          <Field label="Reason" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

export function BatchDetailPage() {
  const { id } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const batch = useBatch(id);
  const [editing, setEditing] = useState(false);
  const [transferring, setTransferring] = useState<AssignmentDto | null>(null);
  const [adding, setAdding] = useState(false);
  // The waiting queue is office work: faculty are refused it by the API.
  const queue = useQueue({ courseId: batch.data?.courseId, limit: 100 }, auth.accountType === 'team');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);

  if (batch.isPending) return <LoadingBlock />;
  if (batch.isError) return <ErrorState error={batch.error} onRetry={() => void batch.refetch()} />;
  const b = batch.data;

  const rosterColumns: Column<AssignmentDto>[] = [
    { id: 'student', header: 'Student', hideable: false, cell: (a) => <div><Link to={`/students/${a.studentId}?tab=batches`} className="font-medium text-fg hover:text-primary">{a.studentName}</Link><p className="text-xs text-fg-subtle"><span className="font-mono">{a.admissionNumber}</span> · {a.studentPhone}</p></div> },
    { id: 'since', header: 'Since', cell: (a) => <span className="tabular-nums text-fg-muted">{date(a.assignedOn)}</span> },
    { id: 'note', header: 'Note', cell: (a) => <span className="text-xs text-fg-muted">{a.reason ?? '—'}</span> },
    { id: 'transfer', header: <span className="sr-only">Transfer</span>, hideable: false, align: 'right', cell: (a) => (auth.can('batches:assign') ? <Button size="sm" variant="ghost" onClick={() => setTransferring(a)}><ArrowRightLeft aria-hidden className="size-3.5" /> Transfer</Button> : null) },
  ];
  const historyColumns: Column<AssignmentDto>[] = [
    { id: 'student', header: 'Student', cell: (a) => a.studentName },
    { id: 'status', header: 'Outcome', cell: (a) => <StatusBadge status={a.status} /> },
    { id: 'period', header: 'Period', cell: (a) => <span className="text-fg-muted tabular-nums">{date(a.assignedOn)} – {date(a.endedOn)}</span> },
    { id: 'reason', header: 'Reason', cell: (a) => <span className="text-xs text-fg-muted">{a.reason ?? '—'}</span> },
  ];
  const waiting = (queue.data?.items ?? []).filter((i) => i.courseId === b.courseId);

  return (
    <>
      <PageHeader
        title={b.name}
        breadcrumbs={[{ label: 'Batches', to: '/batches' }, { label: b.batchCode }]}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate(-1)}><ArrowLeft aria-hidden className="size-4" /> Back</Button>
            {auth.can('batches:write') && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil aria-hidden className="size-4" /> Edit</Button>}
            {auth.can('batches:assign') && <Button onClick={() => setAdding(true)}><UserPlus aria-hidden className="size-4" /> Add students</Button>}
          </>
        }
      />
      <Card className="mb-5">
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><p className="text-xs text-fg-subtle">Course</p><p className="text-sm text-fg">{b.courseName}</p></div>
          <div><p className="text-xs text-fg-subtle">Dates</p><p className="text-sm text-fg">{date(b.startDate)} – {b.endDate ? date(b.endDate) : 'open'}</p></div>
          <div><p className="text-xs text-fg-subtle">Trainer · schedule</p><p className="text-sm text-fg">{b.trainerName ?? 'Not assigned'}{b.schedule ? ` · ${b.schedule}` : ''}</p></div>
          <div className="space-y-1"><StatusBadge status={b.status} /><CapacityMeter enrolled={b.enrolled} capacity={b.capacity} /></div>
        </CardContent>
      </Card>

      <h2 className="mb-2 text-sm font-semibold text-fg">Roster ({b.roster.length})</h2>
      <DataTable caption="Roster" columns={rosterColumns} rows={b.roster} rowKey={(a) => a.id} empty={<EmptyState compact title="No students in this batch yet" />} />

      {b.history.length > 0 && (
        <>
          <h2 className="mt-6 mb-2 text-sm font-semibold text-fg">History</h2>
          <DataTable caption="Assignment history" columns={historyColumns} rows={b.history} rowKey={(a) => a.id} />
        </>
      )}

      <BatchFormDrawer batch={b} open={editing} onOpenChange={setEditing} />
      <TransferDialog assignment={transferring} courseId={b.courseId} fromBatchId={b.id} onClose={() => setTransferring(null)} />

      <DialogRoot open={adding} onOpenChange={setAdding}>
        <DialogContent
          title={`Add students to ${b.batchCode}`}
          description={`${waiting.length} student(s) of ${b.courseName} are waiting · ${b.seatsLeft} seat(s) left`}
          size="lg"
          footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button disabled={selected.size === 0} onClick={() => { setAdding(false); setAssignOpen(true); }}>Continue with {selected.size}</Button></>}
        >
          {waiting.length === 0 ? <EmptyState compact title="Nobody is waiting for this course" /> : (
            <ul className="divide-y rounded-control border">
              {waiting.map((i) => (
                <li key={i.admissionId}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-surface-raised">
                    <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={selected.has(i.admissionId)} onChange={() => setSelected((s) => { const n2 = new Set(s); if (n2.has(i.admissionId)) n2.delete(i.admissionId); else n2.add(i.admissionId); return n2; })} />
                    <span className="flex-1 text-sm text-fg">{i.studentName} <span className="font-mono text-xs text-fg-subtle">{i.admissionNumber}</span></span>
                    <span className="text-xs text-fg-subtle">waiting {i.daysWaiting} d</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </DialogRoot>
      <AssignDialog batch={{ id: b.id, batchCode: b.batchCode, seatsLeft: b.seatsLeft }} items={waiting.filter((i) => selected.has(i.admissionId))} open={assignOpen} onOpenChange={setAssignOpen} onDone={() => setSelected(new Set())} />
    </>
  );
}
