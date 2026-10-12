import { humanize } from '@/utils/format';
import { Badge, type BadgeTone } from './Badge';

/**
 * One place mapping every status vocabulary value to a tone. Tone is only a
 * second channel: the badge always carries the status in words.
 */
const TONES: Record<string, BadgeTone> = {
  // positive / settled
  active: 'success',
  paid: 'success',
  succeeded: 'success',
  approved: 'success',
  joined: 'success',
  completed: 'success',
  converted: 'success',
  ready: 'success',
  passed: 'success',
  selected: 'success',
  offer_received: 'success',
  fully_disbursed: 'success',
  assigned: 'success',
  sent: 'success',
  present: 'success',
  published: 'success',
  issued: 'success',
  open: 'success',
  done: 'success',
  in_service: 'success',
  graduated: 'success',
  refund: 'warning',
  recorded: 'neutral',

  // in motion
  new: 'primary',
  contacted: 'primary',
  counselling_scheduled: 'primary',
  interested: 'primary',
  applied: 'primary',
  interview_scheduled: 'primary',
  interviewing: 'primary',
  running: 'primary',
  enrolling: 'primary',
  in_progress: 'primary',
  eligible: 'primary',
  resume_preparation: 'primary',
  scheduled: 'primary',
  queued: 'primary',
  on_duty: 'primary',
  medium: 'primary',

  // needs attention
  pending: 'warning',
  pending_payment: 'warning',
  partially_paid: 'warning',
  under_review: 'warning',
  follow_up: 'warning',
  on_hold: 'warning',
  awaiting_disbursement: 'warning',
  partially_disbursed: 'warning',
  waiting_for_next_batch: 'warning',
  not_assigned: 'warning',
  late: 'warning',
  repair: 'warning',
  high: 'warning',
  transferred: 'violet',
  transferred_out: 'violet',

  // closed / negative
  overdue: 'danger',
  failed: 'danger',
  rejected: 'danger',
  cancelled: 'danger',
  lost: 'danger',
  reversed: 'danger',
  withdrawn: 'danger',
  not_interested: 'danger',
  unreachable: 'danger',
  dropped: 'danger',
  offer_declined: 'danger',
  no_show: 'danger',
  absent: 'danger',
  blocked: 'danger',
  urgent: 'danger',
  suspended: 'danger',

  // inert
  draft: 'neutral',
  planned: 'neutral',
  superseded: 'neutral',
  waived: 'neutral',
  not_seeking: 'neutral',
  not_started: 'neutral',
  holiday: 'neutral',
  closed: 'neutral',
  archived: 'neutral',
  todo: 'neutral',
  returned: 'neutral',
  retired: 'neutral',
  low: 'neutral',
  inactive: 'neutral',
};

const LABELS: Record<string, string> = {
  pending_payment: 'Pending payment',
  counselling_scheduled: 'Counselling scheduled',
  not_seeking: 'Not seeking placement',
  offer_received: 'Offer received',
};

export function statusTone(status: string): BadgeTone {
  return TONES[status] ?? 'neutral';
}

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  return (
    <Badge tone={statusTone(status)} dot className={className}>
      {label ?? LABELS[status] ?? humanize(status)}
    </Badge>
  );
}
