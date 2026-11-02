import type { AdmissionDto, Paginated, StudentDto, StudentProfile } from '@ims/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, toQuery } from '@/lib/api';

export const studentKeys = {
  all: ['students'] as const,
  list: (query: Record<string, unknown>) => ['students', 'list', query] as const,
  profile: (id: string) => ['students', 'profile', id] as const,
};

export function useStudents(query: Record<string, unknown>, enabled = true) {
  return useQuery({
    queryKey: studentKeys.list(query),
    queryFn: () => api.get<Paginated<StudentDto>>(`/students${toQuery(query)}`),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useStudentProfile(id: string | undefined) {
  return useQuery({
    queryKey: studentKeys.profile(id ?? ''),
    queryFn: () => api.get<StudentProfile>(`/students/${id}`),
    enabled: !!id,
  });
}

export const admissionKeys = {
  all: ['admissions'] as const,
  list: (query: Record<string, unknown>) => ['admissions', 'list', query] as const,
  detail: (id: string) => ['admissions', 'detail', id] as const,
};

export function useAdmissions(query: Record<string, unknown>, enabled = true) {
  return useQuery({
    queryKey: admissionKeys.list(query),
    queryFn: () => api.get<Paginated<AdmissionDto>>(`/admissions${toQuery(query)}`),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useAdmission(id: string | null) {
  return useQuery({
    queryKey: admissionKeys.detail(id ?? ''),
    queryFn: () => api.get<AdmissionDto>(`/admissions/${id}`),
    enabled: !!id,
  });
}
