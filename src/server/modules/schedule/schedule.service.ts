/**
 * Class schedule: lectures, practicals, revision and assessment sessions per
 * batch. Times are instants; the "day" of a class is the institute's calendar
 * day. Clashes are refused: a batch cannot have two classes at once, and a
 * trainer cannot teach two batches at once.
 */

import {
  addDays,
  classSessionSchema,
  classSessionStatusSchema,
  classSessionUpdateSchema,
  dateInZone,
  diffDays,
  zonedDayBounds,
  zonedDayStart,
  type ClassSessionDto,
  type scheduleQuerySchema,
} from '@ims/shared';
import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { db } from '../../db';
import { attendanceSessions, batches, classSessions, courses, exams, students, trainers, users, type ClassSession } from '../../db/schema';
import { recordAudit } from '../../services/audit';
import { getSettings } from '../../services/settings';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { assertBatchInScope, batchScope } from '../../utils/scope';
import { notifyUsers, safely } from '../notifications/notifications.service';
import { mapSeries } from '../../utils/series';

const MAX_REPEAT = 200;

function query() {
  return db
    .select({
      s: classSessions,
      batchCode: batches.batchCode,
      batchName: batches.name,
      courseId: courses.id,
      courseName: courses.name,
      trainerName: trainers.name,
      examTitle: exams.title,
    })
    .from(classSessions)
    .innerJoin(batches, eq(batches.id, classSessions.batchId))
    .innerJoin(courses, eq(courses.id, batches.courseId))
    .leftJoin(trainers, eq(trainers.id, classSessions.trainerId))
    .leftJoin(exams, eq(exams.id, classSessions.examId));
}

type Row = Awaited<ReturnType<ReturnType<typeof query>['all']>>[number];

async function toDtos(rows: Row[]): Promise<ClassSessionDto[]> {
  const tz = getSettings().timezone;
  const days = rows.map((r) => ({ batchId: r.s.batchId, date: dateInZone(r.s.startsAt, tz) }));
  const taken = new Set<string>();
  if (days.length) {
    const batchIds = [...new Set(days.map((d) => d.batchId))];
    const dates = [...new Set(days.map((d) => d.date))];
    for (const a of await db.select({ batchId: attendanceSessions.batchId, date: attendanceSessions.date }).from(attendanceSessions).where(and(inArray(attendanceSessions.batchId, batchIds), inArray(attendanceSessions.date, dates))).all()) {
      taken.add(`${a.batchId}|${a.date}`);
    }
  }
  return rows.map((r, i) => ({
    id: r.s.id,
    batchId: r.s.batchId,
    batchCode: r.batchCode,
    batchName: r.batchName,
    courseId: r.courseId,
    courseName: r.courseName,
    trainerId: r.s.trainerId,
    trainerName: r.trainerName,
    title: r.s.title,
    kind: r.s.kind,
    status: r.s.status,
    startsAt: r.s.startsAt.toISOString(),
    endsAt: new Date(r.s.startsAt.getTime() + r.s.durationMinutes * 60_000).toISOString(),
    durationMinutes: r.s.durationMinutes,
    location: r.s.location,
    meetingLink: r.s.meetingLink,
    description: r.s.description,
    examId: r.s.examId,
    examTitle: r.examTitle,
    cancelReason: r.s.cancelReason,
    date: days[i]!.date,
    attendanceTaken: taken.has(`${days[i]!.batchId}|${days[i]!.date}`),
  }));
}

export async function listSessions(ctx: RequestContext, q: z.output<typeof scheduleQuerySchema>, extra?: SQL): Promise<ClassSessionDto[]> {
  if (q.to < q.from) throw ApiError.validation([{ path: 'to', message: 'Must be on or after the start' }]);
  if (diffDays(q.from, q.to) > 400) throw ApiError.validation([{ path: 'to', message: 'Show at most 400 days at a time' }]);
  const { start, end } = zonedDayBounds({ from: q.from, to: q.to }, getSettings().timezone);
  const conditions: (SQL | undefined)[] = [sql`${classSessions.startsAt} >= ${start.getTime()}`, sql`${classSessions.startsAt} < ${end.getTime()}`, await batchScope(ctx, classSessions.batchId), extra];
  if (q.batchId) conditions.push(eq(classSessions.batchId, q.batchId));
  if (q.courseId) conditions.push(eq(batches.courseId, q.courseId));
  if (q.trainerId) conditions.push(eq(classSessions.trainerId, q.trainerId));
  if (q.status?.length) conditions.push(inArray(classSessions.status, q.status));
  return await toDtos(await query().where(and(...conditions)).orderBy(asc(classSessions.startsAt)).limit(2000).all());
}

export async function getSession(ctx: RequestContext, id: string): Promise<ClassSessionDto> {
  const row = await query().where(eq(classSessions.id, id)).get();
  if (!row) throw ApiError.notFound('Class');
  await assertBatchInScope(ctx, row.s.batchId, 'Class');
  return (await toDtos([row]))[0]!;
}

