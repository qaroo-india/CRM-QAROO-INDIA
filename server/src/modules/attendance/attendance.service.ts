/**
 * Attendance: one register per batch per calendar day.
 *
 * The roster for a day comes from the batch ASSIGNMENT history, so a student
 * who joined late or transferred out appears only on the days they belonged
 * to the batch. Percent = (present + late + on duty) / (marked days - holidays).
 */

import {
  attendanceSaveSchema,
  type AttendanceRosterDto,
  type AttendanceRosterRow,
  type AttendanceSessionDto,
  type AttendanceSummaryRow,
  type attendanceQuerySchema,
} from '@ims/shared';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { db } from '../../db';
import { attendanceRecords, attendanceSessions, batches, classSessions, courses, users } from '../../db/schema';
import { recordAudit } from '../../services/audit';
import { instituteToday } from '../../services/clock';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { assertBatchInScope, batchScope } from '../../utils/scope';

interface Counts {
  sessions: number;
  present: number;
  late: number;
  onDuty: number;
  absent: number;
  holiday: number;
}

export function percentOf(c: Counts): number | null {
  const denominator = c.sessions - c.holiday;
  return denominator > 0 ? (c.present + c.late + c.onDuty) / denominator : null;
}

const COUNT_COLUMNS = sql`
  count(*) as sessions,
  coalesce(sum(case when ar.status = 'present' then 1 else 0 end), 0) as present,
  coalesce(sum(case when ar.status = 'late' then 1 else 0 end), 0) as late,
  coalesce(sum(case when ar.status = 'on_duty' then 1 else 0 end), 0) as onDuty,
  coalesce(sum(case when ar.status = 'absent' then 1 else 0 end), 0) as absent,
  coalesce(sum(case when ar.status = 'holiday' then 1 else 0 end), 0) as holiday`;

const toCounts = (r: Record<string, unknown>): Counts => ({
  sessions: Number(r.sessions ?? 0),
  present: Number(r.present ?? 0),
  late: Number(r.late ?? 0),
  onDuty: Number(r.onDuty ?? 0),
  absent: Number(r.absent ?? 0),
  holiday: Number(r.holiday ?? 0),
});

/** Counts per admission, optionally limited to one batch and a date range. */
export async function countsByAdmission(filter: { batchId?: string; admissionIds?: string[]; from?: string; to?: string }): Promise<Map<string, Counts>> {
  const parts: SQL[] = [];
  if (filter.batchId) parts.push(sql` and s.batch_id = ${filter.batchId}`);
  if (filter.from) parts.push(sql` and s.date >= ${filter.from}`);
  if (filter.to) parts.push(sql` and s.date <= ${filter.to}`);
  if (filter.admissionIds) {
    if (filter.admissionIds.length === 0) return new Map();
    parts.push(sql` and ar.admission_id in (${sql.join(filter.admissionIds.map((id) => sql`${id}`), sql`, `)})`);
  }
  const rows = await db.all<Record<string, unknown> & { admissionId: string }>(sql`
    select ar.admission_id as admissionId, ${COUNT_COLUMNS}
    from attendance_records ar join attendance_sessions s on s.id = ar.attendance_session_id
    where 1 = 1${sql.join(parts, sql``)}
    group by ar.admission_id`);
  return new Map(rows.map((r) => [r.admissionId, toCounts(r)]));
}

/** Students who belonged to the batch on `date`, by assignment history. */
async function rosterFor(batchId: string, date: string) {
  return await db.all<{ admissionId: string; studentId: string; studentName: string; studentCode: string }>(sql`
    select distinct ba.admission_id as admissionId, ba.student_id as studentId, s.full_name as studentName, s.student_code as studentCode
    from batch_assignments ba
    join students s on s.id = ba.student_id
    where ba.batch_id = ${batchId}
      and ba.assigned_on <= ${date}
      and (ba.ended_on is null or ba.ended_on > ${date} or (ba.status = 'completed' and ba.ended_on = ${date}))
    order by s.full_name`);
}

