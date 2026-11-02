/**
 * Command palette (Ctrl/Cmd+K): jump to any permitted page, start a quick
 * action, or search students, leads, admissions and courses by name, phone or
 * code. Fully keyboard driven (cmdk handles arrow keys and Enter).
 */

import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { ArrowRight, BookOpen, ClipboardList, CornerDownLeft, Megaphone, Search, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { api, toQuery } from '@/lib/api';
import { visibleItems, visibleQuickActions } from './navigation';

export interface SearchHit {
  type: 'student' | 'lead' | 'admission' | 'course';
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

const HIT_ICONS = { student: UsersRound, lead: Megaphone, admission: ClipboardList, course: BookOpen } as const;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

const itemClass =
  'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-fg outline-none select-none data-[selected=true]:bg-surface-sunken';
const groupClass =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-fg-subtle [&_[cmdk-group-heading]]:uppercase';

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const term = useDebounced(query.trim(), 250);

  const search = useQuery({
    queryKey: ['search', term],
    queryFn: ({ signal }) => api.get<SearchHit[]>(`/search${toQuery({ q: term })}`, { signal }),
    // Record search is office work; faculty and students search their pages only.
    enabled: open && term.length >= 2 && auth.accountType === 'team',
    staleTime: 30_000,
    retry: false,
  });

  const lower = query.trim().toLowerCase();
  const pages = useMemo(
    () =>
      visibleItems(auth.viewer).filter(
        (item) => !lower || item.label.toLowerCase().includes(lower) || item.keywords?.some((k) => k.includes(lower)),
      ),
    [auth, lower],
  );
  const actions = visibleQuickActions(auth.viewer).filter((a) => !lower || a.label.toLowerCase().includes(lower));
  const hits = term.length >= 2 ? (search.data ?? []) : [];

  const go = (to: string) => {
    onOpenChange(false);
    setQuery('');
    navigate(to);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery('');
      }}
      label="Command palette"
      shouldFilter={false}
      overlayClassName="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-overlay-in"
      contentClassName="fixed top-[12dvh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-card border bg-surface shadow-card data-[state=open]:animate-pop-in"
    >
      <div className="flex items-center gap-2 border-b px-4">
        <Search aria-hidden className="size-4 text-fg-subtle" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder={auth.accountType === 'team' ? 'Search records or jump to a page…' : 'Jump to a page…'}
          className="h-12 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
        />
      </div>
      <Command.List className="max-h-[60dvh] overflow-y-auto p-2">
        <Command.Empty className="px-3 py-8 text-center text-sm text-fg-muted">
          {search.isFetching ? 'Searching…' : 'No matches.'}
        </Command.Empty>

        {hits.length > 0 && (
          <Command.Group heading="Records" className={groupClass}>
            {hits.map((hit) => {
              const Icon = HIT_ICONS[hit.type];
              return (
                <Command.Item key={`${hit.type}-${hit.id}`} value={`${hit.type}-${hit.id}`} onSelect={() => go(hit.href)} className={itemClass}>
                  <Icon aria-hidden className="size-4 text-fg-subtle" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{hit.title}</span>
                    <span className="block truncate text-xs text-fg-subtle">{hit.subtitle}</span>
                  </span>
                  <span className="text-[11px] text-fg-subtle capitalize">{hit.type}</span>
                </Command.Item>
              );
            })}
          </Command.Group>
        )}

        {actions.length > 0 && (
          <Command.Group heading="Quick actions" className={groupClass}>
            {actions.map(({ label, to, icon: Icon }) => (
              <Command.Item key={label} value={`action-${label}`} onSelect={() => go(to)} className={itemClass}>
                <Icon aria-hidden className="size-4 text-fg-subtle" />
                <span className="flex-1">{label}</span>
                <ArrowRight aria-hidden className="size-3.5 text-fg-subtle" />
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {pages.length > 0 && (
          <Command.Group heading="Go to" className={groupClass}>
            {pages.map(({ label, to, icon: Icon }) => (
              <Command.Item key={to} value={`page-${to}`} onSelect={() => go(to)} className={itemClass}>
                <Icon aria-hidden className="size-4 text-fg-subtle" />
                <span className="flex-1">{label}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
      <div className="flex items-center gap-3 border-t px-4 py-2 text-[11px] text-fg-subtle">
        <span className="inline-flex items-center gap-1">
          <CornerDownLeft aria-hidden className="size-3" /> open
        </span>
        <span>↑↓ move</span>
        <span>esc close</span>
      </div>
    </Command.Dialog>
  );
}
