import type { ReportDataset } from '@ims/shared';
import { useMutation } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, Mail } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { DataTableView } from '@/components/charts/ChartKit';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { SegmentedItem, SegmentedList } from '@/components/ui/Segmented';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { fetchFile, saveBlob, toQuery } from '@/lib/api';
import { cn } from '@/lib/cn';
import { toastError } from '@/lib/forms';
import { date, humanize, money, number } from '@/utils/format';
import { useReport, useReportParams } from './api';
import { EmailDialog } from './EmailDialog';
import { ReportHistory } from './ReportHistory';
import { Schedules } from './Schedules';
import {
  AgeingCard,
  CashTrendCard,
  CounsellorTable,
  CoursesCard,
  EnquiryTrendCard,
  ExpenseCategoriesCard,
  KpiGrid,
  PlacementCard,
  rangeText,
  ReportFilterBar,
  SourcesCard,
} from './sections';

type Tab = 'report' | 'history' | 'schedules';
const PREVIEW_ROWS = 50;

function RowList<T>({ title, rows, truncated, columns, footer }: { title: string; rows: T[]; truncated: boolean; columns: Parameters<typeof DataTableView<T>>[0]['columns']; footer?: ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, PREVIEW_ROWS);
  return (
    <Card className="overflow-hidden">
      <header className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
        <h3 className="text-sm font-semibold text-fg">{title} <span className="font-normal text-fg-subtle">({number(rows.length)}{truncated ? '+' : ''})</span></h3>
        {rows.length > PREVIEW_ROWS && (
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => setAll((v) => !v)}>
            {all ? `Show first ${PREVIEW_ROWS}` : `Show all ${number(rows.length)}`}
          </button>
        )}
      </header>
      {truncated && <p className="px-5 pt-1 text-xs text-warning">Only the first rows are listed. The totals above cover everything; export to Excel or narrow the period for the full list.</p>}
      <div className="overflow-x-auto px-3 pt-2 pb-3">
        <DataTableView rows={shown} columns={columns} />
      </div>
      {footer && <div className="border-t px-5 py-2 text-sm text-fg-muted">{footer}</div>}
    </Card>
  );
}

