/**
 * In-app notifications.
 *
 * Two sources:
 *   - events (an admission, a loan decision, an offer, a failed email) call
 *     notifyUsers / notifyPermission right after their transaction commits;
 *   - a periodic sweep raises daily digests (instalments due and overdue,
 *     follow-ups, students waiting for a batch, full batches, interviews).
 *
 * Every notification has a dedupe key, unique per user, so re-running the
 * sweep (or a retried request) never notifies anyone twice about the same
 * thing. Digests key on the day, so they repeat once per day while the
 * condition holds -- a reminder, not spam.
 */

import { addDays, hasPermission, type NotificationDto, type NotificationSeverity, type NotificationType, type Permission } from '@ims/shared';
import { and, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { notificationListQuerySchema } from '@ims/shared';
import { logger } from '../../config/logger';
import { db } from '../../db';
import { notifications, users } from '../../db/schema';
import type { DbLike } from '../../db/types';
import { instituteToday } from '../../services/clock';
import { getSettings } from '../../services/settings';
import { instalmentPaidSql } from '../../services/ledger';
import { ApiError } from '../../utils/ApiError';
import { pageWindow, paginated } from '../../utils/pagination';
import { formatMoney } from '@ims/shared';

export interface NotifyInput {
  type: NotificationType;
  severity?: NotificationSeverity;
  title: string;
  body?: string | null;
  link?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  dedupeKey: string;
}

/** Active users holding a permission (the owner wildcard included). */
export function usersWithPermission(permission: Permission, database: DbLike = db): string[] {
  return database
    .select({ id: users.id, permissions: users.permissions })
    .from(users)
    .where(eq(users.isActive, true))
    .all()
    .filter((u) => hasPermission(u.permissions, permission))
    .map((u) => u.id);
}

export function ownerIds(database: DbLike = db): string[] {
  return database.select({ id: users.id }).from(users).where(and(eq(users.isActive, true), eq(users.role, 'owner'))).all().map((u) => u.id);
}

/** Insert for each user; an existing (user, dedupeKey) is left alone. Returns how many were new. */
export function notifyUsers(userIds: readonly string[], input: NotifyInput, database: DbLike = db): number {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return 0;
  let created = 0;
  for (const userId of unique) {
    const result = database
      .insert(notifications)
      .values({
        userId,
        type: input.type,
        severity: input.severity ?? 'info',
        title: input.title.slice(0, 200),
        body: input.body ?? null,
        link: input.link ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        dedupeKey: input.dedupeKey,
      })
      .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] })
      .run();
    created += result.changes;
  }
  return created;
}

export function notifyPermission(permission: Permission, input: NotifyInput, options: { except?: string } = {}): number {
  return notifyUsers(usersWithPermission(permission).filter((id) => id !== options.except), input);
}

/** For post-commit callers: a notification must never break the action that caused it. */
export function safely(label: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    logger.warn({ err: error, label }, 'Notification failed (the original action succeeded)');
  }
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

function toDto(n: typeof notifications.$inferSelect): NotificationDto {
  return {
    id: n.id,
    type: n.type,
    severity: n.severity,
    title: n.title,
    body: n.body,
    link: n.link,
    entityType: n.entityType,
    entityId: n.entityId,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

export function listNotifications(userId: string, q: z.output<typeof notificationListQuerySchema>) {
  const conditions: SQL[] = [eq(notifications.userId, userId)];
  if (q.unread === 'true') conditions.push(isNull(notifications.readAt));
  if (q.unread === 'false') conditions.push(sql`${notifications.readAt} is not null`);
  if (q.type) conditions.push(eq(notifications.type, q.type));
  const where = and(...conditions);
  const total = db.select({ n: count() }).from(notifications).where(where).get()?.n ?? 0;
  const { limit, offset } = pageWindow(q.page, q.limit);
  const rows = db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(limit).offset(offset).all();
  return paginated(rows.map(toDto), total, q.page, q.limit);
}

export function unreadCount(userId: string): number {
  return db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))).get()?.n ?? 0;
}

export function markRead(userId: string, id: string): NotificationDto {
  const row = db.select().from(notifications).where(and(eq(notifications.id, id), eq(notifications.userId, userId))).get();
  // Someone else's notification is reported as missing, not forbidden.
  if (!row) throw ApiError.notFound('Notification');
  if (row.readAt) return toDto(row);
  return toDto(db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id)).returning().get());
}

