import { CERTIFICATE_STATUSES, type AdmissionDto, type CertificateDto } from '@ims/shared';
import { Award, CircleCheck, Download, Eye, MoreHorizontal, Plus, Send, X } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { DataTable, type Column } from '@/components/data/DataTable';
import { Pagination } from '@/components/data/Pagination';
import { FilterSelect, ResetFilters, SearchInput, Toolbar } from '@/components/data/Toolbar';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DialogContent, DialogRoot } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { Textarea } from '@/components/ui/Input';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useListParams } from '@/hooks/useListParams';
import { api, fetchFile, saveBlob } from '@/lib/api';
import { toastError } from '@/lib/forms';
import { date, dateTime, humanize } from '@/utils/format';
import { AdmissionPicker } from '../payments/AdmissionPicker';
import { useAction, useCertificates } from '../campus/api';

export async function downloadCertificate(c: Pick<CertificateDto, 'id' | 'referenceNumber'>, base: '/certificates' | '/portal/certificates') {
  try {
    saveBlob(await fetchFile(`${base}/${c.id}/file`, { fallbackName: `${c.referenceNumber ?? 'certificate'}.pdf` }));
  } catch (error) {
    toastError(error);
  }
}

function IssueForDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [admission, setAdmission] = useState<AdmissionDto | null>(null);
  const [note, setNote] = useState('');
  const create = useAction(() => api.post('/certificates', { admissionId: admission!.id, requestNote: note || undefined }), {
    invalidate: [['certificates']],
    success: 'Certificate request created: review and issue it from the list',
    onDone: () => {
      onOpenChange(false);
      setAdmission(null);
      setNote('');
    },
  });
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Start a certificate"
        description="For a student whose course is completed. You then issue it from the list."
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button disabled={!admission || admission.status !== 'completed'} loading={create.isPending} onClick={() => create.mutate(undefined)}>Create</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Admission" hint="Search by name, phone or admission number">
            <div><AdmissionPicker value={admission} onChange={setAdmission} /></div>
          </Field>
          {admission && admission.status !== 'completed' && <p className="text-sm text-warning">This admission is {humanize(admission.status).toLowerCase()}. Mark it completed first.</p>}
          <Field label="Note (optional)">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

export function CertificatesPage() {
  const { can } = useAuth();
  const list = useListParams(['status'] as const, { sort: { key: 'createdAt', order: 'desc' } });
  const certificates = useCertificates({ ...list.query, sort: undefined });
  const [creating, setCreating] = useState(false);
  const [rejecting, setRejecting] = useState<CertificateDto | null>(null);
  const [issuing, setIssuing] = useState<CertificateDto | null>(null);
  const canIssue = can('certificates:issue');

  const decide = useAction(({ id, status, reviewNote }: { id: string; status: string; reviewNote?: string }) => api.post<CertificateDto>(`/certificates/${id}/decision`, { status, reviewNote }), {
    invalidate: [['certificates']],
    success: (r) => (r.status === 'issued' ? `Issued ${r.referenceNumber}` : `Marked ${humanize(r.status).toLowerCase()}`),
    onDone: () => {
      setRejecting(null);
      setIssuing(null);
    },
  });

  const columns: Column<CertificateDto>[] = [
    { id: 'student', header: 'Student', hideable: false, cell: (c) => <div><p className="font-medium text-fg">{c.studentName}</p><p className="text-xs text-fg-subtle">{c.studentCode} · {c.admissionNumber}</p></div> },
    { id: 'course', header: 'Course', cell: (c) => <span className="text-fg-muted">{c.courseName}</span> },
    { id: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
    { id: 'ref', header: 'Reference', cell: (c) => (c.referenceNumber ? <span className="font-mono text-sm">{c.referenceNumber}</span> : <span className="text-fg-subtle">—</span>) },
    { id: 'requested', header: 'Requested', cell: (c) => <span className="text-fg-muted">{dateTime(c.requestedAt)}</span> },
    { id: 'issued', header: 'Issued', cell: (c) => <span className="text-fg-muted">{c.issuedOn ? date(c.issuedOn) : '—'}</span> },
    { id: 'note', header: 'Notes', defaultHidden: true, cell: (c) => <span className="text-xs text-fg-muted">{[c.requestNote, c.reviewNote].filter(Boolean).join(' · ') || '—'}</span> },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      hideable: false,
      align: 'right',
      cell: (c) => (
        <div className="flex justify-end gap-1">
          {c.status === 'issued' && <Button variant="ghost" size="icon" aria-label={`Download ${c.referenceNumber}`} onClick={() => void downloadCertificate(c, '/certificates')}><Download aria-hidden className="size-4" /></Button>}
          {canIssue && c.status !== 'issued' && c.status !== 'rejected' && (
            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Actions for ${c.studentName}`}><MoreHorizontal aria-hidden className="size-4" /></Button>
              </MenuTrigger>
              <MenuContent>
                {c.status === 'requested' && <MenuItem icon={<Eye />} onSelect={() => decide.mutate({ id: c.id, status: 'under_review' })}>Start review</MenuItem>}
                {(c.status === 'requested' || c.status === 'under_review') && <MenuItem icon={<CircleCheck />} onSelect={() => decide.mutate({ id: c.id, status: 'approved' })}>Approve</MenuItem>}
                <MenuItem icon={<Send />} onSelect={() => setIssuing(c)}>Issue now</MenuItem>
                <MenuItem icon={<X />} tone="danger" onSelect={() => setRejecting(c)}>Reject</MenuItem>
              </MenuContent>
            </Menu>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Certificates"
        description="Completion certificates. Issuing assigns a reference anyone can check at /verify."
        actions={canIssue && <Button onClick={() => setCreating(true)}><Plus aria-hidden className="size-4" /> Start a certificate</Button>}
      />
      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Student, code or reference" />
        <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={CERTIFICATE_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
        <ResetFilters onReset={list.reset} disabled={!list.isFiltered} />
      </Toolbar>
      <DataTable caption="Certificates" columns={columns} rows={certificates.data?.items} rowKey={(c) => c.id} loading={certificates.isPending} fetching={certificates.isFetching} error={certificates.error} empty={<EmptyState icon={Award} title="No certificate requests" description="Students request them from their portal once their course is completed." />} />
      {certificates.data && <Pagination page={certificates.data.page} totalPages={certificates.data.totalPages} total={certificates.data.total} limit={certificates.data.limit} onPageChange={list.setPage} onLimitChange={list.setLimit} />}
      <IssueForDialog open={creating} onOpenChange={setCreating} />
      <ConfirmDialog open={Boolean(issuing)} onOpenChange={(o) => !o && setIssuing(null)} title={`Issue a certificate to ${issuing?.studentName}?`} description={`${issuing?.courseName}. This assigns a permanent reference number and generates the PDF. It cannot be undone.`} confirmLabel="Issue certificate" loading={decide.isPending} onConfirm={() => issuing && decide.mutate({ id: issuing.id, status: 'issued' })} />
      <ConfirmDialog open={Boolean(rejecting)} onOpenChange={(o) => !o && setRejecting(null)} title={`Reject the request from ${rejecting?.studentName}?`} description="The student sees your reason and can request again later." confirmLabel="Reject" tone="danger" requireReason reasonLabel="Reason" loading={decide.isPending} onConfirm={(reason) => rejecting && decide.mutate({ id: rejecting.id, status: 'rejected', reviewNote: reason })} />
    </>
  );
}
