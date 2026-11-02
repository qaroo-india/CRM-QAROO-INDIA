/**
 * Kanban pipeline. Drag a card between columns, or use its "Move to" menu --
 * the keyboard and screen-reader path to the same action.
 *
 * Two columns are special:
 *   Converted -> opens admission registration (conversion only happens there)
 *   Closed    -> asks which closing status and why
 */

import { LEAD_PIPELINE_STAGES, type LeadBoardColumn, type LeadDto } from '@ims/shared';
import { CalendarClock, MoreHorizontal } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Input';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from '@/components/ui/Menu';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { cn } from '@/lib/cn';
import { date, getFormatConfig, humanize, number } from '@/utils/format';
import { todayInZone } from '@ims/shared';
import { useChangeLeadStatus, useLeadBoard } from './api';

const CLOSED = ['not_interested', 'lost', 'unreachable'] as const;
type ColumnKey = (typeof LEAD_PIPELINE_STAGES)[number] | 'closed';
const COLUMNS: ColumnKey[] = [...LEAD_PIPELINE_STAGES, 'closed'];

function LeadCard({ lead, canWrite, onOpen, onMove }: { lead: LeadDto; canWrite: boolean; onOpen: () => void; onMove: (to: ColumnKey) => void }) {
  const today = todayInZone(getFormatConfig().timeZone);
  const overdue = lead.followUpDate && lead.followUpDate < today && !['converted', ...CLOSED].includes(lead.status as never);
  return (
    <article
      draggable={canWrite && lead.status !== 'converted'}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', lead.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={cn(
        'group rounded-xl border bg-surface p-3 shadow-card transition-[border-color,transform] duration-150',
        canWrite && lead.status !== 'converted' && 'cursor-grab active:cursor-grabbing',
        'hover:border-border-strong',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onOpen} className="min-w-0 text-left">
          <p className="truncate text-sm font-medium text-fg group-hover:text-primary">{lead.name}</p>
          <p className="truncate text-xs text-fg-subtle">{lead.courseName ?? 'Course not decided'}</p>
        </button>
        {canWrite && lead.status !== 'converted' && (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon" className="-mt-1 -mr-1 size-7" aria-label={`Move ${lead.name}`}>
                <MoreHorizontal aria-hidden className="size-4" />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Move to</MenuLabel>
              {COLUMNS.filter((c) => c !== lead.status).map((column) => (
                <MenuItem key={column} onSelect={() => onMove(column)}>
                  {column === 'closed' ? 'Closed…' : column === 'converted' ? 'Converted (register admission)' : humanize(column)}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
        <span>{lead.sourceName}</span>
        {lead.counsellorName && <span>· {lead.counsellorName}</span>}
      </div>
      {(lead.followUpDate || CLOSED.includes(lead.status as never)) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {CLOSED.includes(lead.status as never) && <StatusBadge status={lead.status} />}
          {lead.followUpDate && (
            <span className={cn('inline-flex items-center gap-1 text-xs', overdue ? 'font-medium text-danger' : 'text-fg-muted')}>
              <CalendarClock aria-hidden className="size-3" />
              {overdue ? 'Overdue · ' : ''}
              {date(lead.followUpDate)}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

export function LeadBoard({ query, onOpenLead }: { query: Record<string, unknown>; onOpenLead: (id: string) => void }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const board = useLeadBoard(query);
  const change = useChangeLeadStatus();
  const [dragOver, setDragOver] = useState<ColumnKey | null>(null);
  const [closing, setClosing] = useState<{ id: string; name: string } | null>(null);
  const [closeStatus, setCloseStatus] = useState<string>('not_interested');
  const canWrite = auth.can('leads:write');

  if (board.isPending) return <LoadingBlock />;
  if (board.isError) return <ErrorState error={board.error} onRetry={() => void board.refetch()} />;

  const byStatus = new Map(board.data.map((c) => [c.status, c]));
  const columnData = (key: ColumnKey): LeadBoardColumn =>
    key === 'closed'
      ? {
          status: 'closed',
          total: CLOSED.reduce((s, k) => s + (byStatus.get(k)?.total ?? 0), 0),
          leads: CLOSED.flatMap((k) => byStatus.get(k)?.leads ?? []),
        }
      : (byStatus.get(key) ?? { status: key, total: 0, leads: [] });

  const allLeads = board.data.flatMap((c) => c.leads);

  const move = (leadId: string, to: ColumnKey) => {
    const lead = allLeads.find((l) => l.id === leadId);
    if (!lead || lead.status === to) return;
    if (to === 'converted') {
      if (auth.can('admissions:write')) navigate(`/admissions/new?leadId=${leadId}`);
      return;
    }
    if (to === 'closed') {
      setClosing({ id: leadId, name: lead.name });
      return;
    }
    change.mutate({ id: leadId, status: to });
  };

  const onDrop = (event: DragEvent, to: ColumnKey) => {
    event.preventDefault();
    setDragOver(null);
    const leadId = event.dataTransfer.getData('text/plain');
    if (leadId) move(leadId, to);
  };

  return (
    <>
      <div className={cn('flex gap-3 overflow-x-auto pb-3 transition-opacity', board.isFetching && 'opacity-70')}>
        {COLUMNS.map((key) => {
          const column = columnData(key);
          return (
            <section
              key={key}
              aria-label={`${key === 'closed' ? 'Closed' : humanize(key)}: ${column.total} leads`}
              onDragOver={(e) => {
                if (!canWrite) return;
                e.preventDefault();
                setDragOver(key);
              }}
              onDragLeave={() => setDragOver((current) => (current === key ? null : current))}
              onDrop={(e) => onDrop(e, key)}
              className={cn(
                'flex w-72 shrink-0 flex-col rounded-card border bg-surface-sunken transition-colors',
                dragOver === key && 'border-primary/60 bg-primary-soft',
              )}
            >
              <header className="flex items-center justify-between px-3 py-2.5">
                <h3 className="text-sm font-medium text-fg">{key === 'closed' ? 'Closed' : humanize(key)}</h3>
                <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-fg-muted tabular-nums">{number(column.total)}</span>
              </header>
              <div className="flex max-h-[65dvh] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {column.leads.length === 0 ? (
                  <p className="px-1 py-6 text-center text-xs text-fg-subtle">{canWrite ? 'Drop leads here' : 'No leads'}</p>
                ) : (
                  column.leads.map((lead) => (
                    <LeadCard key={lead.id} lead={lead} canWrite={canWrite} onOpen={() => onOpenLead(lead.id)} onMove={(to) => move(lead.id, to)} />
                  ))
                )}
                {column.total > column.leads.length && (
                  <p className="px-1 py-2 text-center text-xs text-fg-subtle">+{number(column.total - column.leads.length)} more · use the list view</p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <ConfirmDialog
        open={!!closing}
        onOpenChange={(open) => !open && setClosing(null)}
        title={`Close ${closing?.name ?? ''}?`}
        description="Closed enquiries leave the active pipeline but stay in reports."
        confirmLabel="Close enquiry"
        requireReason={closeStatus !== 'unreachable'}
        reasonLabel="Why did this enquiry close?"
        loading={change.isPending}
        onConfirm={(reason) => {
          if (!closing) return;
          change.mutate(
            { id: closing.id, status: closeStatus, lostReason: reason || undefined },
            { onSuccess: () => setClosing(null) },
          );
        }}
      >
        <Field label="Outcome">
          <Select value={closeStatus} onChange={(e) => setCloseStatus(e.target.value)} options={CLOSED.map((s) => ({ value: s, label: humanize(s) }))} />
        </Field>
      </ConfirmDialog>
    </>
  );
}
