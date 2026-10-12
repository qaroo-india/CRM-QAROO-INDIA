import { Landmark } from 'lucide-react';
import { Link } from 'react-router';
import { DataTable, type Column } from '@/components/data/DataTable';
import { EmptyState } from '@/components/ui/Feedback';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { LoanDto } from '@ims/shared';
import { money } from '@/utils/format';
import { useLoans } from '../payments/api';

export function StudentLoansTab({ studentId }: { studentId: string }) {
  const loans = useLoans({ studentId, limit: 50 });
  const columns: Column<LoanDto>[] = [
    { id: 'provider', header: 'Provider', cell: (l) => <Link to={`/loans?loan=${l.id}`} className="font-medium text-primary hover:underline">{l.providerName}</Link> },
    { id: 'admission', header: 'Admission', cell: (l) => <span className="font-mono text-xs text-fg-muted">{l.admissionNumber}</span> },
    { id: 'requested', header: 'Requested', align: 'right', cell: (l) => money(l.requestedMinor) },
    { id: 'approved', header: 'Approved', align: 'right', cell: (l) => (l.approvedMinor === null ? '—' : money(l.approvedMinor)) },
    { id: 'received', header: 'Received', align: 'right', cell: (l) => <span className="font-medium">{money(l.receivedMinor)}</span> },
    { id: 'status', header: 'Status', cell: (l) => <StatusBadge status={l.status} /> },
  ];
  return (
    <DataTable
      columns={columns}
      rows={loans.data?.items}
      rowKey={(l) => l.id}
      loading={loans.isPending}
      error={loans.error}
      empty={<EmptyState icon={Landmark} compact title="No loans or financing" />}
    />
  );
}
