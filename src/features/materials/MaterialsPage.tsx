import { MATERIAL_KINDS, type MaterialDto } from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff, FileUp, FolderOpen, Link2, MoreHorizontal, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { DataTableView } from '@/components/charts/ChartKit';
import { DataTable, type Column } from '@/components/data/DataTable';
import { Pagination } from '@/components/data/Pagination';
import { FilterSelect, ResetFilters, SearchInput, Toolbar } from '@/components/data/Toolbar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DialogContent, DialogRoot } from '@/components/ui/Dialog';
import { EmptyState, LoadingBlock } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { PageHeader } from '@/components/ui/PageHeader';
import { Switch } from '@/components/ui/Toggle';
import { useListParams } from '@/hooks/useListParams';
import { api, fetchFile, saveBlob, upload } from '@/lib/api';
import { toastError } from '@/lib/forms';
import { date, dateTime, humanize, number } from '@/utils/format';
import { useActionParam } from '../shared/hooks';
import { useAction, useFieldErrors, useMaterials, useMyBatches, useTeachingCourses } from '../campus/api';

const sizeText = (bytes: number | null) => (bytes === null ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** Open a material: download the file, or follow the link in a new tab. */
export async function openMaterial(m: MaterialDto, base: '/materials' | '/portal/materials') {
  try {
    if (m.hasFile) saveBlob(await fetchFile(`${base}/${m.id}/open`, { fallbackName: m.fileName ?? 'material' }));
    else {
      const { url } = await api.get<{ url: string | null }>(`${base}/${m.id}/open`);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    }
  } catch (error) {
    toastError(error);
  }
}

function MaterialDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing: MaterialDto | null }) {
  const { accountType } = useAuth();
  const courses = useTeachingCourses();
  const batches = useMyBatches();
  const fields = useFieldErrors();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ title: '', description: '', kind: 'notes', courseId: '', batchId: '', externalUrl: '', isPublished: true });

  useEffect(() => {
    if (!open) return;
    fields.clear();
    setFile(null);
    setForm(editing ? { title: editing.title, description: editing.description ?? '', kind: editing.kind, courseId: editing.courseId, batchId: editing.batchId ?? '', externalUrl: editing.externalUrl ?? '', isPublished: editing.isPublished } : { title: '', description: '', kind: 'notes', courseId: '', batchId: '', externalUrl: '', isPublished: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const save = useAction(
    () => {
      if (editing) return api.put(`/materials/${editing.id}`, { ...form, batchId: form.batchId || undefined, externalUrl: form.externalUrl || undefined });
      const data = new FormData();
      for (const [k, v] of Object.entries(form)) if (v !== '') data.set(k, String(v));
      if (file) data.set('file', file);
      return upload('/materials', data);
    },
    { invalidate: [['materials']], success: editing ? 'Material updated' : 'Material shared', onDone: () => onOpenChange(false), silentErrors: true },
  );

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const myCourseIds = new Set((batches.data?.items ?? []).map((b) => b.courseId));
  const courseOptions = (courses.data ?? []).filter((c) => accountType === 'team' || myCourseIds.has(c.id)).map((c) => ({ value: c.id, label: c.name }));
  const batchOptions = (batches.data?.items ?? []).filter((b) => b.courseId === form.courseId).map((b) => ({ value: b.id, label: `${b.batchCode} · ${b.name}` }));

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={editing ? 'Edit material' : 'Share study material'}
        description="Students see published material for their course, or for their batch only."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={save.isPending} onClick={() => save.mutate(undefined, { onError: fields.capture })}>{editing ? 'Save' : 'Share'}</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" error={fields.errors.title} required className="sm:col-span-2">
            <Input value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={160} />
          </Field>
          <Field label="Type">
            <Select value={form.kind} onChange={(e) => set({ kind: e.target.value })} options={MATERIAL_KINDS.map((k) => ({ value: k, label: humanize(k) }))} />
          </Field>
          <Field label="Course" error={fields.errors.courseId} required>
            <Select value={form.courseId} onChange={(e) => set({ courseId: e.target.value, batchId: '' })} options={courseOptions} placeholder="Choose a course" />
          </Field>
          <Field label="Only for one batch (optional)" error={fields.errors.batchId} className="sm:col-span-2">
            <Select value={form.batchId} disabled={!form.courseId} onChange={(e) => set({ batchId: e.target.value })} options={batchOptions} placeholder="Every batch of the course" />
          </Field>
          {!editing && (
            <Field label="File" error={fields.errors.file} hint="PDF, slides, Word, Excel, images, ZIP of source code · or give a link below" className="sm:col-span-2">
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}><FileUp aria-hidden className="size-4" /> {file ? 'Choose another' : 'Choose a file'}</Button>
                <span className="truncate text-sm text-fg-muted">{file ? `${file.name} · ${sizeText(file.size)}` : 'No file chosen'}</span>
                <input ref={fileRef} type="file" className="sr-only" aria-label="File" accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.webp,.zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
            </Field>
          )}
          <Field label="Link (video, website)" error={fields.errors.externalUrl} className="sm:col-span-2">
            <Input value={form.externalUrl} onChange={(e) => set({ externalUrl: e.target.value })} placeholder="https://…" />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Textarea rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <Switch label="Published (visible to students)" checked={form.isPublished} onCheckedChange={(v: boolean) => set({ isPublished: v })} />
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

function OpensDialog({ material, onOpenChange }: { material: MaterialDto | null; onOpenChange: (o: boolean) => void }) {
  const opens = useQuery({ queryKey: ['materials', 'opens', material?.id], queryFn: () => api.get<{ name: string; accountType: string; accessedAt: string }[]>(`/materials/${material!.id}/opens`), enabled: Boolean(material) });
  return (
    <DialogRoot open={Boolean(material)} onOpenChange={onOpenChange}>
      <DialogContent title="Who opened it" description={material?.title}>
        {opens.isPending ? <LoadingBlock /> : (opens.data ?? []).length === 0 ? <p className="py-6 text-center text-sm text-fg-subtle">Nobody has opened it yet.</p> : <DataTableView rows={opens.data ?? []} columns={[{ key: 'n', label: 'Name', render: (r) => r.name }, { key: 't', label: '', render: (r) => <Badge>{humanize(r.accountType)}</Badge> }, { key: 'a', label: 'When', render: (r) => dateTime(r.accessedAt) }]} />}
      </DialogContent>
    </DialogRoot>
  );
}

export function MaterialsPage() {
  const { can } = useAuth();
  const list = useListParams(['courseId', 'batchId', 'kind'] as const, { sort: { key: 'createdAt', order: 'desc' } });
  const materials = useMaterials({ ...list.query, sort: undefined });
  const courses = useTeachingCourses();
  const batches = useMyBatches();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MaterialDto | null>(null);
  const [removing, setRemoving] = useState<MaterialDto | null>(null);
  const [opensFor, setOpensFor] = useState<MaterialDto | null>(null);
  const canWrite = can('materials:write');
  const openNew = useCallback(() => {
    setEditing(null);
    setDialogOpen(true);
  }, []);
  useActionParam('new', openNew);

  const toggle = useAction((m: MaterialDto) => api.put(`/materials/${m.id}`, { title: m.title, description: m.description ?? undefined, kind: m.kind, courseId: m.courseId, batchId: m.batchId ?? undefined, externalUrl: m.externalUrl ?? undefined, isPublished: !m.isPublished }), { invalidate: [['materials']], success: 'Visibility updated' });
  const remove = useAction((id: string) => api.delete(`/materials/${id}`), { invalidate: [['materials']], success: 'Material removed', onDone: () => setRemoving(null) });

  const columns: Column<MaterialDto>[] = [
    {
      id: 'title',
      header: 'Material',
      hideable: false,
      cell: (m) => (
        <button type="button" className="min-w-0 text-left" onClick={() => void openMaterial(m, '/materials')}>
          <p className="flex items-center gap-1.5 font-medium text-fg hover:text-primary">{m.hasFile ? <FolderOpen aria-hidden className="size-4 text-fg-subtle" /> : <Link2 aria-hidden className="size-4 text-fg-subtle" />}{m.title}</p>
          <p className="truncate text-xs text-fg-subtle">{m.hasFile ? `${m.fileName} · ${sizeText(m.fileSize)}` : m.externalUrl}</p>
        </button>
      ),
    },
    { id: 'for', header: 'For', cell: (m) => <span className="text-fg-muted">{m.batchCode ?? `All of ${m.courseName}`}</span> },
    { id: 'kind', header: 'Type', cell: (m) => <Badge>{humanize(m.kind)}</Badge> },
    { id: 'pub', header: 'Visible', cell: (m) => (m.isPublished ? <Badge tone="success">Published</Badge> : <Badge>Hidden</Badge>) },
    { id: 'opens', header: 'Opens', align: 'right', cell: (m) => <button type="button" className="text-primary hover:underline" onClick={() => setOpensFor(m)}>{number(m.opens ?? 0)}</button> },
    { id: 'when', header: 'Shared', cell: (m) => <span className="text-fg-muted">{date(m.createdAt.slice(0, 10))}{m.uploadedByName ? ` · ${m.uploadedByName}` : ''}</span> },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      hideable: false,
      align: 'right',
      cell: (m) =>
        canWrite ? (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${m.title}`}><MoreHorizontal aria-hidden className="size-4" /></Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem icon={<Pencil />} onSelect={() => { setEditing(m); setDialogOpen(true); }}>Edit</MenuItem>
              <MenuItem icon={m.isPublished ? <EyeOff /> : <Eye />} onSelect={() => toggle.mutate(m)}>{m.isPublished ? 'Hide from students' : 'Publish'}</MenuItem>
              <MenuItem icon={<Users />} onSelect={() => setOpensFor(m)}>Who opened it</MenuItem>
              <MenuItem icon={<Trash2 />} tone="danger" onSelect={() => setRemoving(m)}>Remove</MenuItem>
            </MenuContent>
          </Menu>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader title="Study material" description="Notes, slides, code and videos for students. Every open is logged." actions={canWrite && <Button onClick={openNew}><Plus aria-hidden className="size-4" /> Share material</Button>} />
      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Title or description" />
        <FilterSelect label="Course" value={list.filters.courseId} onChange={(v) => list.setFilter('courseId', v)} options={(courses.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect label="Batch" value={list.filters.batchId} onChange={(v) => list.setFilter('batchId', v)} options={(batches.data?.items ?? []).map((b) => ({ value: b.id, label: b.batchCode }))} />
        <FilterSelect label="Type" value={list.filters.kind} onChange={(v) => list.setFilter('kind', v)} options={MATERIAL_KINDS.map((k) => ({ value: k, label: humanize(k) }))} />
        <ResetFilters onReset={list.reset} disabled={!list.isFiltered} />
      </Toolbar>
      <DataTable caption="Study material" columns={columns} rows={materials.data?.items} rowKey={(m) => m.id} loading={materials.isPending} fetching={materials.isFetching} error={materials.error} empty={<EmptyState icon={FolderOpen} title="Nothing shared yet" description={canWrite ? 'Upload notes or slides, or add a video link.' : undefined} action={canWrite ? <Button onClick={openNew}>Share material</Button> : undefined} />} />
      {materials.data && <Pagination page={materials.data.page} totalPages={materials.data.totalPages} total={materials.data.total} limit={materials.data.limit} onPageChange={list.setPage} onLimitChange={list.setLimit} />}
      <MaterialDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
      <OpensDialog material={opensFor} onOpenChange={(o) => !o && setOpensFor(null)} />
      <ConfirmDialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)} title={`Remove "${removing?.title}"?`} description="Students will no longer see it. The access history is kept." confirmLabel="Remove" tone="danger" loading={remove.isPending} onConfirm={() => removing && remove.mutate(removing.id)} />
    </>
  );
}
