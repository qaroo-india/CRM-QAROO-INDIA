import type { AuditLogEntry, Paginated, UserOption } from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useState } from 'react';
import { DataTable, type Column } from '@/components/data/DataTable';
import { Pagination } from '@/components/data/Pagination';
import { DateFilter, FilterSelect, ResetFilters, SearchInput, Toolbar } from '@/components/data/Toolbar';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { DialogRoot, DrawerContent } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { useListParams } from '@/hooks/useListParams';
import { api, toQuery } from '@/lib/api';
import { dateTime, humanize } from '@/utils/format';

const ACTION_TONES: Record<string, BadgeTone> = {
  create: 'success',
  update: 'primary',
  status_change: 'primary',
  reverse: 'danger',
  refund: 'warning',
  void: 'danger',
  delete: 'danger',
  approve: 'success',
  reject: 'danger',
  login: 'neutral',
  logout: 'neutral',
  password_change: 'warning',
  export: 'violet',
  email: 'violet',
  import: 'violet',
};

const ENTITY_TYPES = [
  'user', 'settings', 'lead', 'student', 'admission', 'course', 'fee_plan', 'payment', 'fee_adjustment', 'loan',
  'expense', 'batch', 'batch_assignment', 'placement_profile', 'placement_application', 'document', 'report',
  'lead-sources', 'expense-categories', 'job-categories',
];

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function ChangeTable({ entry }: { entry: AuditLogEntry }) {
  const keys = [...new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})])];
  if (keys.length === 0) return <p className="text-sm text-fg-muted">No field-level details were recorded for this event.</p>;
  return (
    <div className="overflow-x-auto rounded-control border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-surface-raised text-left text-xs text-fg-subtle uppercase">
            <th scope="col" className="px-3 py-2 font-medium">Field</th>
            <th scope="col" className="px-3 py-2 font-medium">Before</th>
            <th scope="col" className="px-3 py-2 font-medium">After</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key} className="border-b last:border-b-0 align-top">
              <td className="px-3 py-2 font-medium text-fg">{humanize(key.replace(/([A-Z])/g, '_$1').toLowerCase())}</td>
              <td className="px-3 py-2 font-mono text-xs break-all text-danger">{renderValue(entry.before?.[key])}</td>
              <td className="px-3 py-2 font-mono text-xs break-all text-success">{renderValue(entry.after?.[key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AuditPage() {
  const list = useListParams(['entityType', 'action', 'actorId', 'from', 'to'] as const, { sort: { key: 'occurredAt', order: 'desc' }, limit: 50 });
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

  const logs = useQuery({
    queryKey: ['audit', list.query],
    queryFn: () => api.get<Paginated<AuditLogEntry>>(`/audit${toQuery(list.query)}`),
    placeholderData: (previous) => previous,
  });
  const people = useQuery({ queryKey: ['users', 'options'], queryFn: () => api.get<UserOption[]>('/users/options') });

  const columns: Column<AuditLogEntry>[] = [
    { id: 'when', header: 'When', hideable: false, cell: (e) => <span className="text-sm whitespace-nowrap text-fg-muted tabular-nums">{dateTime(e.occurredAt)}</span> },
    { id: 'who', header: 'Who', cell: (e) => <span className="text-sm">{e.actorName ?? 'System'}</span> },
    { id: 'action', header: 'Action', cell: (e) => <Badge tone={ACTION_TONES[e.action] ?? 'neutral'}>{humanize(e.action)}</Badge> },
    { id: 'summary', header: 'What happened', hideable: false, cell: (e) => <span className="text-sm text-fg">{e.summary}</span> },
    { id: 'entity', header: 'Record type', cell: (e) => <span className="text-xs text-fg-subtle">{humanize(e.entityType.replace(/-/g, '_'))}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Audit history"
        description="Every change to accounts, settings and records -- who did it, when, and exactly what changed."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Audit history' }]}
      />
      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Search descriptions" />
        <FilterSelect label="Record type" value={list.filters.entityType} onChange={(v) => list.setFilter('entityType', v)} options={ENTITY_TYPES.map((t) => ({ value: t, label: humanize(t.replace(/-/g, '_')) }))} />
        <FilterSelect label="Action" value={list.filters.action} onChange={(v) => list.setFilter('action', v)} options={Object.keys(ACTION_TONES).map((a) => ({ value: a, label: humanize(a) }))} />
        <FilterSelect label="Person" value={list.filters.actorId} onChange={(v) => list.setFilter('actorId', v)} options={(people.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />
        <DateFilter label="From" value={list.filters.from} onChange={(v) => list.setFilter('from', v)} max={list.filters.to || undefined} />
        <DateFilter label="To" value={list.filters.to} onChange={(v) => list.setFilter('to', v)} min={list.filters.from || undefined} />
        <ResetFilters onReset={list.reset} disabled={!list.isFiltered} />
      </Toolbar>

      <DataTable
        caption="Audit history"
        columns={columns}
        rows={logs.data?.items}
        rowKey={(e) => e.id}
        loading={logs.isPending}
        fetching={logs.isFetching}
        error={logs.error}
        onRetry={() => void logs.refetch()}
        onRowClick={setSelected}
        empty={<EmptyState icon={History} compact title={list.isFiltered ? 'No changes match these filters' : 'No changes recorded yet'} />}
      />
      {logs.data && (
        <Pagination page={logs.data.page} totalPages={logs.data.totalPages} total={logs.data.total} limit={logs.data.limit} onPageChange={list.setPage} onLimitChange={list.setLimit} />
      )}

      <DialogRoot open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        {selected && (
          <DrawerContent title={selected.summary} description={`${selected.actorName ?? 'System'} · ${dateTime(selected.occurredAt)}`}>
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-fg-subtle">Action</dt>
                  <dd><Badge tone={ACTION_TONES[selected.action] ?? 'neutral'}>{humanize(selected.action)}</Badge></dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-subtle">Record</dt>
                  <dd className="text-fg">{humanize(selected.entityType.replace(/-/g, '_'))}</dd>
                </div>
                {selected.requestId && (
                  <div className="col-span-2">
                    <dt className="text-xs text-fg-subtle">Request ID</dt>
                    <dd className="font-mono text-xs break-all text-fg-muted">{selected.requestId}</dd>
                  </div>
                )}
              </dl>
              <ChangeTable entry={selected} />
            </div>
          </DrawerContent>
        )}
      </DialogRoot>
    </>
  );
}
