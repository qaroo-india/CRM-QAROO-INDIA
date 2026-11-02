import type { NotificationDto, Paginated } from '@ims/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellRing, CheckCheck, CircleCheck, CircleX, Info, RefreshCw, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { Pagination } from '@/components/data/Pagination';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { SegmentedItem, SegmentedList } from '@/components/ui/Segmented';
import { api, toQuery } from '@/lib/api';
import { cn } from '@/lib/cn';
import { toastError } from '@/lib/forms';
import { dateTime, relative } from '@/utils/format';

const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleX } as const;
const TONES = { info: 'text-primary', success: 'text-success', warning: 'text-warning', error: 'text-danger' } as const;

export function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['notifications', 'list', unreadOnly, page],
    queryFn: () => api.get<Paginated<NotificationDto>>(`/notifications${toQuery({ unread: unreadOnly ? 'true' : undefined, page, limit: 25 })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['notifications'] });

  const markRead = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: refresh });
  const markAll = useMutation({
    mutationFn: () => api.post<{ updated: number }>('/notifications/read-all'),
    onSuccess: (r) => {
      refresh();
      toast.success(r.updated ? `Marked ${r.updated} as read` : 'Nothing unread');
    },
    onError: (e) => toastError(e),
  });
  const sweep = useMutation({
    mutationFn: () => api.post<{ created: number }>('/notifications/sweep'),
    onSuccess: (r) => {
      refresh();
      toast.success(r.created ? `${r.created} new reminder(s)` : 'No new reminders: everything is already flagged');
    },
    onError: (e) => toastError(e),
  });

  const open = (n: NotificationDto) => {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.link) void navigate(n.link);
  };

  return (
    <>
      <PageHeader
        title="Notifications & tasks"
        description="Reminders for dues, follow-ups, batches and interviews, plus alerts when something needs attention. Reminders are checked every 15 minutes."
        actions={
          <div className="flex flex-wrap gap-2">
            {user?.role === 'owner' && (
              <Button variant="ghost" loading={sweep.isPending} onClick={() => sweep.mutate()}><RefreshCw aria-hidden className="size-4" /> Check now</Button>
            )}
            <Button variant="secondary" loading={markAll.isPending} onClick={() => markAll.mutate()}><CheckCheck aria-hidden className="size-4" /> Mark all read</Button>
          </div>
        }
      />
      <SegmentedList label="Filter" className="mb-4 inline-flex gap-1 rounded-control border bg-surface p-1">
        {[false, true].map((u) => (
          <SegmentedItem key={String(u)} selected={unreadOnly === u} onClick={() => { setUnreadOnly(u); setPage(1); }}>
            {u ? 'Unread' : 'All'}
          </SegmentedItem>
        ))}
      </SegmentedList>
      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon={unreadOnly ? Bell : BellRing} title={unreadOnly ? 'All caught up' : 'No notifications yet'} description="Due and overdue instalments, missed follow-ups, students waiting for a batch, interviews and failed emails will show up here." />
      ) : (
        <>
          <ul className={cn('divide-y rounded-card border bg-surface shadow-card', list.isFetching && 'opacity-80')}>
            {list.data.items.map((n) => {
              const Icon = ICONS[n.severity];
              return (
                <li key={n.id}>
                  <button type="button" onClick={() => open(n)} className={cn('flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-raised', !n.readAt && 'bg-primary-soft/40')}>
                    <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', TONES[n.severity])} />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-sm text-fg', !n.readAt && 'font-semibold')}>{n.title}</span>
                      {n.body && <span className="block text-sm text-fg-muted">{n.body}</span>}
                      <span className="block text-xs text-fg-subtle" title={dateTime(n.createdAt)}>{relative(n.createdAt)}{n.link ? ' · open' : ''}</span>
                    </span>
                    {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} limit={list.data.limit} onPageChange={setPage} />
        </>
      )}
    </>
  );
}
