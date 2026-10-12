import type { DocumentDto } from '@ims/shared';
import { Download, FileStack, Lock, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { DataTable, type Column } from '@/components/data/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/Feedback';
import { date, humanize } from '@/utils/format';
import { useDeleteDocument, useDownloadDocument } from './api';

const sizeText = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

export function DocumentTable({ rows, loading, fetching, error, showOwner = true, empty }: { rows: DocumentDto[] | undefined; loading: boolean; fetching?: boolean; error?: unknown; showOwner?: boolean; empty?: ReactNode }) {
  const { can } = useAuth();
  const download = useDownloadDocument();
  const [removing, setRemoving] = useState<DocumentDto | null>(null);
  const remove = useDeleteDocument(() => setRemoving(null));

  const columns: Column<DocumentDto>[] = [
    {
      id: 'title',
      header: 'Document',
      hideable: false,
      cell: (d) => (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium text-fg">
            {d.accessLevel === 'restricted' && <Lock aria-label="Restricted" className="size-3.5 text-warning" />}
            {d.title}
          </p>
          <p className="truncate text-xs text-fg-subtle">{d.fileName} · {sizeText(d.sizeBytes)}</p>
        </div>
      ),
    },
    { id: 'kind', header: 'Type', cell: (d) => <Badge>{d.kind}</Badge> },
    ...(showOwner ? [{ id: 'owner', header: 'Belongs to', cell: (d: DocumentDto) => <span className="text-fg-muted">{d.ownerLabel ?? humanize(d.ownerType)} <span className="text-xs text-fg-subtle">({humanize(d.ownerType)})</span></span> }] : []),
    { id: 'uploaded', header: 'Uploaded', cell: (d) => <span className="text-fg-muted">{date(d.createdAt.slice(0, 10))}{d.uploadedByName ? ` · ${d.uploadedByName}` : ''}</span> },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      hideable: false,
      align: 'right',
      cell: (d) => (
        <div className="flex justify-end gap-1">
          <Button size="icon" variant="ghost" aria-label={`Download ${d.title}`} loading={download.isPending && download.variables?.id === d.id} onClick={(e) => { e.stopPropagation(); download.mutate(d); }}><Download aria-hidden className="size-4" /></Button>
          {can('documents:write') && <Button size="icon" variant="ghost" aria-label={`Remove ${d.title}`} onClick={(e) => { e.stopPropagation(); setRemoving(d); }}><Trash2 aria-hidden className="size-4" /></Button>}
        </div>
      ),
    },
  ];

  return (
    <>
      <DataTable caption="Documents" columns={columns} rows={rows} rowKey={(d) => d.id} loading={loading} fetching={fetching} error={error} empty={empty ?? <EmptyState icon={FileStack} title="No documents" />} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove "${removing?.title}"?`}
        description="It disappears from lists. The file and its record are kept for the audit trail."
        confirmLabel="Remove"
        tone="danger"
        requireReason
        reasonLabel="Why is it being removed?"
        loading={remove.isPending}
        onConfirm={(reason) => removing && remove.mutate({ id: removing.id, reason })}
      />
    </>
  );
}
