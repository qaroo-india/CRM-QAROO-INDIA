import type { ClassSessionDto } from '@ims/shared';
import { CalendarDays, ExternalLink, MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/ui/Feedback';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { cn } from '@/lib/cn';
import { humanize } from '@/utils/format';
import { dayLabel, timeOf } from './time';

/**
 * Classes grouped by institute day, oldest first. Read-only; `action` adds a
 * per-class control (e.g. "Take attendance" for faculty).
 */
export function ClassList({ sessions, today, showBatch = true, action, empty }: { sessions: ClassSessionDto[]; today: string; showBatch?: boolean; action?: (s: ClassSessionDto) => ReactNode; empty?: ReactNode }) {
  if (sessions.length === 0) return <>{empty ?? <EmptyState compact icon={CalendarDays} title="No classes in this period" />}</>;
  const days = new Map<string, ClassSessionDto[]>();
  for (const s of sessions) days.set(s.date, [...(days.get(s.date) ?? []), s]);
  return (
    <ol className="divide-y">
      {[...days.entries()].map(([day, list]) => (
        <li key={day} className="py-3 first:pt-0 last:pb-0">
          <p className={cn('mb-2 text-xs font-semibold uppercase tracking-wide', day === today ? 'text-primary' : 'text-fg-subtle')}>{day === today ? `Today · ${dayLabel(day)}` : dayLabel(day)}</p>
          <ul className="space-y-2">
            {list.map((s) => (
              <li key={s.id} className={cn('flex flex-wrap items-start gap-x-4 gap-y-1', s.status === 'cancelled' && 'opacity-60')}>
                <span className="w-24 shrink-0 text-sm tabular-nums text-fg-muted">{timeOf(s.startsAt)}–{timeOf(s.endsAt)}</span>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-medium text-fg', s.status === 'cancelled' && 'line-through')}>{s.title}</p>
                  <p className="text-xs text-fg-subtle">
                    {[humanize(s.kind), showBatch ? s.batchCode : null, s.trainerName].filter(Boolean).join(' · ')}
                    {s.location && <span className="ml-2 inline-flex items-center gap-0.5"><MapPin aria-hidden className="size-3" />{s.location}</span>}
                  </p>
                  {s.status === 'cancelled' && s.cancelReason && <p className="text-xs text-danger">Cancelled: {s.cancelReason}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {s.status !== 'scheduled' && <StatusBadge status={s.status} />}
                  {s.meetingLink && s.status === 'scheduled' && (
                    <a href={s.meetingLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                      Join <ExternalLink aria-hidden className="size-3.5" />
                    </a>
                  )}
                  {action?.(s)}
                </div>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
