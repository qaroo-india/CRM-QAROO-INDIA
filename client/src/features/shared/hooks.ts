/**
 * Reference data used by many screens, fetched once and cached: lookup lists,
 * staff names for assignee pickers, and the course catalogue.
 */

import type { CourseDto, JobCategoryItem, LookupItem, UserOption } from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import type { SelectOption } from '@/components/ui/Input';
import { api } from '@/lib/api';

const LONG = 5 * 60_000;

export function useLookup<T extends LookupItem = LookupItem>(path: 'lead-sources' | 'expense-categories' | 'job-categories') {
  return useQuery({
    queryKey: ['lookups', path, false],
    queryFn: () => api.get<T[]>(`/settings/${path}`),
    staleTime: LONG,
  });
}

export function useLeadSources() {
  return useLookup('lead-sources');
}

export function useJobCategories() {
  return useLookup<JobCategoryItem>('job-categories');
}

export function useUserOptions() {
  return useQuery({ queryKey: ['users', 'options'], queryFn: () => api.get<UserOption[]>('/users/options'), staleTime: LONG });
}

export function useCourses(activeOnly = false, enabled = true) {
  return useQuery({
    queryKey: ['courses', { activeOnly }],
    queryFn: () => api.get<CourseDto[]>(activeOnly ? '/courses?active=true' : '/courses'),
    staleTime: 60_000,
    enabled,
  });
}

export function toOptions<T extends { id: string; name: string }>(items: T[] | undefined): SelectOption[] {
  return (items ?? []).map((item) => ({ value: item.id, label: item.name }));
}

/**
 * Quick-create links open a page with ?action=new. This reports it once and
 * clears it, so a refresh or back-navigation does not reopen the form.
 */
export function useActionParam(action: string, onAction: () => void): void {
  const [params, setParams] = useSearchParams();
  const requested = params.get('action') === action;
  useEffect(() => {
    if (!requested) return;
    onAction();
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('action');
        return next;
      },
      { replace: true },
    );
  }, [requested, onAction, setParams]);
}

/** A fresh idempotency key per form opening, so a retried submit cannot double-book. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
