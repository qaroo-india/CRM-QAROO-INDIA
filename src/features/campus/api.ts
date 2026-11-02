/**
 * Data hooks for the campus modules: schedule, attendance, exams, material,
 * certificates, drives, leave, tasks, inventory -- and the student portal.
 */

import type {
  AttemptResult,
  AttendanceRosterDto,
  AttendanceSessionDto,
  AttendanceSummaryRow,
  BatchDto,
  CertificateDto,
  ClassSessionDto,
  DriveApplicantDto,
  DriveDto,
  ExamDetail,
  ExamDto,
  ExamPaper,
  ExamResultRow,
  InventoryItemDto,
  InventoryRequestDto,
  LeaveDto,
  MaterialDto,
  Paginated,
  PortalAttendance,
  PortalExam,
  PortalFees,
  PortalOverview,
  PortalPlacement,
  TaskDto,
} from '@ims/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { api, ApiRequestError, toQuery } from '@/lib/api';
import { toastError } from '@/lib/forms';
import { useCourses } from '../shared/hooks';

/** A write that refreshes the given caches and confirms with a toast. */
export function useAction<V, R = unknown>(fn: (v: V) => Promise<R>, options: { invalidate: QueryKey[]; success?: string | ((r: R) => string); onDone?: (r: R) => void; silentErrors?: boolean }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      for (const key of options.invalidate) void queryClient.invalidateQueries({ queryKey: key });
      if (options.success) toast.success(typeof options.success === 'function' ? options.success(result) : options.success);
      options.onDone?.(result);
    },
    onError: (error) => {
      if (!options.silentErrors) toastError(error);
    },
  });
}

/** Field errors from a 422, keyed by the first path segment, for controlled forms. */
export function useFieldErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const capture = (error: unknown): boolean => {
    if (error instanceof ApiRequestError && error.fields?.length) {
      setErrors(Object.fromEntries(error.fields.map((f) => [f.path.split('.')[0]!, f.message])));
      return true;
    }
    toastError(error);
    return false;
  };
  return { errors, setErrors, capture, clear: () => setErrors({}) };
}

/* Batches the signed-in person may work with (faculty: their own) ---------- */

export function useMyBatches() {
  return useQuery({ queryKey: ['batches', 'list', { mine: true }], queryFn: () => api.get<Paginated<BatchDto>>(`/batches${toQuery({ limit: 100, status: 'planned,enrolling,running,completed' })}`), staleTime: 60_000 });
}

/**
 * Courses for the teaching pages. Faculty cannot read the course catalogue,
 * so theirs come from their own batches (which is also the right list for them).
 */