export function markAllRead(userId: string): number {
  return db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))).run().changes;
}

/* ------------------------------------------------------------------ *
 * The sweep
 * ------------------------------------------------------------------ */

const OPEN_LEAD = sql.raw(`l.status not in ('converted', 'not_interested', 'lost', 'unreachable')`);

export function runNotificationSweep(now: Date = new Date()): { created: number } {
  const settings = getSettings();
  const today = instituteToday(now);
  const money = (minor: number) => formatMoney(minor, { currency: settings.currency, locale: settings.locale, compactDecimals: true });
  let created = 0;

  // Instalments falling due soon, and already overdue.
  const dueBy = addDays(today, Math.max(0, settings.dueReminderDays));
  const unpaid = sql`max(0, i.amount_minor - ${instalmentPaidSql()})`;
  const due = db.get<{ n: number; amount: number }>(sql`
    select count(*) as n, coalesce(sum(${unpaid}), 0) as amount
    from instalments i join admissions on admissions.id = i.admission_id
    where i.state = 'active' and admissions.status <> 'cancelled' and i.due_date between ${today} and ${dueBy} and ${unpaid} > 0`);
  if (due && Number(due.n) > 0) {
    created += notifyUsers(usersWithPermission('payments:read'), {
      type: 'instalment_due',
      title: `${due.n} instalment${Number(due.n) === 1 ? '' : 's'} due by ${dueBy}`,
      body: `${money(Number(due.amount))} to collect in the next ${settings.dueReminderDays} day(s).`,
      link: '/instalments?view=due_soon',
      dedupeKey: `instalment_due:${today}`,
    });
  }
  const overdue = db.get<{ n: number; amount: number; students: number }>(sql`
    select count(*) as n, coalesce(sum(${unpaid}), 0) as amount, count(distinct i.admission_id) as students
    from instalments i join admissions on admissions.id = i.admission_id
    where i.state = 'active' and admissions.status <> 'cancelled' and i.due_date < ${today} and ${unpaid} > 0`);
  if (overdue && Number(overdue.n) > 0) {
    created += notifyUsers(usersWithPermission('payments:read'), {
      type: 'instalment_overdue',
      severity: 'warning',
      title: `${overdue.n} overdue instalment${Number(overdue.n) === 1 ? '' : 's'} (${overdue.students} admission${Number(overdue.students) === 1 ? '' : 's'})`,
      body: `${money(Number(overdue.amount))} is past due.`,
      link: '/instalments?view=overdue',
      dedupeKey: `instalment_overdue:${today}`,
    });
  }

  // Follow-ups: each counsellor hears about their own leads; unassigned ones go to owners.
  const followUps = db.all<{ counsellorId: string | null; dueToday: number; missed: number }>(sql`
    select l.counsellor_id as counsellorId,
           sum(case when l.follow_up_date = ${today} then 1 else 0 end) as dueToday,
           sum(case when l.follow_up_date < ${today} then 1 else 0 end) as missed
    from leads l where ${OPEN_LEAD} and l.follow_up_date is not null and l.follow_up_date <= ${today}
    group by l.counsellor_id`);
  const activeIds = new Set(db.select({ id: users.id }).from(users).where(eq(users.isActive, true)).all().map((u) => u.id));
  for (const row of followUps) {
    const recipients = row.counsellorId && activeIds.has(row.counsellorId) ? [row.counsellorId] : ownerIds();
    const scope = row.counsellorId ? '' : ' (unassigned leads)';
    if (Number(row.dueToday) > 0) {
      created += notifyUsers(recipients, { type: 'follow_up_due', title: `${row.dueToday} follow-up${Number(row.dueToday) === 1 ? '' : 's'} due today${scope}`, link: '/leads?followUp=today', dedupeKey: `follow_up_due:${today}:${row.counsellorId ?? 'none'}` });
    }
    if (Number(row.missed) > 0) {
      created += notifyUsers(recipients, { type: 'follow_up_missed', severity: 'warning', title: `${row.missed} missed follow-up${Number(row.missed) === 1 ? '' : 's'}${scope}`, body: 'These leads had a follow-up date in the past and are still open.', link: '/leads?followUp=overdue', dedupeKey: `follow_up_missed:${today}:${row.counsellorId ?? 'none'}` });
    }
  }

  // Students waiting too long without a batch.
  const waitingSince = addDays(today, -Math.max(0, settings.unassignedAlertDays));
  const waiting = db.get<{ n: number }>(sql`
    select count(*) as n from admissions
    where admissions.status in ('pending_payment', 'active') and admissions.admission_date <= ${waitingSince}
      and not exists (select 1 from batch_assignments ba where ba.admission_id = admissions.id and ba.status = 'active')`);
  if (waiting && Number(waiting.n) > 0) {
    created += notifyUsers(usersWithPermission('batches:assign'), {
      type: 'unassigned_student',
      severity: 'warning',
      title: `${waiting.n} student${Number(waiting.n) === 1 ? '' : 's'} waiting ${settings.unassignedAlertDays}+ days for a batch`,
      link: '/batches?tab=queue',
      dedupeKey: `unassigned:${today}`,
    });
  }

  // Batches at or near capacity -- once per threshold per batch.
  const full = db.all<{ id: string; name: string; capacity: number; enrolled: number }>(sql`
    select b.id, b.name, b.capacity, (select count(*) from batch_assignments ba where ba.batch_id = b.id and ba.status = 'active') as enrolled
    from batches b where b.status in ('planned', 'enrolling', 'running')`);
  for (const b of full) {
    const ratio = Number(b.enrolled) / Number(b.capacity);
    if (ratio < 0.9) continue;
    const isFull = ratio >= 1;
    created += notifyUsers(usersWithPermission('batches:read'), {
      type: 'batch_capacity',
      severity: isFull ? 'warning' : 'info',
      title: isFull ? `${b.name} is full (${b.enrolled}/${b.capacity})` : `${b.name} is ${Math.round(ratio * 100)}% full`,
      link: `/batches/${b.id}`,
      entityType: 'batch',
      entityId: b.id,
      dedupeKey: `batch_capacity:${b.id}:${isFull ? 'full' : 'ninety'}`,
    });
  }

  // Interviews in the next 24 hours.
  const soon = db.all<{ id: string; at: number; roundName: string; studentName: string; companyName: string; profileId: string; track: string }>(sql`
    select i.id, i.scheduled_at as at, i.round_name as roundName, s.full_name as studentName, c.name as companyName, pp.id as profileId, pp.track as track
    from interviews i
    join placement_applications pa on pa.id = i.application_id
    join placement_profiles pp on pp.id = pa.profile_id
    join students s on s.id = pa.student_id
    join companies c on c.id = pa.company_id
    where i.result = 'scheduled' and i.scheduled_at >= ${now.getTime()} and i.scheduled_at < ${now.getTime() + 86_400_000}`);
  for (const iv of soon) {
    const when = new Intl.DateTimeFormat(settings.locale, { timeZone: settings.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(Number(iv.at)));
    created += notifyUsers(usersWithPermission('placements:read'), {
      type: 'interview_upcoming',
      title: `${iv.studentName}: ${iv.roundName} with ${iv.companyName}`,
      body: when,
      link: `/placements/${iv.track === 'technical' ? 'technical' : 'non-technical'}?profile=${iv.profileId}`,
      entityType: 'interview',
      entityId: iv.id,
      dedupeKey: `interview:${iv.id}`,
    });
  }

  // Open tasks due today or overdue: one reminder per person per day.
  const tasksDue = db.all<{ userId: string; dueToday: number; overdue: number }>(sql`
    select t.assigned_to_id as userId,
           sum(case when t.due_date = ${today} then 1 else 0 end) as dueToday,
           sum(case when t.due_date < ${today} then 1 else 0 end) as overdue
    from tasks t
    where t.status in ('todo', 'in_progress') and t.assigned_to_id is not null and t.due_date is not null and t.due_date <= ${today}
    group by t.assigned_to_id`);
  for (const row of tasksDue) {
    if (!activeIds.has(row.userId)) continue;
    const parts = [
      Number(row.dueToday) > 0 ? `${row.dueToday} due today` : null,
      Number(row.overdue) > 0 ? `${row.overdue} overdue` : null,
    ].filter(Boolean);
    created += notifyUsers([row.userId], {
      type: 'task_due',
      severity: Number(row.overdue) > 0 ? 'warning' : 'info',
      title: `Tasks: ${parts.join(', ')}`,
      link: Number(row.overdue) > 0 ? '/tasks?overdue=true' : '/tasks',
      dedupeKey: `task_due:${today}:${row.userId}`,
    });
  }

  return { created };
}
