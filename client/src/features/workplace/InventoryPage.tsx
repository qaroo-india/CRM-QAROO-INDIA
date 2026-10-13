import { INVENTORY_CATEGORIES, INVENTORY_ITEM_STATUSES, INVENTORY_REQUEST_STATUSES, type InventoryItemDto, type InventoryRequestDto } from '@ims/shared';
import { Package, PackageCheck, Pencil, Plus, Undo2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { DataTable, type Column } from '@/components/data/DataTable';
import { Pagination } from '@/components/data/Pagination';
import { FilterSelect, ResetFilters, SearchInput, Toolbar } from '@/components/data/Toolbar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DialogContent, DialogRoot } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { PageHeader } from '@/components/ui/PageHeader';
import { SegmentedItem, SegmentedList } from '@/components/ui/Segmented';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Switch } from '@/components/ui/Toggle';
import { useListParams } from '@/hooks/useListParams';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { toMinor } from '@ims/shared';
import { date, dateTime, humanize, money, moneyCompact, number } from '@/utils/format';
import { useAction, useFieldErrors, useInventoryItems, useInventoryRequests } from '../campus/api';

type Tab = 'items' | 'requests' | 'mine';

function ItemDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing: InventoryItemDto | null }) {
  const fields = useFieldErrors();
  const [form, setForm] = useState({ assetTag: '', name: '', category: 'other', description: '', quantityTotal: '1', value: '', isConsumable: false, status: 'in_service', condition: '', location: '', purchasedOn: '', notes: '' });
  useEffect(() => {
    if (!open) return;
    fields.clear();
    setForm(
      editing
        ? { assetTag: editing.assetTag, name: editing.name, category: editing.category, description: editing.description ?? '', quantityTotal: String(editing.quantityTotal), value: String(editing.unitValueMinor / 100), isConsumable: editing.isConsumable, status: editing.status, condition: editing.condition ?? '', location: editing.location ?? '', purchasedOn: editing.purchasedOn ?? '', notes: editing.notes ?? '' }
        : { assetTag: '', name: '', category: 'other', description: '', quantityTotal: '1', value: '', isConsumable: false, status: 'in_service', condition: '', location: '', purchasedOn: '', notes: '' },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);
  const save = useAction(
    () => {
      let unitValueMinor = 0;
      try {
        unitValueMinor = form.value.trim() ? toMinor(form.value.replace(/,/g, ''), 'value') : 0;
      } catch {
        return Promise.reject(new Error('Enter the value as a number, e.g. 45000'));
      }
      const { value: _v, ...rest } = form;
      const body = { ...rest, quantityTotal: Number(form.quantityTotal), unitValueMinor };
      return editing ? api.put(`/inventory/items/${editing.id}`, body) : api.post('/inventory/items', body);
    },
    { invalidate: [['inventory']], success: editing ? 'Item updated' : 'Item added', onDone: () => onOpenChange(false), silentErrors: true },
  );
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={editing ? 'Edit item' : 'Add to the register'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={save.isPending} onClick={() => save.mutate(undefined, { onError: fields.capture })}>{editing ? 'Save' : 'Add'}</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Asset tag" error={fields.errors.assetTag} required>
            <Input value={form.assetTag} onChange={(e) => set({ assetTag: e.target.value.toUpperCase() })} placeholder="LT-001" maxLength={32} />
          </Field>
          <Field label="Name" error={fields.errors.name} required>
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={160} />
          </Field>
          <Field label="Category">
            <Select value={form.category} onChange={(e) => set({ category: e.target.value })} options={INVENTORY_CATEGORIES.map((c) => ({ value: c, label: humanize(c) }))} />
          </Field>
          <Field label="Condition">
            <Select value={form.status} onChange={(e) => set({ status: e.target.value })} options={INVENTORY_ITEM_STATUSES.map((c) => ({ value: c, label: humanize(c) }))} />
          </Field>
          <Field label="Quantity owned" error={fields.errors.quantityTotal}>
            <Input type="number" min={0} value={form.quantityTotal} onChange={(e) => set({ quantityTotal: e.target.value })} />
          </Field>
          <Field label="Value of one" error={fields.errors.unitValueMinor}>
            <MoneyInput value={form.value} onChange={(e) => set({ value: e.target.value })} />
          </Field>
          <div className="flex items-end sm:col-span-2"><Switch label="Consumable (used up, not lent and returned)" checked={form.isConsumable} onCheckedChange={(v: boolean) => set({ isConsumable: v })} /></div>
          <Field label="Location">
            <Input value={form.location} onChange={(e) => set({ location: e.target.value })} placeholder="Lab 2" maxLength={120} />
          </Field>
          <Field label="Purchased on">
            <Input type="date" value={form.purchasedOn} onChange={(e) => set({ purchasedOn: e.target.value })} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

function RequestDialog({ item, onOpenChange }: { item: InventoryItemDto | null; onOpenChange: (o: boolean) => void }) {
  const fields = useFieldErrors();
  const [form, setForm] = useState({ quantity: '1', reason: '', neededBy: '' });
  useEffect(() => {
    if (item) {
      fields.clear();
      setForm({ quantity: '1', reason: '', neededBy: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);
  const save = useAction(() => api.post('/inventory/requests', { itemId: item!.id, quantity: Number(form.quantity), reason: form.reason, neededBy: form.neededBy || undefined }), { invalidate: [['inventory']], success: 'Request sent', onDone: () => onOpenChange(false), silentErrors: true });
  return (
    <DialogRoot open={Boolean(item)} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Request ${item?.name ?? ''}`}
        description={item ? `${item.quantityAvailable} available now` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={save.isPending} onClick={() => save.mutate(undefined, { onError: fields.capture })}>Send request</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="How many" error={fields.errors.quantity}>
            <Input type="number" min={1} value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
          </Field>
          <Field label="Needed by">
            <Input type="date" value={form.neededBy} onChange={(e) => setForm((f) => ({ ...f, neededBy: e.target.value }))} />
          </Field>
          <Field label="What for" className="sm:col-span-2">
            <Textarea rows={2} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          </Field>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

export function InventoryPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const canSeeAll = can('inventory:read');
  const canApprove = can('inventory:approve');
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'items', label: canSeeAll ? 'Register' : 'Available to request', show: true },
    { id: 'requests', label: 'All requests', show: canApprove || canSeeAll },
    { id: 'mine', label: 'My requests', show: true },
  ];
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = tabs.find((t) => t.id === requested && t.show)?.id ?? 'items';
  const list = useListParams(['category', 'status'] as const, { sort: { key: 'name', order: 'asc' } });
  const items = useInventoryItems({ ...list.query, sort: undefined, order: undefined, ...(canSeeAll ? {} : { available: 'true' }) }, tab === 'items');
  // Only the requests tab being shown is fetched ("all" needs inventory access).
  const requests = useInventoryRequests({ scope: tab === 'mine' ? 'mine' : 'all', status: list.filters.status || undefined, page: list.page, limit: list.limit }, tab !== 'items');
  const [itemDialog, setItemDialog] = useState(false);
  const [editing, setEditing] = useState<InventoryItemDto | null>(null);
  const [requesting, setRequesting] = useState<InventoryItemDto | null>(null);
  const [rejecting, setRejecting] = useState<InventoryRequestDto | null>(null);

  const decide = useAction(({ id, action, reviewNote }: { id: string; action: string; reviewNote?: string }) => api.post(`/inventory/requests/${id}/decision`, { action, reviewNote }), { invalidate: [['inventory']], success: 'Updated', onDone: () => setRejecting(null) });
  const setTab = (t: Tab) => setParams((c) => { const p = new URLSearchParams(c); if (t === 'items') p.delete('tab'); else p.set('tab', t); p.delete('status'); return p; });

  const itemColumns: Column<InventoryItemDto>[] = [
    { id: 'name', header: 'Item', hideable: false, cell: (i) => <div><p className="font-medium text-fg">{i.name}</p><p className="font-mono text-xs text-fg-subtle">{i.assetTag}{i.location ? ` · ${i.location}` : ''}</p></div> },
    { id: 'cat', header: 'Category', cell: (i) => <span className="text-fg-muted">{humanize(i.category)}{i.isConsumable ? ' · consumable' : ''}</span> },
    { id: 'qty', header: 'Available', align: 'right', cell: (i) => <span className={cn('tabular-nums', i.quantityAvailable === 0 && 'text-danger')}>{i.quantityAvailable} / {i.quantityTotal}</span> },
    { id: 'lent', header: 'Lent out', align: 'right', cell: (i) => (i.isConsumable ? '—' : number(i.quantityIssued)) },
    ...(canSeeAll ? [{ id: 'value', header: 'Value', align: 'right', cell: (i: InventoryItemDto) => money(i.unitValueMinor * i.quantityTotal, { compactDecimals: true }) } as Column<InventoryItemDto>] : []),
    { id: 'status', header: 'Condition', cell: (i) => <div className="flex items-center gap-1.5"><StatusBadge status={i.status} />{i.pendingRequests > 0 && canApprove && <Badge tone="warning">{i.pendingRequests} pending</Badge>}</div> },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      hideable: false,
      align: 'right',
      cell: (i) => (
        <div className="flex justify-end gap-1">
          {i.status === 'in_service' && <Button size="sm" variant="secondary" onClick={() => setRequesting(i)}>Request</Button>}
          {can('inventory:write') && <Button size="icon" variant="ghost" aria-label={`Edit ${i.name}`} onClick={() => { setEditing(i); setItemDialog(true); }}><Pencil aria-hidden className="size-4" /></Button>}
        </div>
      ),
    },
  ];

  const requestColumns: Column<InventoryRequestDto>[] = [
    { id: 'item', header: 'Item', hideable: false, cell: (r) => <div><p className="font-medium text-fg">{r.quantity} × {r.itemName}</p><p className="font-mono text-xs text-fg-subtle">{r.assetTag}</p></div> },
    ...(tab === 'requests' ? [{ id: 'who', header: 'Requested by', cell: (r: InventoryRequestDto) => r.requestedByName } as Column<InventoryRequestDto>] : []),
    { id: 'when', header: 'Requested', cell: (r) => <span className="text-fg-muted">{dateTime(r.createdAt)}{r.neededBy ? ` · needed ${date(r.neededBy)}` : ''}</span> },
    { id: 'reason', header: 'Reason', cell: (r) => <span className="text-fg-muted">{r.reason ?? '—'}</span> },
    { id: 'status', header: 'Status', cell: (r) => <div><StatusBadge status={r.status} label={r.status === 'returned' && r.isConsumable ? 'Handed out' : undefined} />{r.reviewNote && <p className="text-xs text-fg-subtle">{r.reviewNote}</p>}</div> },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      hideable: false,
      align: 'right',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {canApprove && r.status === 'pending' && (
            <>
              <Button size="sm" variant="secondary" loading={decide.isPending && decide.variables?.id === r.id} onClick={() => decide.mutate({ id: r.id, action: 'issue' })}><PackageCheck aria-hidden className="size-4" /> Issue</Button>
              <Button size="sm" variant="ghost" onClick={() => setRejecting(r)}><X aria-hidden className="size-4" /> Reject</Button>
            </>
          )}
          {canApprove && r.status === 'issued' && <Button size="sm" variant="secondary" onClick={() => decide.mutate({ id: r.id, action: 'return' })}><Undo2 aria-hidden className="size-4" /> Returned</Button>}
          {tab === 'mine' && r.status === 'pending' && <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: r.id, action: 'cancel' })}>Cancel</Button>}
        </div>
      ),
    },
  ];

  const s = items.data?.summary;
  return (
    <>
      <PageHeader title="Inventory & assets" description="Laptops, equipment and supplies: what the institute owns, who has what, and requests." actions={can('inventory:write') && <Button onClick={() => { setEditing(null); setItemDialog(true); }}><Plus aria-hidden className="size-4" /> Add item</Button>} />
      {canSeeAll && tab === 'items' && (
        <div className="stagger mb-4 grid gap-3 sm:grid-cols-3">
          <StatCard label="Items in the register" value={s ? number(s.activeItems) : '—'} icon={Package} loading={items.isPending} />
          <StatCard label="Units lent out" value={s ? number(s.unitsLent) : '—'} icon={PackageCheck} loading={items.isPending} />
          <StatCard label="Book value" value={s ? moneyCompact(s.totalValueMinor) : '—'} icon={Package} loading={items.isPending} hint="Quantity × unit value of items not retired. Purchase value, not depreciated." />
        </div>
      )}
      <SegmentedList label="Inventory views" className="mb-4 inline-flex gap-1 rounded-control border bg-surface p-1">
        {tabs.filter((t) => t.show).map((t) => (
          <SegmentedItem key={t.id} selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</SegmentedItem>
        ))}
      </SegmentedList>
      {tab === 'items' ? (
        <>
          <Toolbar>
            <SearchInput value={list.q} onChange={list.setQ} placeholder="Name, tag or location" />
            <FilterSelect label="Category" value={list.filters.category} onChange={(v) => list.setFilter('category', v)} options={INVENTORY_CATEGORIES.map((c) => ({ value: c, label: humanize(c) }))} />
            {canSeeAll && <FilterSelect label="Condition" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={INVENTORY_ITEM_STATUSES.map((c) => ({ value: c, label: humanize(c) }))} />}
            <ResetFilters onReset={list.reset} disabled={!list.isFiltered} />
          </Toolbar>
          <DataTable caption="Inventory" columns={itemColumns} rows={items.data?.items} rowKey={(i) => i.id} loading={items.isPending} fetching={items.isFetching} error={items.error} empty={<EmptyState icon={Package} title={canSeeAll ? 'The register is empty' : 'Nothing available right now'} />} />
          {items.data && <Pagination page={items.data.page} totalPages={items.data.totalPages} total={items.data.total} limit={items.data.limit} onPageChange={list.setPage} onLimitChange={list.setLimit} />}
        </>
      ) : (
        <>
          <Toolbar>
            <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={INVENTORY_REQUEST_STATUSES.map((c) => ({ value: c, label: humanize(c) }))} />
          </Toolbar>
          <DataTable caption="Requests" columns={requestColumns} rows={requests.data?.items} rowKey={(r) => r.id} loading={requests.isPending} fetching={requests.isFetching} error={requests.error} empty={<EmptyState icon={Package} title="No requests" />} />
          {requests.data && <Pagination page={requests.data.page} totalPages={requests.data.totalPages} total={requests.data.total} limit={requests.data.limit} onPageChange={list.setPage} onLimitChange={list.setLimit} />}
        </>
      )}
      <ItemDialog open={itemDialog} onOpenChange={setItemDialog} editing={editing} />
      <RequestDialog item={requesting} onOpenChange={(o) => !o && setRequesting(null)} />
      <ConfirmDialog open={Boolean(rejecting)} onOpenChange={(o) => !o && setRejecting(null)} title={`Reject ${rejecting?.requestedByName}'s request?`} confirmLabel="Reject" tone="danger" requireReason reasonLabel="Reason" loading={decide.isPending} onConfirm={(reason) => rejecting && decide.mutate({ id: rejecting.id, action: 'reject', reviewNote: reason })} />
    </>
  );
}