function ReportBody({ data, loading, stale }: { data: ReportDataset | undefined; loading: boolean; stale: boolean }) {
  const fin = data?.includesFinance;
  return (
    <div className="space-y-5">
      <KpiGrid data={data} loading={loading} stale={stale} />
      <div className="grid gap-4 xl:grid-cols-2">
        <EnquiryTrendCard data={data} loading={loading} stale={stale} />
        <CashTrendCard data={data} loading={loading} stale={stale} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <SourcesCard data={data} loading={loading} stale={stale} />
        <CoursesCard data={data} loading={loading} stale={stale} />
        <AgeingCard data={data} loading={loading} stale={stale} />
        <ExpenseCategoriesCard data={data} loading={loading} stale={stale} />
        <PlacementCard data={data} loading={loading} stale={stale} />
        {data?.paymentMethods && (
          <Card className="overflow-hidden">
            <header className="px-5 pt-4"><h3 className="text-sm font-semibold text-fg">Receipts by method</h3></header>
            <div className="px-3 pt-2 pb-4">
              <DataTableView rows={data.paymentMethods} columns={[{ key: 'm', label: 'Method', render: (r) => humanize(r.method) }, { key: 'n', label: 'Receipts', align: 'right', render: (r) => number(r.receipts) }, { key: 'a', label: 'Amount', align: 'right', render: (r) => money(r.amountMinor) }]} />
            </div>
          </Card>
        )}
      </div>
      <CounsellorTable data={data} loading={loading} />
      {data && (
        <>
          <RowList
            title="Admissions (excluding cancelled)"
            rows={data.admissionRows}
            truncated={data.truncated.admissions}
            columns={[
              { key: 'n', label: 'Admission', render: (r) => r.admissionNumber },
              { key: 'd', label: 'Date', render: (r) => date(r.admissionDate) },
              { key: 's', label: 'Student', render: (r) => r.studentName },
              { key: 'c', label: 'Course', render: (r) => r.courseName },
              { key: 'src', label: 'Source', render: (r) => r.sourceName ?? '—' },
              { key: 'st', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              ...(fin
                ? [
                    { key: 'f', label: 'Agreed', align: 'right' as const, render: (r: ReportDataset['admissionRows'][number]) => money(r.agreedFeeMinor) },
                    { key: 'p', label: `Net paid by ${date(data.asOf)}`, align: 'right' as const, render: (r: ReportDataset['admissionRows'][number]) => money(r.paidMinor) },
                    { key: 'o', label: 'Owed', align: 'right' as const, render: (r: ReportDataset['admissionRows'][number]) => money(r.outstandingMinor) },
                  ]
                : []),
            ]}
          />
          {data.paymentRows && (
            <RowList
              title="Receipts and refunds"
              rows={data.paymentRows}
              truncated={data.truncated.payments}
              footer={`Net ${money(data.paymentRows.reduce((s, p) => s + p.amountMinor, 0))} · refunds shown negative; reversed receipts excluded`}
              columns={[
                { key: 'r', label: 'Receipt', render: (r) => r.receiptNumber },
                { key: 'd', label: 'Date', render: (r) => date(r.paymentDate) },
                { key: 's', label: 'Student', render: (r) => r.studentName },
                { key: 'c', label: 'Course', render: (r) => r.courseName },
                { key: 'm', label: 'Method', render: (r) => humanize(r.method) },
                { key: 'a', label: 'Amount', align: 'right', render: (r) => <span className={cn(r.amountMinor < 0 && 'text-danger')}>{money(r.amountMinor)}</span> },
              ]}
            />
          )}
          {data.expenseRows && (
            <RowList
              title="Expenses"
              rows={data.expenseRows}
              truncated={data.truncated.expenses}
              footer={`Total ${money(data.expenseRows.reduce((s, e) => s + e.amountMinor, 0))}`}
              columns={[
                { key: 'c', label: 'Expense', render: (r) => r.expenseCode },
                { key: 'd', label: 'Date', render: (r) => date(r.expenseDate) },
                { key: 'cat', label: 'Category', render: (r) => r.categoryName },
                { key: 'desc', label: 'Description', render: (r) => r.description },
                { key: 'a', label: 'Amount', align: 'right', render: (r) => money(r.amountMinor) },
              ]}
            />
          )}
        </>
      )}
    </div>
  );
}

export function ReportsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'report', label: 'Report', show: true },
    { id: 'history', label: 'History', show: can('reports:export') || can('reports:email') },
    { id: 'schedules', label: 'Schedules', show: can('reports:email') },
  ];
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = tabs.find((t) => t.id === requested && t.show)?.id ?? 'report';
  const { values, set, reset, query, ready, isFiltered } = useReportParams('report');
  const report = useReport(query, ready && tab === 'report');
  const data = report.data;
  const [emailOpen, setEmailOpen] = useState(false);

  const exportFile = useMutation({
    mutationFn: (format: 'pdf' | 'excel') => fetchFile(`/reports/export${toQuery({ ...query, format })}`, { fallbackName: `report.${format === 'pdf' ? 'pdf' : 'xlsx'}` }),
    onSuccess: (file) => {
      saveBlob(file);
      toast.success(`Downloaded ${file.fileName}`);
    },
    onError: (e) => toastError(e),
  });

  const setTab = (t: Tab) =>
    setParams((c) => {
      const p = new URLSearchParams(c);
      if (t === 'report') p.delete('tab');
      else p.set('tab', t);
      return p;
    });

  return (
    <>
      <PageHeader
        title="Reports & analytics"
        description={data && tab === 'report' ? `${data.label}: ${rangeText(data.range)} · compared with ${rangeText(data.previous)}` : 'Daily, weekly, monthly, yearly and custom reports, with PDF, Excel and email.'}
        actions={
          tab === 'report' && (
            <div className="flex flex-wrap gap-2">
              {can('reports:export') && (
                <>
                  <Button variant="secondary" disabled={!ready} loading={exportFile.isPending && exportFile.variables === 'pdf'} onClick={() => exportFile.mutate('pdf')}><FileText aria-hidden className="size-4" /> PDF</Button>
                  <Button variant="secondary" disabled={!ready} loading={exportFile.isPending && exportFile.variables === 'excel'} onClick={() => exportFile.mutate('excel')}><FileSpreadsheet aria-hidden className="size-4" /> Excel</Button>
                </>
              )}
              {can('reports:email') && <Button disabled={!ready} onClick={() => setEmailOpen(true)}><Mail aria-hidden className="size-4" /> Email</Button>}
            </div>
          )
        }
      />
      <SegmentedList label="Report views" className="mb-4 flex flex-wrap gap-1 rounded-control border bg-surface p-1">
        {tabs.filter((t) => t.show).map((t) => (
          <SegmentedItem key={t.id} selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</SegmentedItem>
        ))}
      </SegmentedList>

      {tab === 'report' && (
        <div className="space-y-5">
          <ReportFilterBar mode="report" values={values} set={set} reset={reset} isFiltered={isFiltered} />
          {!ready && <p className="text-sm text-fg-muted">Choose a start and an end date (start on or before end) for the custom report.</p>}
          {data && (
            <p className="text-xs text-fg-subtle">
              Balances as of the end of {date(data.asOf)} · dates in {data.timeZone}
              {data.filters.courseName || data.filters.leadSourceName || data.filters.counsellorName ? ` · filtered to ${[data.filters.courseName, data.filters.leadSourceName, data.filters.counsellorName].filter(Boolean).join(' · ')}` : ''}
              {!data.includesFinance ? ' · financial figures need the financial reports permission' : ''}
            </p>
          )}
          {report.isError ? <ErrorState error={report.error} onRetry={() => void report.refetch()} /> : <ReportBody data={data} loading={report.isPending && ready} stale={report.isFetching && !report.isPending} />}
          <EmailDialog open={emailOpen} onOpenChange={setEmailOpen} query={query} label={data ? `${data.label}: ${rangeText(data.range)}` : 'Report'} />
        </div>
      )}
      {tab === 'history' && <ReportHistory />}
      {tab === 'schedules' && <Schedules />}
    </>
  );
}