/** The first class that would clash with [start, end) for this batch or trainer. */
async function clash(batchId: string, trainerId: string | null, start: Date, minutes: number, excludeId?: string) {
  const end = start.getTime() + minutes * 60_000;
  const overlap = sql`${classSessions.startsAt} < ${end} and ${classSessions.startsAt} + ${classSessions.durationMinutes} * 60000 > ${start.getTime()}`;
  const who = trainerId ? sql`(${classSessions.batchId} = ${batchId} or ${classSessions.trainerId} = ${trainerId})` : sql`${classSessions.batchId} = ${batchId}`;
  return await query()
    .where(and(overlap, who, ne(classSessions.status, 'cancelled'), excludeId ? ne(classSessions.id, excludeId) : undefined))
    .get();
}

function describeClash(row: Row, sameBatch: boolean): string {
  const when = new Intl.DateTimeFormat(getSettings().locale, { timeZone: getSettings().timezone, dateStyle: 'medium', timeStyle: 'short' }).format(row.s.startsAt);
  return sameBatch ? `${row.batchCode} already has "${row.s.title}" at ${when}.` : `${row.trainerName ?? 'The trainer'} is teaching ${row.batchCode} at ${when}.`;
}

/** Minutes after local midnight of an instant, in the institute zone. */
function localMinutes(instant: Date, tz: string): number {
  return Math.round((instant.getTime() - zonedDayStart(dateInZone(instant, tz), tz).getTime()) / 60_000);
}

export async function createSessions(ctx: RequestContext, raw: unknown): Promise<ClassSessionDto[]> {
  const input = classSessionSchema.parse(raw);
  const batch = await db.select().from(batches).where(eq(batches.id, input.batchId)).get();
  if (!batch) throw ApiError.validation([{ path: 'batchId', message: 'Choose a valid batch' }]);
  await assertBatchInScope(ctx, batch.id);
  if (batch.status === 'completed' || batch.status === 'cancelled') throw ApiError.unprocessable(`${batch.batchCode} is ${batch.status}; classes cannot be added.`, 'BATCH_CLOSED');
  const trainerId = input.trainerId ?? batch.trainerId ?? null;
  // Faculty schedule only themselves.
  if (ctx.accountType === 'faculty' && trainerId !== ctx.trainerId) throw ApiError.forbidden('You can only schedule your own classes.');
  if (input.trainerId && !await db.select({ id: trainers.id }).from(trainers).where(and(eq(trainers.id, input.trainerId), eq(trainers.isActive, true))).get()) {
    throw ApiError.validation([{ path: 'trainerId', message: 'Choose an active trainer' }]);
  }
  if (input.examId) await assertExamFits(input.examId, batch.id, batch.courseId);

  const tz = getSettings().timezone;
  const first = new Date(input.startsAt);
  const starts: Date[] = [first];
  if (input.repeat) {
    const firstDay = dateInZone(first, tz);
    if (input.repeat.until < firstDay) throw ApiError.validation([{ path: 'repeat.until', message: 'Must be on or after the first class' }]);
    if (diffDays(firstDay, input.repeat.until) > 366) throw ApiError.validation([{ path: 'repeat.until', message: 'Repeat for at most a year' }]);
    const minutes = localMinutes(first, tz);
    starts.length = 0;
    for (let day = firstDay; day <= input.repeat.until; day = addDays(day, 1)) {
      if (!input.repeat.weekdays.includes(new Date(`${day}T00:00:00Z`).getUTCDay())) continue;
      const at = new Date(zonedDayStart(day, tz).getTime() + minutes * 60_000);
      if (at.getTime() >= first.getTime()) starts.push(at);
    }
    if (starts.length === 0) throw ApiError.validation([{ path: 'repeat.weekdays', message: 'No class falls on those days in that range' }]);
    if (starts.length > MAX_REPEAT) throw ApiError.validation([{ path: 'repeat.until', message: `That would create ${starts.length} classes; the limit is ${MAX_REPEAT}` }]);
  }
  // Also refuse clashes inside the new set itself (overlapping weekdays cannot, but be safe).
  for (const at of starts) {
    const hit = await clash(batch.id, trainerId, at, input.durationMinutes);
    if (hit) throw ApiError.conflict(describeClash(hit, hit.s.batchId === batch.id), 'SCHEDULE_CLASH');
  }

  const ids = await db.transaction(async (tx) => {
    const created = (await mapSeries(starts,
      async (at) =>
        (await tx
          .insert(classSessions)
          .values({
            batchId: batch.id,
            trainerId,
            title: input.title,
            kind: input.kind,
            startsAt: at,
            durationMinutes: input.durationMinutes,
            location: input.location ?? null,
            meetingLink: input.meetingLink ?? null,
            description: input.description ?? null,
            examId: input.examId ?? null,
            createdById: ctx.actorId || null,
          })
          .returning({ id: classSessions.id })
          .get()).id,
    ));
    await recordAudit(tx, ctx, {
      action: 'create',
      entityType: 'class_session',
      entityId: created[0],
      summary: `Scheduled ${created.length === 1 ? `"${input.title}"` : `${created.length} classes of "${input.title}"`} for ${batch.batchCode}`,
      after: { ...input, count: created.length },
    });
    return created;
  });
  return await toDtos(await query().where(inArray(classSessions.id, ids)).orderBy(asc(classSessions.startsAt)).all());
}

