import { MANUAL_LEAD_ACTIVITY_TYPES, MANUAL_LEAD_STATUSES, type LeadDetail } from '@ims/shared';
import { ArrowRight, CalendarClock, ClipboardList, Mail, MessageSquare, Pencil, Phone, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DialogRoot, DrawerContent } from '@/components/ui/Dialog';
import { ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { date, dateTime, humanize } from '@/utils/format';
import { useChangeLeadStatus, useLead, useLogActivity } from './api';

const ACTIVITY_ICONS: Record<string, typeof Phone> = { call: Phone, email: Mail, meeting: Users, note: MessageSquare };

function describe(activity: LeadDetail['activities'][number]): string {
  switch (activity.type) {
    case 'status_change':
      return `Moved from ${humanize(activity.fromStatus)} to ${humanize(activity.toStatus)}`;
    case 'assignment':
      return 'Counsellor assigned';
    case 'follow_up_set':
      return activity.note ?? 'Follow-up scheduled';
    case 'conversion':
      return activity.note ?? 'Converted to admission';
    default:
      return humanize(activity.type);
  }
}

function LogActivityForm({ lead }: { lead: LeadDetail }) {
  const log = useLogActivity();
  const [type, setType] = useState<string>('call');
  const [note, setNote] = useState('');
  const [followUp, setFollowUp] = useState('');

  return (
    <form
      className="space-y-3 rounded-control border bg-surface-sunken p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!note.trim()) return;
        log.mutate(
          { id: lead.id, type, note: note.trim(), followUpDate: followUp || undefined },
          { onSuccess: () => { setNote(''); setFollowUp(''); } },
        );
      }}
    >
      <div className="flex flex-wrap gap-2">
        {MANUAL_LEAD_ACTIVITY_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            aria-pressed={type === t}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${type === t ? 'border-primary/40 bg-primary-soft text-primary' : 'text-fg-muted hover:text-fg'}`}
          >
            {humanize(t)}
          </button>
        ))}
      </div>
      <Textarea aria-label="Activity note" placeholder="What happened?" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={4000} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-fg-subtle">
          Next follow-up
          <Input type="date" className="h-9 w-40" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
        </label>
        <Button type="submit" size="sm" className="ml-auto" loading={log.isPending} disabled={!note.trim()}>
          Log {type}
        </Button>
      </div>
    </form>
  );
}

function StatusControl({ lead }: { lead: LeadDetail }) {
  const change = useChangeLeadStatus();
  const [status, setStatus] = useState(lead.status);
  const [reason, setReason] = useState('');
  const needsReason = ['lost', 'not_interested'].includes(status);
  const dirty = status !== lead.status;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Select
          aria-label="Pipeline status"
          className="h-9"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={MANUAL_LEAD_STATUSES.map((s) => ({ value: s, label: humanize(s) }))}
        />
        <Button
          size="sm"
          className="h-9"
          disabled={!dirty || (needsReason && reason.trim().length < 3)}
          loading={change.isPending}
          onClick={() => change.mutate({ id: lead.id, status, lostReason: needsReason ? reason.trim() : undefined })}
        >
          Update
        </Button>
      </div>
      {needsReason && dirty && (
        <Input aria-label="Reason" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      )}
    </div>
  );
}

interface LeadDetailDrawerProps {
  leadId: string | null;
  onOpenChange: (open: boolean) => void;
  onEdit: (lead: LeadDetail) => void;
}

export function LeadDetailDrawer({ leadId, onOpenChange, onEdit }: LeadDetailDrawerProps) {
  const auth = useAuth();
  const navigate = useNavigate();
  const lead = useLead(leadId);
  const canWrite = auth.can('leads:write');
  const data = lead.data;

  return (
    <DialogRoot open={!!leadId} onOpenChange={onOpenChange}>
      <DrawerContent
        title={data ? data.name : 'Enquiry'}
        description={data ? `${data.leadCode} · ${data.sourceName}` : undefined}
        width="lg"
        footer={
          data &&
          canWrite && (
            <>
              <Button variant="secondary" onClick={() => onEdit(data)}>
                <Pencil aria-hidden className="size-4" /> Edit
              </Button>
              {data.status === 'converted' ? (
                data.studentId && (
                  <Button onClick={() => navigate(`/students/${data.studentId}`)}>
                    Open student <ArrowRight aria-hidden className="size-4" />
                  </Button>
                )
              ) : (
                auth.can('admissions:write') && (
                  <Button onClick={() => navigate(`/admissions/new?leadId=${data.id}`)}>
                    <ClipboardList aria-hidden className="size-4" /> Register admission
                  </Button>
                )
              )}
            </>
          )
        }
      >
        {lead.isPending ? (
          <LoadingBlock />
        ) : lead.isError ? (
          <ErrorState error={lead.error} onRetry={() => void lead.refetch()} />
        ) : data ? (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={data.status} />
              <Badge tone={data.priority === 'high' ? 'danger' : data.priority === 'medium' ? 'warning' : 'neutral'}>{humanize(data.priority)} priority</Badge>
              {data.followUpDate && (
                <Badge tone="primary"><CalendarClock aria-hidden className="size-3" /> Follow up {date(data.followUpDate)}</Badge>
              )}
            </div>

            <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <dt className="text-fg-subtle">Phone</dt>
              <dd><a href={`tel:${data.phone}`} className="text-primary hover:underline">{data.phone}</a></dd>
              <dt className="text-fg-subtle">Email</dt>
              <dd className="text-fg">{data.email ?? '—'}</dd>
              <dt className="text-fg-subtle">Enquired</dt>
              <dd className="text-fg">{date(data.enquiryDate)}</dd>
              <dt className="text-fg-subtle">Course</dt>
              <dd className="text-fg">{data.courseName ?? 'Not decided'}</dd>
              <dt className="text-fg-subtle">Counsellor</dt>
              <dd className="text-fg">{data.counsellorName ?? 'Unassigned'}</dd>
              {data.campaignName && (<><dt className="text-fg-subtle">Campaign</dt><dd className="text-fg">{data.campaignName}</dd></>)}
              {data.utmSource && (<><dt className="text-fg-subtle">UTM</dt><dd className="font-mono text-xs text-fg-muted">{[data.utmSource, data.utmMedium, data.utmCampaign].filter(Boolean).join(' / ')}</dd></>)}
              {data.lostReason && (<><dt className="text-fg-subtle">Reason</dt><dd className="text-fg">{data.lostReason}</dd></>)}
              {data.convertedOn && (<><dt className="text-fg-subtle">Converted</dt><dd className="text-fg">{date(data.convertedOn)}{data.studentId && <> · <Link className="text-primary hover:underline" to={`/students/${data.studentId}`}>student profile</Link></>}</dd></>)}
            </dl>
            {data.notes && <p className="rounded-control border bg-surface-sunken p-3 text-sm whitespace-pre-wrap text-fg-muted">{data.notes}</p>}

            {canWrite && data.status !== 'converted' && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-fg">Pipeline</h3>
                <StatusControl key={data.status} lead={data} />
              </section>
            )}

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-fg">Activity</h3>
              {canWrite && data.status !== 'converted' && <LogActivityForm lead={data} />}
              <ol className="relative space-y-4 border-l pl-5">
                {data.activities.length === 0 && <li className="text-sm text-fg-subtle">No activity yet.</li>}
                {data.activities.map((activity) => {
                  const Icon = ACTIVITY_ICONS[activity.type] ?? CalendarClock;
                  return (
                    <li key={activity.id} className="relative">
                      <span className="absolute top-0.5 -left-[1.95rem] grid size-6 place-items-center rounded-full border bg-surface text-fg-muted">
                        <Icon aria-hidden className="size-3" />
                      </span>
                      <p className="text-sm text-fg">{describe(activity)}</p>
                      {activity.note && activity.type !== 'follow_up_set' && activity.type !== 'conversion' && (
                        <p className="mt-0.5 text-sm whitespace-pre-wrap text-fg-muted">{activity.note}</p>
                      )}
                      <p className="mt-0.5 text-xs text-fg-subtle">{activity.actorName ?? 'System'} · {dateTime(activity.occurredAt)}</p>
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
        ) : null}
      </DrawerContent>
    </DialogRoot>
  );
}
