/**
 * Follow-up calendar: a month grid of scheduled follow-ups, in the institute's
 * calendar (week start from settings). Overdue days are marked; each entry
 * opens the lead.
 */

import { addDays, addMonths, endOfMonth, startOfMonth, startOfWeek, todayInZone, type LeadDto } from '@ims/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { cn } from '@/lib/cn';
import { getFormatConfig, month } from '@/utils/format';
import { useLeads } from './api';

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function FollowUpCalendar({ query, onOpenLead }: { query: Record<string, unknown>; onOpenLead: (id: string) => void }) {
  const auth = useAuth();
  const weekStartsOn = auth.institute?.weekStartsOn ?? 1;
  const today = todayInZone(getFormatConfig().timeZone);
  const [cursor, setCursor] = useState(startOfMonth(today));

  const gridStart = startOfWeek(cursor, weekStartsOn);
  const gridEnd = addDays(startOfWeek(endOfMonth(cursor), weekStartsOn), 6);
  const leads = useLeads({ ...query, followUpFrom: gridStart, followUpTo: gridEnd, limit: 100, sort: 'followUpDate', order: 'asc' });

  const byDay = new Map<string, LeadDto[]>();
  for (const lead of leads.data?.items ?? []) {
    if (!lead.followUpDate) continue;
    byDay.set(lead.followUpDate, [...(byDay.get(lead.followUpDate) ?? []), lead]);
  }

  const days: string[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);
  const names = Array.from({ length: 7 }, (_, i) => WEEKDAY_NAMES[(weekStartsOn + i) % 7]!);
  const closed = ['converted', 'lost', 'not_interested', 'unreachable'];

  return (
    <div className="rounded-card border bg-surface p-4 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-fg">{month(cursor.slice(0, 7))}</h3>
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" onClick={() => setCursor(startOfMonth(today))}>Today</Button>
          <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => setCursor(addMonths(cursor, -1))}><ChevronLeft aria-hidden className="size-4" /></Button>
          <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => setCursor(addMonths(cursor, 1))}><ChevronRight aria-hidden className="size-4" /></Button>
        </div>
      </div>

      {leads.isPending ? (
        <LoadingBlock />
      ) : leads.isError ? (
        <ErrorState error={leads.error} onRetry={() => void leads.refetch()} />
      ) : (
        <div className="overflow-x-auto">
          <div className={cn('grid min-w-[44rem] grid-cols-7 gap-px overflow-hidden rounded-xl border bg-border transition-opacity', leads.isFetching && 'opacity-70')}>
            {names.map((name) => (
              <div key={name} className="bg-surface-raised px-2 py-1.5 text-center text-xs font-medium text-fg-subtle">{name}</div>
            ))}
            {days.map((day) => {
              const entries = byDay.get(day) ?? [];
              const inMonth = day.slice(0, 7) === cursor.slice(0, 7);
              const isToday = day === today;
              const hasOverdue = day < today && entries.some((l) => !closed.includes(l.status));
              return (
                <div key={day} className={cn('min-h-24 bg-surface p-1.5', !inMonth && 'bg-surface-sunken')}>
                  <p className={cn('mb-1 text-right text-xs tabular-nums', isToday ? 'font-semibold text-primary' : inMonth ? 'text-fg-muted' : 'text-fg-subtle', hasOverdue && 'text-danger')}>
                    {isToday ? 'Today ' : ''}{Number(day.slice(8))}
                  </p>
                  <ul className="space-y-1">
                    {entries.slice(0, 3).map((lead) => (
                      <li key={lead.id}>
                        <button
                          type="button"
                          onClick={() => onOpenLead(lead.id)}
                          className={cn(
                            'w-full truncate rounded-md px-1.5 py-0.5 text-left text-xs transition-colors',
                            day < today && !closed.includes(lead.status) ? 'bg-danger-soft text-danger hover:brightness-110' : 'bg-primary-soft text-primary hover:brightness-110',
                          )}
                        >
                          {lead.name}
                        </button>
                      </li>
                    ))}
                    {entries.length > 3 && <li className="px-1.5 text-xs text-fg-subtle">+{entries.length - 3} more</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {leads.data && leads.data.total > leads.data.items.length && (
        <p className="mt-2 text-xs text-fg-subtle">Showing the first {leads.data.items.length} of {leads.data.total} follow-ups in this view; narrow the filters to see all.</p>
      )}
    </div>
  );
}