async function batchOrThrow(ctx: RequestContext, batchId: string) {
  const batch = await db
    .select({ b: batches, courseName: courses.name })
    .from(batches)
    .innerJoin(courses, eq(courses.id, batches.courseId))
    .where(eq(batches.id, batchId))
    .get();
  if (!batch) throw ApiError.notFound('Batch');
  await assertBatchInScope(ctx, batchId);
  return batch;
}

export async function getRoster(ctx: RequestContext, batchId: string, date: string): Promise<AttendanceRosterDto> {
  const { b, courseName } = await batchOrThrow(ctx, batchId);
  const session = await db
    .select({ s: attendanceSessions, takenByName: users.name })
    .from(attendanceSessions)
    .leftJoin(users, eq(users.id, attendanceSessions.takenById))
    .where(and(eq(attendanceSessions.batchId, batchId), eq(attendanceSessions.date, date)))
    .get();
  const marks = session ? new Map((await db.select().from(attendanceRecords).where(eq(attendanceRecords.attendanceSessionId, session.s.id)).all()).map((r) => [r.admissionId, r])) : new Map();
  const roster = await rosterFor(batchId, date);
  // Anyone marked that day but no longer on the roster (history edited) still shows.
  for (const [admissionId, r] of marks) {
    if (!roster.some((x) => x.admissionId === admissionId)) {
      const extra = await db.get<{ studentName: string; studentCode: string }>(sql`select full_name as studentName, student_code as studentCode from students where id = ${r.studentId}`);
      roster.push({ admissionId, studentId: r.studentId, studentName: extra?.studentName ?? 'Student', studentCode: extra?.studentCode ?? '' });
    }
  }
  const counts = await countsByAdmission({ batchId, admissionIds: roster.map((r) => r.admissionId) });
  const rows: AttendanceRosterRow[] = roster.map((r) => {
    const mark = marks.get(r.admissionId);
    const c = counts.get(r.admissionId);
    return { ...r, status: mark?.status ?? null, minutesLate: mark?.minutesLate ?? 0, remark: mark?.remark ?? null, percent: c ? percentOf(c) : null };
  });
  return {
    batch: { id: b.id, batchCode: b.batchCode, name: b.name, courseName, startDate: b.startDate, endDate: b.endDate },
    date,
    sessionId: session?.s.id ?? null,
    topic: session?.s.topic ?? null,
    classSessionId: session?.s.classSessionId ?? null,
    takenByName: session?.takenByName ?? null,
    updatedAt: session?.s.updatedAt.toISOString() ?? null,
    rows,
  };
}

export async function saveAttendance(ctx: RequestContext, raw: unknown): Promise<AttendanceRosterDto> {
  const input = attendanceSaveSchema.parse(raw);
  const { b } = await batchOrThrow(ctx, input.batchId);
  if (input.date > instituteToday()) throw ApiError.validation([{ path: 'date', message: 'Attendance cannot be marked for a future day' }]);
  if (input.date < b.startDate) throw ApiError.validation([{ path: 'date', message: `${b.batchCode} starts on ${b.startDate}` }]);
  if (input.classSessionId) {
    const cs = await db.select({ batchId: classSessions.batchId }).from(classSessions).where(eq(classSessions.id, input.classSessionId)).get();
    if (!cs || cs.batchId !== b.id) throw ApiError.validation([{ path: 'classSessionId', message: 'That class is not in this batch' }]);
  }
  const roster = new Map((await rosterFor(b.id, input.date)).map((r) => [r.admissionId, r]));
  const outsiders = input.records.filter((r) => !roster.has(r.admissionId));
  if (outsiders.length) throw ApiError.validation([{ path: 'records', message: `${outsiders.length} of the students were not in ${b.batchCode} on ${input.date}` }]);
  const seen = new Set<string>();
  for (const r of input.records) {
    if (seen.has(r.admissionId)) throw ApiError.validation([{ path: 'records', message: 'A student is listed twice' }]);
    seen.add(r.admissionId);
  }

  await db.transaction(async (tx) => {
    const existing = await tx.select().from(attendanceSessions).where(and(eq(attendanceSessions.batchId, b.id), eq(attendanceSessions.date, input.date))).get();
    const sessionId = existing
      ? (await tx
          .update(attendanceSessions)
          .set({ topic: input.topic ?? existing.topic, classSessionId: input.classSessionId ?? existing.classSessionId, takenById: ctx.actorId || null })
          .where(eq(attendanceSessions.id, existing.id))
          .returning({ id: attendanceSessions.id })
          .get()).id
      : (await tx
          .insert(attendanceSessions)
          .values({ batchId: b.id, date: input.date, topic: input.topic ?? null, classSessionId: input.classSessionId ?? null, takenById: ctx.actorId || null })
          .returning({ id: attendanceSessions.id })
          .get()).id;
    for (const r of input.records) {
      const minutesLate = r.status === 'late' ? r.minutesLate : 0;
      await tx.insert(attendanceRecords)
        .values({ attendanceSessionId: sessionId, admissionId: r.admissionId, studentId: roster.get(r.admissionId)!.studentId, status: r.status, minutesLate, remark: r.remark ?? null })
        .onConflictDoUpdate({ target: [attendanceRecords.attendanceSessionId, attendanceRecords.admissionId], set: { status: r.status, minutesLate, remark: r.remark ?? null, updatedAt: new Date() } })
        .run();
    }
    const tally = input.records.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
    await recordAudit(tx, ctx, {
      action: existing ? 'update' : 'create',
      entityType: 'attendance',
      entityId: sessionId,
      summary: `${existing ? 'Updated' : 'Took'} attendance for ${b.batchCode} on ${input.date}: ${Object.entries(tally).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(', ')}`,
    });
  });
  return await getRoster(ctx, b.id, input.date);
}

