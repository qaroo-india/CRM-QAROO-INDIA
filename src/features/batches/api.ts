import type { AssignmentDto, BatchDetail, BatchDto, Paginated, QueueItem, TrainerDto } from '@ims/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, toQuery } from '@/lib/api';
import { toastError } from '@/lib/forms';

export function useBatches(query: Record<string, unknown>) {
  return useQuery({ queryKey: ['batches', 'list', query], queryFn: () => api.get<Paginated<BatchDto>>(`/batches${toQuery(query)}`), placeholderData: keepPreviousData });
}

export function useBatch(id: string | undefined) {
  return useQuery({ queryKey: ['batches', 'detail', id], queryFn: () => api.get<BatchDetail>(`/batches/${id}`), enabled: !!id });
}

export function useQueue(query: Record<string, unknown>, enabled = true) {
  return useQuery({ queryKey: ['batches', 'queue', query], queryFn: () => api.get<Paginated<QueueItem>>(`/batches/queue${toQuery(query)}`), placeholderData: keepPreviousData, enabled });
}

export function useTrainers() {
  return useQuery({ queryKey: ['trainers'], queryFn: () => api.get<TrainerDto[]>('/trainers') });
}

export function useAssignments(admissionIds: string[]) {
  return useQuery({
    queryKey: ['batch-assignments', admissionIds],
    queryFn: () => api.get<AssignmentDto[]>(`/batch-assignments${toQuery({ admissionIds: admissionIds.join(',') })}`),
    enabled: admissionIds.length > 0,
  });
}

export function useBatchMutation<V>(fn: (v: V) => Promise<unknown>, success: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of ['batches', 'batch-assignments', 'admissions', 'students', 'trainers', 'dashboard']) void queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(success);
    },
    onError: (error) => toastError(error),
  });
}