async function assertExamFits(examId: string, batchId: string, courseId: string): Promise<void> {
  const exam = await db.select().from(exams).where(eq(exams.id, examId)).get();
  if (!exam || (exam.batchId && exam.batchId !== batchId) || (exam.courseId && exam.courseId !== courseId)) {
    throw ApiError.validation([{ path: 'examId', message: 'Choose an exam for this batch or its course' }]);
  }
}

async function getRow(ctx: RequestContext, id: string): Promise<ClassSession> {
  const row = await db.select().from(classSessions).where(eq(classSessions.id, id)).get();
  if (!row) throw ApiError.notFound('Class');
  await assertBatchInScope(ctx, row.batchId, 'Class');
  if (ctx.accountType === 'faculty' && row.trainerId !== ctx.trainerId) throw ApiError.forbidden('You can only change your own classes.');
  return row;
}

export async function updateSession(ctx: RequestContext, id: string, raw: unknown): Promise<ClassSessionDto> {
  const existing = await getRow(ctx, id);
  if (existing.status !== 'scheduled') throw ApiError.conflict('Only scheduled classes can be edited.', 'NOT_EDITABLE');
  const input = classSessionUpdateSchema.parse(raw);
  const batch = (await db.select().from(batches).where(eq(batches.id, existing.batchId)).get())!;
  const trainerId = input.trainerId ?? existing.trainerId;
  if (ctx.accountType === 'faculty' && trainerId !== ctx.trainerId) throw ApiError.forbidden('You can only schedule your own classes.');
  if (input.examId) await assertExamFits(input.examId, batch.id, batch.courseId);
  const at = new Date(input.startsAt);
  const hit = await clash(existing.batchId, trainerId, at, input.durationMinutes, id);
  if (hit) throw ApiError.conflict(describeClash(hit, hit.s.batchId === existing.batchId), 'SCHEDULE_CLASH');
  await db.transaction(async (tx) => {
    await tx.update(classSessions)
      .set({ title: input.title, kind: input.kind, startsAt: at, durationMinutes: input.durationMinutes, location: input.location ?? null, meetingLink: input.meetingLink ?? null, description: input.description ?? null, trainerId, examId: input.examId ?? null })
      .where(eq(classSessions.id, id))
      .run();
    await recordAudit(tx, ctx, { action: 'update', entityType: 'class_session', entityId: id, summary: `Updated class "${input.title}" (${batch.batchCode})`, before: { startsAt: existing.startsAt, title: existing.title }, after: input });
  });
  return await getSession(ctx, id);
}

/** Portal logins of the students currently in a batch. */
export async function batchStudentUserIds(batchId: string): Promise<string[]> {
  return (await db
    .select({ userId: students.userId })
    .from(students)
    .innerJoin(users, eq(users.id, students.userId))
    .where(and(eq(users.isActive, true), sql`${students.id} in (select ba.student_id from batch_assignments ba where ba.batch_id = ${batchId} and ba.status = 'active')`))
    .all())
    .map((r) => r.userId!)
    .filter(Boolean);
}

export async function setSessionStatus(ctx: RequestContext, id: string, raw: unknown): Promise<ClassSessionDto> {
  const existing = await getRow(ctx, id);
  const input = classSessionStatusSchema.parse(raw);
  if (existing.status === input.status) return await getSession(ctx, id);
  if (existing.status === 'cancelled' && input.status === 'completed') throw ApiError.conflict('A cancelled class cannot be marked completed.', 'INVALID_TRANSITION');
  await db.transaction(async (tx) => {
    await tx.update(classSessions)
      .set({ status: input.status, cancelReason: input.status === 'cancelled' ? (input.cancelReason ?? null) : null })
      .where(eq(classSessions.id, id))
      .run();
    await recordAudit(tx, ctx, { action: 'status_change', entityType: 'class_session', entityId: id, summary: `Class "${existing.title}": ${existing.status} → ${input.status}${input.cancelReason ? ` (${input.cancelReason})` : ''}`, before: { status: existing.status }, after: input });
  });
  const dto = await getSession(ctx, id);
  if (input.status === 'cancelled' && existing.startsAt.getTime() > Date.now()) {
    await safely('class_cancelled', async () => {
      const when = new Intl.DateTimeFormat(getSettings().locale, { timeZone: getSettings().timezone, dateStyle: 'medium', timeStyle: 'short' }).format(existing.startsAt);
      await notifyUsers(await batchStudentUserIds(existing.batchId), {
        type: 'class_scheduled',
        severity: 'warning',
        title: `Class cancelled: ${existing.title} (${when})`,
        body: input.cancelReason ?? null,
        link: '/portal/classes',
        entityType: 'class_session',
        entityId: id,
        dedupeKey: `class_cancelled:${id}`,
      });
    });
  }
  return dto;
}