export async function listAttendanceSessions(ctx: RequestContext, q: z.output<typeof attendanceQuerySchema>): Promise<AttendanceSessionDto[]> {
  await batchOrThrow(ctx, q.batchId);
  const range = sql.join([q.from ? sql` and s.date >= ${q.from}` : sql``, q.to ? sql` and s.date <= ${q.to}` : sql``], sql``);
  const rows = await db.all<Record<string, unknown> & { id: string; batchId: string; batchCode: string; date: string; topic: string | null; takenByName: string | null }>(sql`
    select s.id, s.batch_id as batchId, b.batch_code as batchCode, s.date, s.topic, u.name as takenByName, ${COUNT_COLUMNS}
    from attendance_sessions s
    join batches b on b.id = s.batch_id
    left join users u on u.id = s.taken_by_id
    left join attendance_records ar on ar.attendance_session_id = s.id
    where s.batch_id = ${q.batchId}${range}
    group by s.id
    order by s.date desc`);
  return rows.map((r) => {
    const c = toCounts(r);
    return { id: r.id, batchId: r.batchId, batchCode: r.batchCode, date: r.date, topic: r.topic, takenByName: r.takenByName, present: c.present, late: c.late, onDuty: c.onDuty, absent: c.absent, holiday: c.holiday, total: c.present + c.late + c.onDuty + c.absent + c.holiday };
  });
}

export async function attendanceSummary(ctx: RequestContext, q: z.output<typeof attendanceQuerySchema>): Promise<AttendanceSummaryRow[]> {
  await batchOrThrow(ctx, q.batchId);
  const counts = await countsByAdmission({ batchId: q.batchId, from: q.from, to: q.to });
  // Everyone ever assigned to the batch, plus anyone with marks in it.
  const people = await db.all<{ admissionId: string; studentId: string; studentName: string; studentCode: string }>(sql`
    select distinct a.id as admissionId, a.student_id as studentId, s.full_name as studentName, s.student_code as studentCode
    from admissions a join students s on s.id = a.student_id
    where a.id in (select admission_id from batch_assignments where batch_id = ${q.batchId})
       or a.id in (select ar.admission_id from attendance_records ar join attendance_sessions x on x.id = ar.attendance_session_id where x.batch_id = ${q.batchId})
    order by s.full_name`);
  return people.map((p) => {
    const c = counts.get(p.admissionId) ?? { sessions: 0, present: 0, late: 0, onDuty: 0, absent: 0, holiday: 0 };
    return { ...p, ...c, percent: percentOf(c) };
  });
}

/** For listing pages: batches the caller may take attendance for. */
export async function scopedBatchCondition(ctx: RequestContext) {
  return await batchScope(ctx, batches.id);
}