export function useTeachingCourses(): { data: { id: string; name: string }[] | undefined; isPending: boolean } {
  const { accountType } = useAuth();
  const faculty = accountType === 'faculty';
  const all = useCourses(false, !faculty);
  const mine = useMyBatches();
  const fromBatches = useMemo(() => {
    if (!mine.data) return undefined;
    const seen = new Map<string, string>();
    for (const b of mine.data.items) seen.set(b.courseId, b.courseName);
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [mine.data]);
  return faculty ? { data: fromBatches, isPending: mine.isPending } : { data: all.data, isPending: all.isPending };
}

/* Schedule and attendance -------------------------------------------------- */

export function useSchedule(query: Record<string, unknown>, enabled = true) {
  return useQuery({ queryKey: ['schedule', query], queryFn: () => api.get<ClassSessionDto[]>(`/schedule${toQuery(query)}`), placeholderData: keepPreviousData, enabled });
}

export function useRoster(batchId: string, date: string) {
  return useQuery({ queryKey: ['attendance', 'roster', batchId, date], queryFn: () => api.get<AttendanceRosterDto>(`/attendance/roster${toQuery({ batchId, date })}`), enabled: Boolean(batchId && date) });
}

export function useAttendanceSessions(batchId: string) {
  return useQuery({ queryKey: ['attendance', 'sessions', batchId], queryFn: () => api.get<AttendanceSessionDto[]>(`/attendance/sessions${toQuery({ batchId })}`), enabled: Boolean(batchId) });
}

export function useAttendanceSummary(batchId: string) {
  return useQuery({ queryKey: ['attendance', 'summary', batchId], queryFn: () => api.get<AttendanceSummaryRow[]>(`/attendance/summary${toQuery({ batchId })}`), enabled: Boolean(batchId) });
}

/* Exams --------------------------------------------------------------------- */

export function useExams(query: Record<string, unknown>) {
  return useQuery({ queryKey: ['exams', 'list', query], queryFn: () => api.get<Paginated<ExamDto>>(`/exams${toQuery(query)}`), placeholderData: keepPreviousData });
}

export function useExam(id: string | undefined) {
  return useQuery({ queryKey: ['exams', 'detail', id], queryFn: () => api.get<ExamDetail>(`/exams/${id}`), enabled: Boolean(id) });
}

export function useExamResults(id: string | undefined, enabled: boolean) {
  return useQuery({ queryKey: ['exams', 'results', id], queryFn: () => api.get<ExamResultRow[]>(`/exams/${id}/results`), enabled: Boolean(id) && enabled });
}

/* Material and certificates --------------------------------------------- */

export function useMaterials(query: Record<string, unknown>) {
  return useQuery({ queryKey: ['materials', 'list', query], queryFn: () => api.get<Paginated<MaterialDto>>(`/materials${toQuery(query)}`), placeholderData: keepPreviousData });
}

export function useCertificates(query: Record<string, unknown>) {
  return useQuery({ queryKey: ['certificates', 'list', query], queryFn: () => api.get<Paginated<CertificateDto>>(`/certificates${toQuery(query)}`), placeholderData: keepPreviousData });
}

/* Placement drives ------------------------------------------------------- */

export function useDrives(query: Record<string, unknown>) {
  return useQuery({ queryKey: ['drives', 'list', query], queryFn: () => api.get<Paginated<DriveDto>>(`/drives${toQuery(query)}`), placeholderData: keepPreviousData });
}

export function useDriveApplicants(id: string | null) {
  return useQuery({ queryKey: ['drives', 'applicants', id], queryFn: () => api.get<DriveApplicantDto[]>(`/drives/${id}/applicants`), enabled: Boolean(id) });
}

/* Leave, tasks, inventory ------------------------------------------------- */

export function useLeave(query: Record<string, unknown>) {
  return useQuery({ queryKey: ['leave', query], queryFn: () => api.get<Paginated<LeaveDto>>(`/leave${toQuery(query)}`), placeholderData: keepPreviousData });
}

export function useLeaveToday(enabled: boolean) {
  return useQuery({ queryKey: ['leave', 'today'], queryFn: () => api.get<LeaveDto[]>('/leave/today'), enabled });
}

export function useTasks(query: Record<string, unknown>) {
  return useQuery({ queryKey: ['tasks', query], queryFn: () => api.get<Paginated<TaskDto>>(`/tasks${toQuery(query)}`), placeholderData: keepPreviousData });
}

export interface InventoryList extends Paginated<InventoryItemDto> {
  summary: { totalValueMinor: number; activeItems: number; unitsLent: number };
}

export function useInventoryItems(query: Record<string, unknown>, enabled = true) {
  return useQuery({ queryKey: ['inventory', 'items', query], queryFn: () => api.get<InventoryList>(`/inventory/items${toQuery(query)}`), placeholderData: keepPreviousData, enabled });
}

export function useInventoryRequests(query: Record<string, unknown>, enabled = true) {
  return useQuery({ queryKey: ['inventory', 'requests', query], queryFn: () => api.get<Paginated<InventoryRequestDto>>(`/inventory/requests${toQuery(query)}`), placeholderData: keepPreviousData, enabled });
}

/* Student portal ------------------------------------------------------------ */

export function usePortalOverview() {
  return useQuery({ queryKey: ['portal', 'overview'], queryFn: () => api.get<PortalOverview>('/portal/overview') });
}

export function usePortalFees() {
  return useQuery({ queryKey: ['portal', 'fees'], queryFn: () => api.get<PortalFees>('/portal/fees') });
}

export function usePortalAttendance() {
  return useQuery({ queryKey: ['portal', 'attendance'], queryFn: () => api.get<PortalAttendance[]>('/portal/attendance') });
}

export function usePortalClasses(from: string, to: string) {
  return useQuery({ queryKey: ['portal', 'classes', from, to], queryFn: () => api.get<ClassSessionDto[]>(`/portal/classes${toQuery({ from, to })}`), placeholderData: keepPreviousData });
}

export function usePortalExams() {
  return useQuery({ queryKey: ['portal', 'exams'], queryFn: () => api.get<PortalExam[]>('/portal/exams') });
}

export function usePortalResults() {
  return useQuery({ queryKey: ['portal', 'results'], queryFn: () => api.get<AttemptResult[]>('/portal/results') });
}

export function useExamPaper(attemptId: string | undefined) {
  return useQuery({ queryKey: ['portal', 'paper', attemptId], queryFn: () => api.get<ExamPaper>(`/portal/attempts/${attemptId}`), enabled: Boolean(attemptId), retry: false, refetchOnWindowFocus: false });
}

export function usePortalMaterials() {
  return useQuery({ queryKey: ['portal', 'materials'], queryFn: () => api.get<MaterialDto[]>('/portal/materials') });
}

export function usePortalCertificates() {
  return useQuery({ queryKey: ['portal', 'certificates'], queryFn: () => api.get<CertificateDto[]>('/portal/certificates') });
}

export function usePortalPlacement() {
  return useQuery({ queryKey: ['portal', 'placement'], queryFn: () => api.get<PortalPlacement>('/portal/placements') });
}
