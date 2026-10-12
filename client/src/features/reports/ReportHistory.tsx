import type { ReportJobDto } from '@ims/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, FileText, History, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { Pagination } from '@/components/data/Pagination';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { api, fetchFile, saveBlob } from '@/lib/api';
import { toastError } from '@/lib/forms';
import { date, dateTime, humanize } from '@/utils/format';
import { useReportJobs } from './api';
import { EmailTransportNotice } from './EmailDialog';

function describeParams(p: Record<string, unknown>): string {
  const type = typeof p.type === 'string' ? humanize(p.type) : typeof p.period === 'string' ? humanize(p.period) : 'Report';
  if (p.from && p.to) return `${type} · ${date(String(p.from))} – ${date(String(p.to))}`;
  if (p.reference) return `${type} around ${date(String(p.reference))}`;
  return type;
}

const kb = (bytes: number | null) => (bytes === null ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

export function ReportHistory() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const jobs = useReportJobs(page);
  const queryClient = useQueryClient();

  const download = useMutation({
    mutationFn: (job: ReportJobDto) => fetchFile(`/reports/jobs/${job.id}/download`, { fallbackName: job.fileName ?? 'report' }),
    onSuccess: saveBlob,
    onError: (e) => toastError(e),
  });
  const retry = useMutation({
    mutationFn: (deliveryId: string) => api.post<ReportJobDto>(`/reports/deliveries/${deliveryId}/retry`),
    onSuccess: (job, deliveryId) => {
      void queryClient.invalidateQueries({ queryKey: ['reports', 'jobs'] });
      const d = job.deliveries.find((x) => x.id === deliveryId);
      if (d?.status === 'sent') toast.success('Email sent');
      else toast.error(`Still failing: ${d?.lastError ?? 'unknown error'}`);
    },
    onError: (e) => toastError(e),
  });

  if (jobs.isPending) return <LoadingBlock />;
  if (jobs.isError) return <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />;
  if (jobs.data.items.length === 0) return <EmptyState icon={History} title="No reports generated yet" description="Exports, emailed reports and scheduled runs appear here with their delivery status." />;

  return (
    <div className="space-y-3">
      <EmailTransportNotice />
      <ul className="space-y-2">
        {jobs.data.items.map((job) => (
          <li key={job.id}>
            <Card className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border bg-surface-raised text-fg-muted">
                    {job.format === 'pdf' ? <FileText aria-hidden className="size-4" /> : <FileSpreadsheet aria-hidden className="size-4" />}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-fg">{describeParams(job.params)}</p>
                    <p className="text-xs text-fg-subtle">
                      {job.format.toUpperCase()} · {dateTime(job.createdAt)} · {job.scheduleName ? `Schedule "${job.scheduleName}"` : (job.requestedByName ?? 'System')}
                      {job.sizeBytes ? ` · ${kb(job.sizeBytes)}` : ''}
                      {job.params.includeFinance === false ? ' · without financial figures' : ''}
                    </p>
                    {job.error && <p className="mt-1 text-xs text-danger">{job.error}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={job.status} />
                  {job.downloadable && can('reports:export') && (
                    <Button size="sm" variant="secondary" loading={download.isPending && download.variables?.id === job.id} onClick={() => download.mutate(job)}>
                      <Download aria-hidden className="size-4" /> Download
                    </Button>
                  )}
                </div>
              </div>
              {job.deliveries.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t pt-3">
                  {job.deliveries.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 text-fg-muted">
                        To {d.recipients.join(', ')}
                        {d.attempts > 1 && <span className="text-fg-subtle"> · {d.attempts} attempts</span>}
                        {d.sentAt && <span className="text-fg-subtle"> · {dateTime(d.sentAt)}</span>}
                        {d.lastError && <span className="block text-xs text-danger">{d.lastError}</span>}
                      </span>
                      <span className="flex items-center gap-2">
                        {d.transport === 'log' && <Badge tone="warning">Not delivered (dev mode)</Badge>}
                        <StatusBadge status={d.status} />
                        {d.status === 'failed' && can('reports:email') && (
                          <Button size="sm" variant="ghost" loading={retry.isPending && retry.variables === d.id} onClick={() => retry.mutate(d.id)}>
                            <RotateCw aria-hidden className="size-3.5" /> Retry
                          </Button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </li>
        ))}
      </ul>
      <Pagination page={jobs.data.page} totalPages={jobs.data.totalPages} total={jobs.data.total} limit={jobs.data.limit} onPageChange={setPage} />
    </div>
  );
}
