import { PAYMENT_METHODS, TRANSACTION_STATUSES, type PaymentDto } from '@ims/shared';
import { Plus, Receipt, Undo2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { ColumnToggle, DataTable, useColumnVisibility, type Column } from '@/components/data/DataTable';
import { Pagination } from '@/components/data/Pagination';
import { DateFilter, FilterSelect, ResetFilters, SearchInput, Toolbar } from '@/components/data/Toolbar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useListParams } from '@/hooks/useListParams';
import { cn } from '@/lib/cn';
import { date, humanize, money, moneyCompact, number } from '@/utils/format';
import { toOptions, useActionParam, useCourses, useUserOptions } from '../shared/hooks';
import { usePayments } from './api';
import { ReceiptDialog } from './ReceiptDialog';
import { RecordPaymentDialog } from './RecordPaymentDialog';

const FILTERS = ['from', 'to', 'method', 'status', 'direction', 'courseId', 'recordedById'] as const;

export function PaymentsPage() {
  const auth = useAuth();
  const list = useListParams(FILTERS, { sort: { key: 'paymentDate', order: 'desc' } });
  const payments = usePayments(list.query);
  const courses = useCourses();
  const people = useUserOptions();
  const [recording, setRecording] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);

  const openNew = useCallback(() => setRecording(true), []);
  useActionParam('new', openNew);

  const columns: Column<PaymentDto>[] = [
    {
      id: 'receipt',
      header: 'Receipt',
      sortKey: 'receiptNumber',
      hideable: false,
      cell: (p) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-sm text-fg">{p.receiptNumber}</p>
          <p className="truncate text-xs text-fg-subtle">{p.studentName} · {p.admissionNumber}</p>
        </div>
      ),
    },
    { id: 'date', header: 'Date', sortKey: 'paymentDate', cell: (p) => <span className="tabular-nums text-fg-muted">{date(p.paymentDate)}</span> },
    {
      id: 'amount',
      header: 'Amount',
      sortKey: 'amount',
      align: 'right',
      cell: (p) => (
        <span className={cn('font-medium tabular-nums', p.status === 'reversed' ? 'text-fg-subtle line-through' : p.direction === 'refund' ? 'text-danger' : 'text-fg')}>
          {p.direction === 'refund' ? '−' : ''}{money(p.amountMinor)}
        </span>
      ),
    },
    { id: 'method', header: 'Method', cell: (p) => <span className="text-fg-muted">{humanize(p.method)}</span> },
    { id: 'type', header: 'Type', cell: (p) => <span className="text-fg-muted">{humanize(p.paymentType)}</span> },
    { id: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
    { id: 'course', header: 'Course', defaultHidden: true, cell: (p) => <span className="text-fg-muted">{p.courseName}</span> },
    { id: 'reference', header: 'Reference', defaultHidden: true, cell: (p) => <span className="font-mono text-xs text-fg-muted">{p.referenceNumber ?? '—'}</span> },
    { id: 'recordedBy', header: 'Recorded by', cell: (p) => <span className="text-fg-muted">{p.recordedByName ?? '—'}</span> },
  ];
  const visibility = useColumnVisibility('payments', columns);
  const s = payments.data?.summary;

  return (
    <>
      <PageHeader
        title="Fees & payments"
        description="Every receipt, refund and reversal. Totals cover the whole filtered set, counting only succeeded transactions."
        breadcrumbs={[{ label: 'Finance' }, { label: 'Fees & payments' }]}
        actions={auth.can('payments:write') && <Button onClick={openNew}><Plus aria-hidden className="size-4" /> Record payment</Button>}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Gross collections" value={s ? moneyCompact(s.grossMinor) : '—'} icon={Receipt} loading={payments.isPending} stale={payments.isFetching} hint="Succeeded incoming receipts in the filtered period. Excludes reversed receipts." />
        <StatCard label="Refunds" value={s ? moneyCompact(s.refundsMinor) : '—'} icon={Undo2} loading={payments.isPending} stale={payments.isFetching} hint="Money paid back to students, shown separately from collections." />
        <StatCard label="Net collections" value={s ? moneyCompact(s.netMinor) : '—'} loading={payments.isPending} stale={payments.isFetching} hint="Gross collections minus refunds." />
        <StatCard label="Transactions" value={s ? number(s.count) : '—'} loading={payments.isPending} stale={payments.isFetching} hint={s ? `${s.reversedCount} reversed, kept for the audit trail.` : undefined} />
      </div>

      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Receipt, student, phone or reference" />
        <DateFilter label="From" value={list.filters.from} onChange={(v) => list.setFilter('from', v)} max={list.filters.to || undefined} />
        <DateFilter label="To" value={list.filters.to} onChange={(v) => list.setFilter('to', v)} min={list.filters.from || undefined} />
        <FilterSelect label="Method" value={list.filters.method} onChange={(v) => list.setFilter('method', v)} options={PAYMENT_METHODS.map((m) => ({ value: m, label: humanize(m) }))} />
        <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={TRANSACTION_STATUSES.map((m) => ({ value: m, label: humanize(m) }))} />
        <FilterSelect label="Direction" value={list.filters.direction} onChange={(v) => list.setFilter('direction', v)} options={[{ value: 'in', label: 'Receipts' }, { value: 'refund', label: 'Refunds' }]} />
        <FilterSelect label="Course" value={list.filters.courseId} onChange={(v) => list.setFilter('courseId', v)} options={toOptions(courses.data)} />
        <FilterSelect label="Recorded by" value={list.filters.recordedById} onChange={(v) => list.setFilter('recordedById', v)} options={toOptions(people.data)} />
        <ResetFilters onReset={list.reset} disabled={!list.isFiltered} />
        <div className="ml-auto"><ColumnToggle columns={columns} visibility={visibility} /></div>
      </Toolbar>

      <DataTable
        caption="Payments"
        columns={columns}
        visibility={visibility}
        rows={payments.data?.items}
        rowKey={(p) => p.id}
        loading={payments.isPending}
        fetching={payments.isFetching}
        error={payments.error}
        onRetry={() => void payments.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={(p) => setReceiptId(p.id)}
        empty={<EmptyState icon={Receipt} title={list.isFiltered ? 'No transactions match these filters' : 'No payments yet'} />}
      />
      {payments.data && <Pagination page={payments.data.page} totalPages={payments.data.totalPages} total={payments.data.total} limit={payments.data.limit} onPageChange={list.setPage} onLimitChange={list.setLimit} />}

      <RecordPaymentDialog open={recording} onOpenChange={setRecording} onRecorded={(p) => setReceiptId(p.id)} />
      <ReceiptDialog paymentId={receiptId} onOpenChange={(open) => !open && setReceiptId(null)} />
    </>
  );
}
