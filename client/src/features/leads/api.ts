import type { DuplicateMatch, LeadBoardColumn, LeadDetail, LeadDto, Paginated } from '@ims/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, toQuery } from '@/lib/api';
import { toastError } from '@/lib/forms';

export const leadKeys = {
  all: ['leads'] as const,
  list: (query: Record<string, unknown>) => ['leads', 'list', query] as const,
  board: (query: Record<string, unknown>) => ['leads', 'board', query] as const,
  detail: (id: string) => ['leads', 'detail', id] as const,
};

export function useLeads(query: Record<string, unknown>, enabled = true) {
  return useQuery({
    queryKey: leadKeys.list(query),
    queryFn: () => api.get<Paginated<LeadDto>>(`/leads${toQuery(query)}`),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useLeadBoard(query: Record<string, unknown>, enabled = true) {
  return useQuery({
    queryKey: leadKeys.board(query),
    queryFn: () => api.get<LeadBoardColumn[]>(`/leads/board${toQuery(query)}`),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useLead(id: string | null) {
  return useQuery({
    queryKey: leadKeys.detail(id ?? ''),
    queryFn: () => api.get<LeadDetail>(`/leads/${id}`),
    enabled: !!id,
  });
}

/** Invalidate every lead view after a change, and seed the detail cache. */
function useLeadMutation<V>(fn: (vars: V) => Promise<LeadDetail>, success?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (lead) => {
      queryClient.setQueryData(leadKeys.detail(lead.id), lead);
      void queryClient.invalidateQueries({ queryKey: ['leads', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['leads', 'board'] });
      if (success) toast.success(success);
    },
    onError: (error) => toastError(error),
  });
}

export function useChangeLeadStatus() {
  return useLeadMutation(
    ({ id, ...body }: { id: string; status: string; lostReason?: string; note?: string; followUpDate?: string }) =>
      api.post<LeadDetail>(`/leads/${id}/status`, body),
    'Status updated',
  );
}

export function useLogActivity() {
  return useLeadMutation(
    ({ id, ...body }: { id: string; type: string; note: string; followUpDate?: string }) => api.post<LeadDetail>(`/leads/${id}/activities`, body),
    'Activity logged',
  );
}

export function useAssignLeads() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { leadIds: string[]; counsellorId: string }) => api.post<{ updated: number }>('/leads/assign', body),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: leadKeys.all });
      toast.success(`${result.updated} lead${result.updated === 1 ? '' : 's'} assigned`);
    },
    onError: (error) => toastError(error),
  });
}

/** Debounced duplicate check while a phone or email is being typed. */
export function useDuplicateCheck(kind: 'leads' | 'students', phone: string | undefined, email: string | undefined, excludeId?: string) {
  const [debounced, setDebounced] = useState({ phone: '', email: '' });
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced({ phone: phone?.trim() ?? '', email: email?.trim() ?? '' }), 400);
    return () => window.clearTimeout(id);
  }, [phone, email]);

  const digits = debounced.phone.replace(/\D/g, '');
  const enabled = digits.length >= 7 || /.+@.+\..+/.test(debounced.email);
  return useQuery({
    queryKey: [kind, 'duplicates', debounced, excludeId],
    queryFn: () =>
      api.get<DuplicateMatch[]>(`/${kind}/duplicates${toQuery({ phone: digits.length >= 7 ? debounced.phone : undefined, email: debounced.email || undefined, excludeId })}`),
    enabled,
    staleTime: 30_000,
  });
}
