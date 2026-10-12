/**
 * Manage one owner-curated list (lead sources, expense categories, job
 * categories): add, rename, activate/deactivate and reorder. Items are never
 * deleted, because past records still point at them.
 */

import type { JobCategoryItem, LookupItem } from '@ims/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, Pencil, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Toggle';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { toastError } from '@/lib/forms';

type Item = LookupItem & Partial<Pick<JobCategoryItem, 'track'>>;

interface LookupManagerProps {
  path: 'lead-sources' | 'expense-categories' | 'job-categories';
  noun: string;
  /** Job categories are split by track. */
  track?: 'technical' | 'non_technical';
  canWrite: boolean;
}

export function lookupQueryKey(path: string, includeInactive = false) {
  return ['lookups', path, includeInactive] as const;
}

export function LookupManager({ path, noun, track, canWrite }: LookupManagerProps) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const items = useQuery({
    queryKey: lookupQueryKey(path, true),
    queryFn: () => api.get<Item[]>(`/settings/${path}?includeInactive=true`),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['lookups', path] });

  const create = useMutation({
    mutationFn: (name: string) => api.post(`/settings/${path}`, track ? { name, track } : { name }),
    onSuccess: () => {
      setNewName('');
      toast.success(`${noun} added`);
      invalidate();
    },
    onError: (error) => toastError(error),
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; isActive?: boolean }) => api.patch(`/settings/${path}/${id}`, body),
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
    onError: (error) => toastError(error),
  });

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.post(`/settings/${path}/reorder`, { ids }),
    onSuccess: invalidate,
    onError: (error) => toastError(error),
  });

  if (items.isPending) return <LoadingBlock />;
  if (items.isError) return <ErrorState error={items.error} onRetry={() => void items.refetch()} />;

  const rows = items.data.filter((item) => !track || item.track === track);

  const move = (index: number, delta: -1 | 1) => {
    const ids = rows.map((r) => r.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate(ids);
  };

  return (
    <div className="space-y-3">
      {canWrite && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) create.mutate(newName.trim());
          }}
        >
          <Input aria-label={`New ${noun.toLowerCase()}`} placeholder={`Add a ${noun.toLowerCase()}…`} value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} />
          <Button type="submit" variant="secondary" loading={create.isPending} disabled={!newName.trim()}>
            <Plus aria-hidden className="size-4" /> Add
          </Button>
        </form>
      )}

      {rows.length === 0 ? (
        <EmptyState compact title={`No ${noun.toLowerCase()}s yet`} />
      ) : (
        <ul className="divide-y rounded-card border bg-surface">
          {rows.map((item, index) => (
            <li key={item.id} className="flex items-center gap-3 px-3 py-2">
              {canWrite && (
                <div className="flex flex-col">
                  <button type="button" className="text-fg-subtle hover:text-fg disabled:opacity-30" disabled={index === 0 || reorder.isPending} onClick={() => move(index, -1)} aria-label={`Move ${item.name} up`}>
                    <ArrowUp aria-hidden className="size-3.5" />
                  </button>
                  <button type="button" className="text-fg-subtle hover:text-fg disabled:opacity-30" disabled={index === rows.length - 1 || reorder.isPending} onClick={() => move(index, 1)} aria-label={`Move ${item.name} down`}>
                    <ArrowDown aria-hidden className="size-3.5" />
                  </button>
                </div>
              )}

              {editing?.id === item.id ? (
                <form
                  className="flex flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (editing.name.trim()) update.mutate({ id: item.id, name: editing.name.trim() });
                  }}
                >
                  <Input aria-label={`Rename ${item.name}`} className="h-8" value={editing.name} onChange={(e) => setEditing({ id: item.id, name: e.target.value })} autoFocus maxLength={80} />
                  <Button type="submit" size="icon" variant="ghost" aria-label="Save name" loading={update.isPending}>
                    <Check aria-hidden className="size-4" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" aria-label="Cancel rename" onClick={() => setEditing(null)}>
                    <X aria-hidden className="size-4" />
                  </Button>
                </form>
              ) : (
                <span className={cn('flex-1 text-sm', item.isActive ? 'text-fg' : 'text-fg-subtle line-through')}>{item.name}</span>
              )}

              {canWrite && editing?.id !== item.id && (
                <>
                  <Button variant="ghost" size="icon" aria-label={`Rename ${item.name}`} onClick={() => setEditing({ id: item.id, name: item.name })}>
                    <Pencil aria-hidden className="size-3.5" />
                  </Button>
                  <Switch
                    checked={item.isActive}
                    onCheckedChange={(isActive) => update.mutate({ id: item.id, isActive })}
                    aria-label={`${item.name} ${item.isActive ? 'active' : 'inactive'}`}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-fg-subtle">Inactive entries are hidden from new forms but kept on past records and reports.</p>
    </div>
  );
}
