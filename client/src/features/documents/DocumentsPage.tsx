import { DOCUMENT_KINDS, DOCUMENT_OWNER_TYPES } from '@ims/shared';
import { FileStack, Upload } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Pagination } from '@/components/data/Pagination';
import { FilterSelect, ResetFilters, SearchInput, Toolbar } from '@/components/data/Toolbar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { useListParams } from '@/hooks/useListParams';
import { humanize } from '@/utils/format';
import { useDocuments } from './api';
import { DocumentTable } from './DocumentTable';
import { UploadDialog } from './UploadDialog';

export function DocumentsPage() {
  const { can } = useAuth();
  const list = useListParams(['ownerType', 'kind', 'accessLevel'] as const, { sort: { key: 'createdAt', order: 'desc' } });
  const docs = useDocuments({ ...list.query, sort: undefined });
  const [uploading, setUploading] = useState(false);

  return (
    <>
      <PageHeader
        title="Document center"
        description="Every uploaded file in one place. Restricted documents (loan paperwork, identity proofs) are listed only for staff allowed to see them."
        actions={can('documents:write') && <Button onClick={() => setUploading(true)}><Upload aria-hidden className="size-4" /> Upload</Button>}
      />
      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Title, file name or type" />
        <FilterSelect label="Belongs to" value={list.filters.ownerType} onChange={(v) => list.setFilter('ownerType', v)} options={DOCUMENT_OWNER_TYPES.map((t) => ({ value: t, label: humanize(t) }))} />
        <FilterSelect label="Type" value={list.filters.kind} onChange={(v) => list.setFilter('kind', v)} options={DOCUMENT_KINDS.map((k) => ({ value: k, label: k }))} />
        {can('documents:restricted') && <FilterSelect label="Access" value={list.filters.accessLevel} onChange={(v) => list.setFilter('accessLevel', v)} options={[{ value: 'general', label: 'General' }, { value: 'restricted', label: 'Restricted' }]} />}
        <ResetFilters onReset={list.reset} disabled={!list.isFiltered} />
      </Toolbar>
      <DocumentTable
        rows={docs.data?.items}
        loading={docs.isPending}
        fetching={docs.isFetching}
        error={docs.error}
        empty={<EmptyState icon={FileStack} title={list.isFiltered ? 'No documents match these filters' : 'No documents yet'} description="Upload admission forms, ID proofs, loan papers, offer letters and receipts." action={can('documents:write') && !list.isFiltered ? <Button onClick={() => setUploading(true)}>Upload a document</Button> : undefined} />}
      />
      {docs.data && <Pagination page={docs.data.page} totalPages={docs.data.totalPages} total={docs.data.total} limit={docs.data.limit} onPageChange={list.setPage} onLimitChange={list.setLimit} />}
      <UploadDialog open={uploading} onOpenChange={setUploading} />
    </>
  );
}
