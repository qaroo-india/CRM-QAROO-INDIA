/**
 * List state (page, page size, sort, search and filters) kept in the URL.
 * Bookmarks, the back button and shared links all reproduce the exact view.
 */

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { SortState } from '@/components/data/DataTable';

export interface ListParams<F extends string> {
  page: number;
  limit: number;
  sort: SortState;
  q: string;
  filters: Record<F, string>;
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;
  setSort: (sort: SortState) => void;
  setQ: (q: string) => void;
  setFilter: (key: F, value: string) => void;
  reset: () => void;
  /** True when any search or filter differs from the defaults. */
  isFiltered: boolean;
  /** Everything as one object, ready for toQuery(). */
  query: Record<string, string | number>;
}

export function useListParams<F extends string>(
  filterKeys: readonly F[],
  defaults: { sort: SortState; limit?: number },
): ListParams<F> {
  const [params, setParams] = useSearchParams();

  const page = Math.max(1, Number(params.get('page')) || 1);
  const limit = Number(params.get('limit')) || defaults.limit || 25;
  const sort: SortState = {
    key: params.get('sort') || defaults.sort.key,
    order: params.get('order') === 'asc' ? 'asc' : params.get('order') === 'desc' ? 'desc' : defaults.sort.order,
  };
  const q = params.get('q') ?? '';

  const filters = useMemo(
    () => Object.fromEntries(filterKeys.map((key) => [key, params.get(key) ?? ''])) as Record<F, string>,
    [params, filterKeys],
  );

  const update = useCallback(
    (changes: Record<string, string | number | null>, resetPage = true) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === '') next.delete(key);
            else next.set(key, String(value));
          }
          if (resetPage) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const isFiltered = q !== '' || filterKeys.some((key) => filters[key] !== '');

  return {
    page,
    limit,
    sort,
    q,
    filters,
    setPage: (value) => update({ page: value > 1 ? value : null }, false),
    setLimit: (value) => update({ limit: value }),
    setSort: (value) => update({ sort: value.key, order: value.order }),
    setQ: (value) => update({ q: value }),
    setFilter: (key, value) => update({ [key]: value }),
    reset: () => update(Object.fromEntries([['q', null], ...filterKeys.map((k) => [k, null])])),
    isFiltered,
    query: {
      page,
      limit,
      sort: sort.key,
      order: sort.order,
      ...(q && { q }),
      ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')),
    },
  };
}
