import type { ApplicationDto, CompanyDto, Paginated, PlacementAnalytics, PlacementProfileDetail, PlacementProfileDto } from '@ims/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, toQuery } from '@/lib/api';
import { toastError } from '@/lib/forms';

export function useProfiles(query: Record<string, unknown>) {
  return useQuery({ queryKey: ['placements', 'profiles', query], queryFn: () => api.get<Paginated<PlacementProfileDto>>(`/placements/profiles${toQuery(query)}`), placeholderData: keepPreviousData });
}

export function useProfile(id: string | null) {
  return useQuery({ queryKey: ['placements', 'profile', id], queryFn: () => api.get<PlacementProfileDetail>(`/placements/profiles/${id}`), enabled: !!id });
}

export function useApplications(query: Record<string, unknown>) {
  return useQuery({ queryKey: ['placements', 'applications', query], queryFn: () => api.get<Paginated<ApplicationDto>>(`/placements/applications${toQuery(query)}`), placeholderData: keepPreviousData });
}

export function useCompanies() {
  return useQuery({ queryKey: ['placements', 'companies'], queryFn: () => api.get<CompanyDto[]>('/placements/companies') });
}

export function usePlacementAnalytics(query: Record<string, unknown>) {
  return useQuery({ queryKey: ['placements', 'analytics', query], queryFn: () => api.get<PlacementAnalytics>(`/placements/analytics${toQuery(query)}`), placeholderData: keepPreviousData });
}

export function usePlacementMutation<V>(fn: (v: V) => Promise<PlacementProfileDetail | unknown>, success: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      if (result && typeof result === 'object' && 'applicationsList' in result) {
        queryClient.setQueryData(['placements', 'profile', (result as PlacementProfileDetail).id], result);
      }
      for (const key of ['placements', 'students', 'dashboard']) void queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(success);
    },
    onError: (error) => toastError(error),
  });
}
