import { REPORT_PERIODS, REPORT_TYPES, type DashboardData, type EmailStatusDto, type Paginated, type ReportDataset, type ReportJobDto, type ReportPeriod, type ReportScheduleDto, type ReportType } from '@ims/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { api, toQuery } from '@/lib/api';

const DIMENSIONS = ['courseId', 'leadSourceId', 'counsellorId'] as const;
type Dimension = (typeof DIMENSIONS)[number];

export interface ReportParams {
  period: ReportPeriod;
  type: ReportType;
  reference: string;
  from: string;
  to: string;
  courseId: string;
  leadSourceId: string;
  counsellorId: string;
}

/**
 * Report filters live in the URL so a view can be bookmarked or shared and
 * the export buttons send exactly what is on screen. `mode` picks the
 * dashboard's rolling periods or the report page's complete periods.
 */
export function useReportParams(mode: 'dashboard' | 'report') {
  const [params, setParams] = useSearchParams();
  const values: ReportParams = useMemo(() => {
    const period = params.get('period') as ReportPeriod | null;
    const type = params.get('type') as ReportType | null;
    return {
      period: period && (REPORT_PERIODS as readonly string[]).includes(period) ? period : 'this_month',
      type: type && (REPORT_TYPES as readonly string[]).includes(type) ? type : 'monthly',
      reference: params.get('reference') ?? '',
      from: params.get('from') ?? '',
      to: params.get('to') ?? '',
      courseId: params.get('courseId') ?? '',
      leadSourceId: params.get('leadSourceId') ?? '',
      counsellorId: params.get('counsellorId') ?? '',
    };
  }, [params]);

  const set = useCallback(
    (changes: Partial<ReportParams>) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const reset = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);

  const isCustom = mode === 'dashboard' ? values.period === 'custom' : values.type === 'custom';
  /** A custom range is only sent once both ends are chosen. */
  const ready = !isCustom || (Boolean(values.from && values.to) && values.from <= values.to);
  const dims = Object.fromEntries(DIMENSIONS.map((d) => [d, values[d] || undefined])) as Record<Dimension, string | undefined>;
  const query =
    mode === 'dashboard'
      ? { period: values.period, ...(isCustom && { from: values.from, to: values.to }), ...dims }
      : { type: values.type, ...(isCustom ? { from: values.from, to: values.to } : { reference: values.reference || undefined }), ...dims };
  const isFiltered = DIMENSIONS.some((d) => values[d]);

  return { values, set, reset, query, ready, isCustom, isFiltered };
}

export function useDashboard(query: Record<string, unknown>, enabled = true) {
  return useQuery({
    queryKey: ['dashboard', query],
    queryFn: () => api.get<DashboardData>(`/reports/dashboard${toQuery(query)}`),
    placeholderData: keepPreviousData,
    enabled,
    refetchInterval: 5 * 60_000,
  });
}

export function useReport(query: Record<string, unknown>, enabled = true) {
  return useQuery({
    queryKey: ['reports', 'summary', query],
    queryFn: () => api.get<ReportDataset>(`/reports/summary${toQuery(query)}`),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useEmailStatus(enabled = true) {
  return useQuery({ queryKey: ['reports', 'email-status'], queryFn: () => api.get<EmailStatusDto>('/reports/email-status'), enabled, staleTime: 5 * 60_000 });
}

export function useReportJobs(page: number, enabled = true) {
  return useQuery({ queryKey: ['reports', 'jobs', page], queryFn: () => api.get<Paginated<ReportJobDto>>(`/reports/jobs${toQuery({ page, limit: 20 })}`), placeholderData: keepPreviousData, enabled, refetchInterval: 30_000 });
}

export function useReportSchedules(enabled = true) {
  return useQuery({ queryKey: ['reports', 'schedules'], queryFn: () => api.get<ReportScheduleDto[]>('/reports/schedules'), enabled });
}
