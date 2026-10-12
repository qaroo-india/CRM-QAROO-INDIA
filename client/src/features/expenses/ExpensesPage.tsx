import {
  EXPENSE_APPROVAL_STATUSES,
  PAYMENT_METHODS,
  expenseFormSchema,
  toDecimalString,
  todayInZone,
  type ExpenseDto,
  type ExpenseInput,
  type ExpenseList,
} from '@ims/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, HandCoins, MoreHorizontal, Paperclip, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { BarList } from '@/components/charts/BarList';
import { ColumnToggle, DataTable, useColumnVisibility, type Column } from '@/components/data/DataTable';
import { Pagination } from '@/components/data/Pagination';
import { DateFilter, FilterSelect, ResetFilters, SearchInput, Toolbar } from '@/components/data/Toolbar';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DialogRoot, DrawerContent } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { useDownloadDocument } from '../documents/api';
import { UploadDialog } from '../documents/UploadDialog';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useListParams } from '@/hooks/useListParams';
import { api, toQuery } from '@/lib/api';
import { handleFormError, toastError, useZodForm } from '@/lib/forms';
import { date, getFormatConfig, humanize, money, moneyCompact, number } from '@/utils/format';
import { toOptions, useActionParam, useLookup, useUserOptions } from '../shared/hooks';

const FILTERS = ['from', 'to', 'categoryId', 'status', 'method', 'recordedById', 'includeVoided'] as const;

function ExpenseDrawer({ expense, open, onOpenChange }: { expense: ExpenseDto | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const categories = useLookup('expense-categories');
  const today = todayInZone(getFormatConfig().timeZone);
  const defaults = useMemo(
    () =>
      expense
        ? { expenseDate: expense.expenseDate, categoryId: expense.categoryId, description: expense.description, amountMinor: toDecimalString(expense.amountMinor), paymentMethod: expense.paymentMethod, payee: expense.payee ?? '', referenceNumber: expense.referenceNumber ?? '' }
        : { expenseDate: today, categoryId: '', description: '', amountMinor: '', paymentMethod: 'bank_transfer', payee: '', referenceNumber: '' },
    [expense, today],
  );
  const form = useZodForm(expenseFormSchema, { defaultValues: defaults as never });
  useEffect(() => {
    if (open) form.reset(defaults as never);
  }, [open, defaults, form]);

  const save = useMutation({
    mutationFn: (values: ExpenseInput) => (expense ? api.put<ExpenseDto>(`/expenses/${expense.id}`, values) : api.post<ExpenseDto>('/expenses', values)),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(expense ? 'Expense updated' : `Expense ${saved.expenseCode} recorded${saved.approvalStatus === 'pending' ? ' (awaiting approval)' : ''}`);
      onOpenChange(false);
    },
    onError: (error) => handleFormError(form, error),
  });
  const errors = form.formState.errors;

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={expense ? `Edit ${expense.expenseCode}` : 'Record expense'}
        description="Edits are kept in the audit history; expenses are voided, never deleted."
        dismissible={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v as ExpenseInput))}>{expense ? 'Save' : 'Record expense'}</Button>
          </>
        }
      >
        <form noValidate className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" error={errors.expenseDate?.message} required><Input type="date" max={today} {...form.register('expenseDate')} /></Field>
            <Field label="Category" error={errors.categoryId?.message} required><Select placeholder="Select…" options={toOptions(categories.data)} {...form.register('categoryId')} /></Field>
            <Field label="Amount" error={errors.amountMinor?.message} required><MoneyInput {...form.register('amountMinor')} /></Field>
            <Field label="Paid by" error={errors.paymentMethod?.message} required><Select options={PAYMENT_METHODS.filter((m) => m !== 'finance_disbursement').map((m) => ({ value: m, label: humanize(m) }))} {...form.register('paymentMethod')} /></Field>
            <Field label="Payee / vendor" error={errors.payee?.message}><Input {...form.register('payee')} /></Field>
            <Field label="Reference" error={errors.referenceNumber?.message}><Input {...form.register('referenceNumber')} /></Field>
          </div>
          <Field label="Description" error={errors.description?.message} required><Textarea rows={2} {...form.register('description')} /></Field>
        </form>
      </DrawerContent>
    </DialogRoot>
  );
}

