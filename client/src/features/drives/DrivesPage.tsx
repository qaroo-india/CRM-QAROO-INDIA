import { DRIVE_STATUSES, PROFILE_TRACKS, toMinor, type DriveDto } from '@ims/shared';
import { Building2, CalendarDays, MapPin, Pencil, Plus, Sparkles, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { DataTableView } from '@/components/charts/ChartKit';
import { Pagination } from '@/components/data/Pagination';
import { FilterSelect, ResetFilters, SearchInput, Toolbar } from '@/components/data/Toolbar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DialogContent, DialogRoot, DrawerContent } from '@/components/ui/Dialog';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Checkbox, Switch } from '@/components/ui/Toggle';
import { useListParams } from '@/hooks/useListParams';
import { api, ApiRequestError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { date, humanize, money, number } from '@/utils/format';
import { useCompanies, useProfiles } from '../placements/api';
import { ProfileDrawer } from '../placements/ProfileDrawer';
import { toOptions, useUserOptions } from '../shared/hooks';
import { useAction, useDriveApplicants, useDrives, useFieldErrors, useMyBatches } from '../campus/api';

interface Form {
  companyId: string;
  companyName: string;
  roleTitle: string;
  description: string;
  track: string;
  status: string;
  driveDate: string;
  applyBy: string;
  packageText: string;
  openings: string;
  location: string;
  isRemote: boolean;
  eligibilityNote: string;
  coordinatorId: string;
  batchIds: string[];
}

function DriveDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing: DriveDto | null }) {
  const companies = useCompanies();
  const people = useUserOptions();
  const batches = useMyBatches();
  const fields = useFieldErrors();
  const [form, setForm] = useState<Form | null>(null);

  useEffect(() => {
    if (!open) return;
    fields.clear();
    setForm(
      editing
        ? { companyId: editing.companyId, companyName: '', roleTitle: editing.roleTitle, description: editing.description ?? '', track: editing.track, status: editing.status, driveDate: editing.driveDate, applyBy: editing.applyBy ?? '', packageText: editing.packageMinor === null ? '' : String(editing.packageMinor / 100), openings: String(editing.openings), location: editing.location ?? '', isRemote: editing.isRemote, eligibilityNote: editing.eligibilityNote ?? '', coordinatorId: editing.coordinatorId ?? '', batchIds: editing.batches.map((b) => b.id) }
        : { companyId: '', companyName: '', roleTitle: '', description: '', track: 'technical', status: 'planned', driveDate: '', applyBy: '', packageText: '', openings: '1', location: '', isRemote: false, eligibilityNote: '', coordinatorId: '', batchIds: [] },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const save = useAction(
    (f: Form) => {
      let packageMinor: number | null = null;
      try {
        packageMinor = f.packageText.trim() ? toMinor(f.packageText.replace(/,/g, ''), 'package') : null;
      } catch {
        return Promise.reject(new ApiRequestError(422, 'VALIDATION_ERROR', 'Some fields are invalid', [{ path: 'packageMinor', message: 'Enter an amount like 450000' }]));
      }
      const { packageText: _p, ...rest } = f;
      const body = { ...rest, packageMinor, companyId: f.companyId || undefined, companyName: f.companyId ? undefined : f.companyName, applyBy: f.applyBy || undefined, openings: Number(f.openings), coordinatorId: f.coordinatorId || undefined };
      return editing ? api.put(`/drives/${editing.id}`, body) : api.post('/drives', body);
    },
    { invalidate: [['drives'], ['placements']], success: editing ? 'Drive updated' : 'Drive created', onDone: () => onOpenChange(false), silentErrors: true },
  );

  if (!form) return null;
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const toggleBatch = (id: string) => set({ batchIds: form.batchIds.includes(id) ? form.batchIds.filter((b) => b !== id) : [...form.batchIds, id] });

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={editing ? 'Edit placement drive' : 'New placement drive'}
        description="Opening a drive tells eligible students on their portal."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={save.isPending} onClick={() => save.mutate(form, { onError: fields.capture })}>{editing ? 'Save' : 'Create drive'}</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company" error={fields.errors.companyName}>
            <Select value={form.companyId} onChange={(e) => set({ companyId: e.target.value })} options={(companies.data ?? []).map((c) => ({ value: c.id, label: c.name }))} placeholder="New company…" />
          </Field>
          {!form.companyId && (
            <Field label="New company name" error={fields.errors.companyName} required>
              <Input value={form.companyName} onChange={(e) => set({ companyName: e.target.value })} maxLength={160} />
            </Field>
          )}
          <Field label="Role" error={fields.errors.roleTitle} required className={cn(form.companyId && 'sm:col-span-1')}>
            <Input value={form.roleTitle} onChange={(e) => set({ roleTitle: e.target.value })} placeholder="e.g. Junior Data Analyst" maxLength={160} />
          </Field>
          <Field label="Track">
            <Select value={form.track} onChange={(e) => set({ track: e.target.value })} options={PROFILE_TRACKS.map((t) => ({ value: t, label: humanize(t) }))} />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => set({ status: e.target.value })} options={DRIVE_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
          </Field>
          <Field label="Drive date" error={fields.errors.driveDate} required>
            <Input type="date" value={form.driveDate} onChange={(e) => set({ driveDate: e.target.value })} />
          </Field>
          <Field label="Apply by" error={fields.errors.applyBy}>
            <Input type="date" value={form.applyBy} max={form.driveDate || undefined} onChange={(e) => set({ applyBy: e.target.value })} />
          </Field>
          <Field label="Annual package (CTC)" error={fields.errors.packageMinor}>
            <MoneyInput value={form.packageText} onChange={(e) => set({ packageText: e.target.value })} />
          </Field>
          <Field label="Openings" error={fields.errors.openings}>
            <Input type="number" min={1} value={form.openings} onChange={(e) => set({ openings: e.target.value })} />
          </Field>
          <Field label="Location">
            <Input value={form.location} onChange={(e) => set({ location: e.target.value })} maxLength={120} />
          </Field>
          <div className="flex items-end"><Switch label="Remote role" checked={form.isRemote} onCheckedChange={(v: boolean) => set({ isRemote: v })} /></div>
          <Field label="Coordinator">
            <Select value={form.coordinatorId} onChange={(e) => set({ coordinatorId: e.target.value })} options={toOptions(people.data)} placeholder="No coordinator" />
          </Field>
          <Field label="Eligible batches" hint="None ticked: every student on the track" className="sm:col-span-2">
            <div className="flex max-h-36 flex-wrap gap-3 overflow-y-auto rounded-lg border p-2">
              {(batches.data?.items ?? []).map((b) => <Checkbox key={b.id} label={b.batchCode} checked={form.batchIds.includes(b.id)} onCheckedChange={() => toggleBatch(b.id)} />)}
            </div>
          </Field>
          <Field label="Eligibility" className="sm:col-span-2">
            <Textarea rows={2} value={form.eligibilityNote} onChange={(e) => set({ eligibilityNote: e.target.value })} placeholder="e.g. 60% in the final assessment, no backlogs" />
          </Field>
          <Field label="Job description" className="sm:col-span-2">
            <Textarea rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

function ApplicantsDrawer({ drive, onOpenChange }: { drive: DriveDto | null; onOpenChange: (o: boolean) => void }) {
  const { can } = useAuth();
  const applicants = useDriveApplicants(drive?.id ?? null);
  const profiles = useProfiles({ track: drive?.track, limit: 100 });
  const [picked, setPicked] = useState<string[]>([]);
  const [openProfile, setOpenProfile] = useState<string | null>(null);
  const add = useAction(() => api.post<{ added: number; skipped: { profileId: string; reason: string }[] }>(`/drives/${drive!.id}/applicants`, { profileIds: picked }), {
    invalidate: [['drives'], ['placements']],
    success: (r) => `Added ${r.added}${r.skipped.length ? ` · ${r.skipped.length} not eligible or already in` : ''}`,
    onDone: () => setPicked([]),
  });
  const inDrive = new Set((applicants.data ?? []).map((a) => a.profileId));
  const candidates = (profiles.data?.items ?? []).filter((p) => !inDrive.has(p.id) && !['withdrawn', 'not_seeking', 'joined'].includes(p.stage));

  return (
    <DialogRoot open={Boolean(drive)} onOpenChange={onOpenChange}>
      <DrawerContent title={drive ? `${drive.companyName}: ${drive.roleTitle}` : ''} description={drive ? `${humanize(drive.track)} · drive on ${date(drive.driveDate)}` : undefined} width="lg">
        {applicants.isPending ? (
          <LoadingBlock />
        ) : (
          <div className="space-y-5">
            <section>
              <h3 className="mb-2 text-sm font-semibold text-fg">Applicants ({applicants.data?.length ?? 0})</h3>
              {(applicants.data ?? []).length === 0 ? (
                <p className="text-sm text-fg-subtle">Nobody yet. Students apply from their portal, or add them below.</p>
              ) : (
                <DataTableView
                  rows={applicants.data ?? []}
                  columns={[
                    { key: 's', label: 'Student', render: (a) => <button type="button" className="text-left text-primary hover:underline" onClick={() => setOpenProfile(a.profileId)}>{a.studentName} <span className="text-xs text-fg-subtle">{a.studentCode}</span></button> },
                    { key: 'c', label: 'Course', render: (a) => a.courseName },
                    { key: 'd', label: 'Applied', render: (a) => date(a.appliedOn) },
                    { key: 'i', label: 'Rounds', align: 'right', render: (a) => a.interviews },
                    { key: 'o', label: 'Outcome', render: (a) => <StatusBadge status={a.outcome} /> },
                  ]}
                />
              )}
              <p className="mt-2 text-xs text-fg-subtle">Open a student to record interviews, offers and joining. Those update the placement analytics.</p>
            </section>
            {can('placements:write') && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-fg">Add students</h3>
                {candidates.length === 0 ? (
                  <p className="text-sm text-fg-subtle">No other students on the {humanize(drive?.track ?? '').toLowerCase()} track are available.</p>
                ) : (
                  <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">
                    {candidates.map((p) => (
                      <li key={p.id}>
                        <Checkbox label={`${p.studentName} · ${p.courseName}`} description={humanize(p.stage)} checked={picked.includes(p.id)} onCheckedChange={() => setPicked((list) => (list.includes(p.id) ? list.filter((x) => x !== p.id) : [...list, p.id]))} />
                      </li>
                    ))}
                  </ul>
                )}
                <Button size="sm" disabled={picked.length === 0} loading={add.isPending} onClick={() => add.mutate(undefined)}><UserPlus aria-hidden className="size-4" /> Add {picked.length || ''} to the drive</Button>
              </section>
            )}
          </div>
        )}
        <ProfileDrawer profileId={openProfile} onOpenChange={(o) => !o && setOpenProfile(null)} />
      </DrawerContent>
    </DialogRoot>
  );
}

export function DrivesPage() {
  const { can } = useAuth();
  const list = useListParams(['status', 'track'] as const, { sort: { key: 'driveDate', order: 'desc' } });
  const drives = useDrives({ ...list.query, sort: undefined });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DriveDto | null>(null);
  const [viewing, setViewing] = useState<DriveDto | null>(null);
  const canWrite = can('placements:write');

  return (
    <>
      <PageHeader
        title="Placement drives"
        description="A company hiring for a role, open to chosen batches. Students apply from their portal; only joining counts as placed."
        actions={canWrite && <Button onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus aria-hidden className="size-4" /> New drive</Button>}
      />
      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Company or role" />
        <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={DRIVE_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
        <FilterSelect label="Track" value={list.filters.track} onChange={(v) => list.setFilter('track', v)} options={PROFILE_TRACKS.map((s) => ({ value: s, label: humanize(s) }))} />
        <ResetFilters onReset={list.reset} disabled={!list.isFiltered} />
      </Toolbar>
      {drives.isPending ? (
        <LoadingBlock />
      ) : drives.isError ? (
        <ErrorState error={drives.error} onRetry={() => void drives.refetch()} />
      ) : drives.data.items.length === 0 ? (
        <EmptyState icon={Sparkles} title="No placement drives" description={canWrite ? 'Create one when a company comes to hire.' : undefined} />
      ) : (
        <div className={cn('grid gap-3 md:grid-cols-2 xl:grid-cols-3', drives.isFetching && 'opacity-70')}>
          {drives.data.items.map((d) => (
            <Card key={d.id} className="flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm text-fg-muted"><Building2 aria-hidden className="size-4" />{d.companyName}</p>
                  <p className="truncate text-base font-semibold text-fg">{d.roleTitle}</p>
                </div>
                <StatusBadge status={d.status} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
                <span className="flex items-center gap-1"><CalendarDays aria-hidden className="size-3" />{date(d.driveDate)}{d.applyBy ? ` · apply by ${date(d.applyBy)}` : ''}</span>
                {(d.location || d.isRemote) && <span className="flex items-center gap-1"><MapPin aria-hidden className="size-3" />{[d.location, d.isRemote ? 'Remote' : null].filter(Boolean).join(' · ')}</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge>{humanize(d.track)}</Badge>
                {d.packageMinor !== null && <Badge tone="primary">{money(d.packageMinor, { compactDecimals: true })} / year</Badge>}
                <Badge>{d.openings} opening{d.openings === 1 ? '' : 's'}</Badge>
                {d.batches.length > 0 && <Badge>{d.batches.map((b) => b.batchCode).join(', ')}</Badge>}
              </div>
              <p className="mt-3 text-sm text-fg">{number(d.applicants)} applied · {number(d.offers)} offers · {number(d.joined)} joined</p>
              <div className="mt-auto flex gap-2 pt-3">
                <Button size="sm" variant="secondary" onClick={() => setViewing(d)}><Users aria-hidden className="size-4" /> Applicants</Button>
                {canWrite && <Button size="sm" variant="ghost" onClick={() => { setEditing(d); setDialogOpen(true); }}><Pencil aria-hidden className="size-4" /> Edit</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {drives.data && <Pagination page={drives.data.page} totalPages={drives.data.totalPages} total={drives.data.total} limit={drives.data.limit} onPageChange={list.setPage} onLimitChange={list.setLimit} />}
      <DriveDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
      <ApplicantsDrawer drive={viewing} onOpenChange={(o) => !o && setViewing(null)} />
    </>
  );
}
