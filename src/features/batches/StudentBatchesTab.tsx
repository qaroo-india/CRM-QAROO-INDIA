import type { AdmissionDto, AssignmentDto } from '@ims/shared';
import { GraduationCap } from 'lucide-react';
import { Link } from 'react-router';
import { DataTable, type Column } from '@/components/data/DataTable';
import { EmptyState } from '@/components/ui/Feedback';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { date } from '@/utils/format';
import { useAssignments } from './api';

/** Every batch the student has been in, including transfers, per admission. */
export function StudentBatchesTab({ admissions }: { admissions: AdmissionDto[] }) {
  const assignments = useAssignments(admissions.map((a) => a.id));
  const columns: Column<AssignmentDto>[] = [
    { id: 'batch', header: 'Batch', hideable: false, cell: (a) => <Link to={`/batches/${a.batchId}`} className="font-medium text-primary hover:underline">{a.batchCode} · {a.batchName}</Link> },
    { id: 'admission', header: 'Admission', cell: (a) => <span className="font-mono text-xs text-fg-muted">{a.admissionNumber}</span> },
    { id: 'status', header: 'Status', cell: (a) => <StatusBadge status={a.status} /> },
    { id: 'period', header: 'Period', cell: (a) => <span className="text-fg-muted tabular-nums">{date(a.assignedOn)} – {a.endedOn ? date(a.endedOn) : 'now'}</span> },
    { id: 'reason', header: 'Note', cell: (a) => <span className="text-xs text-fg-muted">{a.reason ?? '—'}</span> },
  ];
  return (
    <div className="space-y-3">
      {admissions.filter((a) => ['pending_payment', 'active'].includes(a.status) && a.batchStatus !== 'assigned').map((a) => (
        <p key={a.id} className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-fg">
          {a.courseName} ({a.admissionNumber}) is waiting for a batch. <Link to={`/batches?tab=queue&courseId=${a.courseId}`} className="font-medium text-primary hover:underline">Open the queue</Link>
        </p>
      ))}
      <DataTable caption="Batch history" columns={columns} rows={assignments.data ?? (admissions.length ? undefined : [])} rowKey={(a) => a.id} loading={assignments.isPending && admissions.length > 0} error={assignments.error} empty={<EmptyState icon={GraduationCap} compact title="Not assigned to any batch yet" />} />
    </div>
  );
}