export function ExpensesPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const list = useListParams(FILTERS, { sort: { key: 'expenseDate', order: 'desc' } });
  const expenses = useQuery({ queryKey: ['expenses', list.query], queryFn: () => api.get<ExpenseList>(`/expenses${toQuery(list.query)}`), placeholderData: keepPreviousData });
  const categories = useLookup('expense-categories');
  const people = useUserOptions();
  const [editing, setEditing] = useState<ExpenseDto | null>(null);
  const [open, setOpen] = useState(false);
  const [voiding, setVoiding] = useState<ExpenseDto | null>(null);
  const [rejecting, setRejecting] = useState<ExpenseDto | null>(null);
  const [attaching, setAttaching] = useState<ExpenseDto | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const downloadReceipt = useDownloadDocument();

  const openNew = useCallback(() => { setEditing(null); setOpen(true); }, []);
  useActionParam('new', openNew);

  const act = useMutation({
    mutationFn: ({ id, path, body }: { id: string; path: string; body: unknown }) => api.post<ExpenseDto>(`/expenses/${id}/${path}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      toast.success('Expense updated');
      setVoiding(null);
      setRejecting(null);
    },
    onError: (error) => toastError(error),
  });

  const columns: Column<ExpenseDto>[] = [
    { id: 'description', header: 'Expense', hideable: false, cell: (e) => <div className="min-w-0"><p className={`truncate font-medium ${e.voidedAt ? 'text-fg-subtle line-through' : 'text-fg'}`}>{e.description}</p><p className="truncate text-xs text-fg-subtle"><span className="font-mono">{e.expenseCode}</span>{e.payee ? ` · ${e.payee}` : ''}</p></div> },
    { id: 'date', header: 'Date', sortKey: 'expenseDate', cell: (e) => <span className="tabular-nums text-fg-muted">{date(e.expenseDate)}</span> },
    { id: 'category', header: 'Category', cell: (e) => <span className="text-fg-muted">{e.categoryName}</span> },
    { id: 'amount', header: 'Amount', sortKey: 'amount', align: 'right', cell: (e) => <span className="font-medium tabular-nums">{money(e.amountMinor)}</span> },
    {
      id: 'receipt',
      header: 'Receipt',
      cell: (e) =>
        e.receiptDocumentId ? (
          <Button variant="ghost" size="sm" className="h-7 px-2" aria-label={`Download receipt for ${e.expenseCode}`} loading={downloadReceipt.isPending && downloadReceipt.variables?.id === e.receiptDocumentId} onClick={(ev) => { ev.stopPropagation(); downloadReceipt.mutate({ id: e.receiptDocumentId!, fileName: `${e.expenseCode}-receipt` }); }}>
            <Paperclip aria-hidden className="size-3.5" /> View
          </Button>
        ) : (
          <span className="text-xs text-fg-subtle">None</span>
        ),
    },
    { id: 'method', header: 'Paid by', cell: (e) => <span className="text-fg-muted">{humanize(e.paymentMethod)}</span> },
    { id: 'status', header: 'Status', cell: (e) => (e.voidedAt ? <StatusBadge status="cancelled" label="Void" /> : <StatusBadge status={e.approvalStatus} />) },
    { id: 'recordedBy', header: 'Recorded by', defaultHidden: true, cell: (e) => <span className="text-fg-muted">{e.recordedByName ?? '—'}</span> },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      hideable: false,
      align: 'right',
      cell: (e) =>
        !e.voidedAt && (auth.can('expenses:write') || auth.can('expenses:approve')) ? (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${e.expenseCode}`} onClick={(ev) => ev.stopPropagation()}><MoreHorizontal aria-hidden className="size-4" /></Button>
            </MenuTrigger>
            <MenuContent>
              {auth.can('expenses:write') && <MenuItem icon={<Pencil />} onSelect={() => { setEditing(e); setOpen(true); }}>Edit</MenuItem>}
              {auth.can('documents:write') && <MenuItem icon={<Paperclip />} onSelect={() => { setAttaching(e); setAttachOpen(true); }}>{e.receiptDocumentId ? 'Replace receipt' : 'Attach receipt'}</MenuItem>}
              {e.approvalStatus === 'pending' && auth.can('expenses:approve') && (
                <>
                  <MenuItem icon={<Check />} onSelect={() => act.mutate({ id: e.id, path: 'decision', body: { decision: 'approve' } })}>Approve</MenuItem>
                  <MenuItem icon={<X />} tone="danger" onSelect={() => setRejecting(e)}>Reject</MenuItem>
                </>
              )}
              {auth.can('expenses:write') && <MenuItem icon={<Trash2 />} tone="danger" onSelect={() => setVoiding(e)}>Void</MenuItem>}
            </MenuContent>
          </Menu>
        ) : null,
    },
  ];
  const visibility = useColumnVisibility('expenses', columns);
  const s = expenses.data?.summary;

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Money the institute spent, by date and category. This is cash outflow, not accounting profit or loss."
        breadcrumbs={[{ label: 'Finance' }, { label: 'Expenses' }]}
        actions={auth.can('expenses:write') && <Button onClick={openNew}><Plus aria-hidden className="size-4" /> Record expense</Button>}
      />
      <div className="mb-5 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <StatCard label="Spent in view" value={s ? moneyCompact(s.totalMinor) : '—'} icon={HandCoins} loading={expenses.isPending} stale={expenses.isFetching} hint="Recorded or approved, non-voided expenses matching the filters." />
          <StatCard label="Awaiting approval" value={s ? `${number(s.pendingCount)} · ${moneyCompact(s.pendingMinor)}` : '—'} icon={Clock} loading={expenses.isPending} stale={expenses.isFetching} hint="Not counted in totals until approved." />
        </div>
        <Card>
          <CardHeader><CardTitle>By category</CardTitle></CardHeader>
          <CardContent>
            <BarList items={(s?.byCategory ?? []).map((c) => ({ key: c.categoryId, label: c.categoryName, value: c.totalMinor, display: money(c.totalMinor, { compactDecimals: true }), secondary: `${c.count}` }))} />
          </CardContent>
        </Card>
      </div>
      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Description, payee, code or reference" />
        <DateFilter label="From" value={list.filters.from} onChange={(v) => list.setFilter('from', v)} />
        <DateFilter label="To" value={list.filters.to} onChange={(v) => list.setFilter('to', v)} />
        <FilterSelect label="Category" value={list.filters.categoryId} onChange={(v) => list.setFilter('categoryId', v)} options={toOptions(categories.data)} />
        <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={EXPENSE_APPROVAL_STATUSES.map((s2) => ({ value: s2, label: humanize(s2) }))} />
        <FilterSelect label="Recorded by" value={list.filters.recordedById} onChange={(v) => list.setFilter('recordedById', v)} options={toOptions(people.data)} />
        <FilterSelect label="Voided" value={list.filters.includeVoided} onChange={(v) => list.setFilter('includeVoided', v)} options={[{ value: 'true', label: 'Include voided' }]} allLabel="Hide voided" />
        <ResetFilters onReset={list.reset} disabled={!list.isFiltered} />
        <div className="ml-auto"><ColumnToggle columns={columns} visibility={visibility} /></div>
      </Toolbar>
      <DataTable
        caption="Expenses"
        columns={columns}
        visibility={visibility}
        rows={expenses.data?.items}
        rowKey={(e) => e.id}
        loading={expenses.isPending}
        fetching={expenses.isFetching}
        error={expenses.error}
        onRetry={() => void expenses.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        empty={<EmptyState icon={HandCoins} title={list.isFiltered ? 'No expenses match these filters' : 'No expenses recorded'} />}
      />
      {expenses.data && <Pagination page={expenses.data.page} totalPages={expenses.data.totalPages} total={expenses.data.total} limit={expenses.data.limit} onPageChange={list.setPage} onLimitChange={list.setLimit} />}
      <ExpenseDrawer expense={editing} open={open} onOpenChange={setOpen} />
      <UploadDialog open={attachOpen} onOpenChange={setAttachOpen} owner={attaching ? { ownerType: 'expense', ownerId: attaching.id, label: `${attaching.expenseCode} · ${attaching.description}` } : undefined} defaultKind="Expense receipt" />
      <ConfirmDialog open={!!voiding} onOpenChange={(o) => !o && setVoiding(null)} title={`Void ${voiding?.expenseCode ?? ''}?`} description="It stays on record but leaves every total." tone="danger" confirmLabel="Void" requireReason loading={act.isPending} onConfirm={(reason) => voiding && act.mutate({ id: voiding.id, path: 'void', body: { reason } })} />
      <ConfirmDialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)} title={`Reject ${rejecting?.expenseCode ?? ''}?`} tone="danger" confirmLabel="Reject" requireReason loading={act.isPending} onConfirm={(reason) => rejecting && act.mutate({ id: rejecting.id, path: 'decision', body: { decision: 'reject', reason } })} />
    </>
  );
}
