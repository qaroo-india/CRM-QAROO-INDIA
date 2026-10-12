/**
 * Trainers, batches, the assignment queue and transfers.
 *
 * Rules:
 *   - A student joins only a batch of their own course.
 *   - A full batch refuses assignment. Only the owner may override, and the
 *     override is recorded in the audit trail ("do not assign students
 *     automatically to a full batch").
 *   - An admission sits in at most one batch at a time (unique index); a
 *     transfer closes the old assignment and opens a new one, so the full
 *     path a student took is kept.
 */

import {
  BATCH_ASSIGNABLE_STATUSES,
  assignSchema,
  batchListQuerySchema,
  batchSchema,
  diffDays,
  queueQuerySchema,
  queueStatusSchema,
  trainerSchema,
  transferSchema,
  type AssignmentDto,
  type BatchDetail,
  type BatchDto,
  type QueueItem,
  type TrainerDto,
} from '@ims/shared';
import { and, asc, count, desc, eq, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';
import { db } from '../../db';
import { qualified } from '../../db/dialect';
import { admissions, batchAssignments, batches, courses, students, trainers, users, type Batch } from '../../db/schema';
import type { DbLike } from '../../db/types';
import { diff, recordAudit } from '../../services/audit';
import { instituteToday } from '../../services/clock';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { containsText, pageWindow, paginated } from '../../utils/pagination';
import { admissionHooks } from '../admissions/hooks';

const B_ID = qualified('batches', 'id');
const enrolledExpr = sql<number>`(select count(*) from batch_assignments ba where ba.batch_id = ${B_ID} and ba.status = 'active')`;
const assigner = alias(users, 'assigner');

/* ------------------------------------------------------------------ *
 * Trainers
 * ------------------------------------------------------------------ */

export function listTrainers(): TrainerDto[] {
  const T_ID = qualified('trainers', 'id');
  return db
    .select({
      trainer: trainers,
      activeBatches: sql<number>`(select count(*) from batches b where b.trainer_id = ${T_ID} and b.status in ('planned', 'enrolling', 'running'))`.mapWith(Number),
      portalActive: sql<number | null>`(select u.is_active from users u where u.id = ${qualified('trainers', 'user_id')})`,
      portalLastLogin: sql<number | null>`(select u.last_login_at from users u where u.id = ${qualified('trainers', 'user_id')})`,
    })
    .from(trainers)
    .orderBy(desc(trainers.isActive), asc(trainers.name))
    .all()
    .map(({ trainer: t, activeBatches, portalActive, portalLastLogin }) => ({
      id: t.id,
      name: t.name,
      email: t.email,
      phone: t.phone,
      expertise: t.expertise,
      isActive: t.isActive,
      activeBatches,
      portal: t.userId ? { userId: t.userId, isActive: Boolean(Number(portalActive)), lastLoginAt: portalLastLogin ? new Date(Number(portalLastLogin)).toISOString() : null } : null,
    }));
}

export function saveTrainer(ctx: RequestContext, raw: unknown, id?: string): TrainerDto[] {
  const input = trainerSchema.parse(raw);
  const values = { name: input.name, email: input.email ?? null, phone: input.phone ?? null, expertise: input.expertise ?? null, isActive: input.isActive };
  db.transaction((tx) => {
    if (id) {
      const existing = tx.select().from(trainers).where(eq(trainers.id, id)).get();
      if (!existing) throw ApiError.notFound('Trainer');
      const updated = tx.update(trainers).set(values).where(eq(trainers.id, id)).returning().get();
      recordAudit(tx, ctx, { action: 'update', entityType: 'trainer', entityId: id, summary: `Updated trainer ${updated.name}`, ...diff(existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>) });
    } else {
      const row = tx.insert(trainers).values(values).returning().get();
      recordAudit(tx, ctx, { action: 'create', entityType: 'trainer', entityId: row.id, summary: `Added trainer ${row.name}`, after: row });
    }
  });
  return listTrainers();
}

/* ------------------------------------------------------------------ *
 * Batches
 * ------------------------------------------------------------------ */

function batchQuery(database: DbLike = db) {
  return database
    .select({ batch: batches, courseName: courses.name, trainerName: trainers.name, enrolled: enrolledExpr.mapWith(Number) })
    .from(batches)
    .innerJoin(courses, eq(courses.id, batches.courseId))
    .leftJoin(trainers, eq(trainers.id, batches.trainerId));
}

type BatchRow = Awaited<ReturnType<ReturnType<typeof batchQuery>['all']>>[number];

function toBatchDto({ batch: b, courseName, trainerName, enrolled }: BatchRow): BatchDto {
  return {
    id: b.id,
    batchCode: b.batchCode,
    name: b.name,
    courseId: b.courseId,
    courseName,
    trainerId: b.trainerId,
    trainerName,
    startDate: b.startDate,
    endDate: b.endDate,
    capacity: b.capacity,
    enrolled,
    seatsLeft: Math.max(0, b.capacity - enrolled),
    schedule: b.schedule,
    status: b.status,
    notes: b.notes,
  };
}

export function listBatches(q: z.output<typeof batchListQuerySchema>, scope?: SQL) {
  const conditions: SQL[] = scope ? [scope] : [];
  if (q.q) conditions.push(or(containsText(batches.name, q.q), containsText(batches.batchCode, q.q))!);
  if (q.courseId) conditions.push(eq(batches.courseId, q.courseId));
  if (q.trainerId) conditions.push(eq(batches.trainerId, q.trainerId));
  if (q.status?.length) conditions.push(inArray(batches.status, q.status));
  const where = and(...conditions);
  const total = db.select({ n: count() }).from(batches).where(where).get()?.n ?? 0;
  const { limit, offset } = pageWindow(q.page, q.limit);
  const rows = batchQuery().where(where).orderBy(q.order === 'asc' ? asc(batches.startDate) : desc(batches.startDate)).limit(limit).offset(offset).all();
  return paginated(rows.map(toBatchDto), total, q.page, q.limit);
}

function assignmentQuery(database: DbLike = db) {
  return database
    .select({
      a: batchAssignments,
      admissionNumber: admissions.admissionNumber,
      studentName: students.fullName,
      studentCode: students.studentCode,
      studentPhone: students.phone,
      batchCode: batches.batchCode,
      batchName: batches.name,
      assignedByName: assigner.name,
    })
    .from(batchAssignments)
    .innerJoin(admissions, eq(admissions.id, batchAssignments.admissionId))
    .innerJoin(students, eq(students.id, batchAssignments.studentId))
    .innerJoin(batches, eq(batches.id, batchAssignments.batchId))
    .leftJoin(assigner, eq(assigner.id, batchAssignments.assignedById));
}

type AssignmentRow = Awaited<ReturnType<ReturnType<typeof assignmentQuery>['all']>>[number];

function toAssignmentDto(r: AssignmentRow): AssignmentDto {
  return {
    id: r.a.id,
    admissionId: r.a.admissionId,
    admissionNumber: r.admissionNumber,
    studentId: r.a.studentId,
    studentName: r.studentName,
    studentCode: r.studentCode,
    studentPhone: r.studentPhone,
    batchId: r.a.batchId,
    batchCode: r.batchCode,
    batchName: r.batchName,
    status: r.a.status,
    assignedOn: r.a.assignedOn,
    endedOn: r.a.endedOn,
    reason: r.a.reason,
    transferredToId: r.a.transferredToId,
    assignedByName: r.assignedByName,
  };
}

export function getBatch(id: string): BatchDetail {
  const row = batchQuery().where(eq(batches.id, id)).get();
  if (!row) throw ApiError.notFound('Batch');
  const all = assignmentQuery().where(eq(batchAssignments.batchId, id)).orderBy(asc(students.fullName)).all().map(toAssignmentDto);
  return { ...toBatchDto(row), roster: all.filter((a) => a.status === 'active'), history: all.filter((a) => a.status !== 'active') };
}

export function assignmentsForAdmissions(admissionIds: string[]): AssignmentDto[] {
  if (admissionIds.length === 0) return [];
  return assignmentQuery().where(inArray(batchAssignments.admissionId, admissionIds)).orderBy(desc(batchAssignments.assignedOn), desc(batchAssignments.createdAt)).all().map(toAssignmentDto);
}

function assertBatchCodeFree(code: string, exceptId?: string): void {
  const clash = db.select({ id: batches.id }).from(batches).where(and(sql`upper(${batches.batchCode}) = ${code.toUpperCase()}`, exceptId ? ne(batches.id, exceptId) : undefined)).get();
  if (clash) throw ApiError.conflict(`A batch with code ${code} already exists.`);
}

export function saveBatch(ctx: RequestContext, raw: unknown, id?: string): BatchDetail {
  const input = batchSchema.parse(raw);
  assertBatchCodeFree(input.batchCode, id);
  if (!db.select({ id: courses.id }).from(courses).where(eq(courses.id, input.courseId)).get()) throw ApiError.validation([{ path: 'courseId', message: 'Choose a valid course' }]);
  if (input.trainerId && !db.select({ id: trainers.id }).from(trainers).where(eq(trainers.id, input.trainerId)).get()) {
    throw ApiError.validation([{ path: 'trainerId', message: 'Choose a valid trainer' }]);
  }
  const values = { ...input, schedule: input.schedule ?? null, notes: input.notes ?? null };

  const batchId = db.transaction((tx) => {
    if (id) {
      const existing = tx.select().from(batches).where(eq(batches.id, id)).get();
      if (!existing) throw ApiError.notFound('Batch');
      if (existing.courseId !== input.courseId) {
        const enrolled = tx.select({ n: count() }).from(batchAssignments).where(eq(batchAssignments.batchId, id)).get()?.n ?? 0;
        if (enrolled > 0) throw ApiError.conflict('The course of a batch with students cannot change.');
      }
      const active = tx.select({ n: count() }).from(batchAssignments).where(and(eq(batchAssignments.batchId, id), eq(batchAssignments.status, 'active'))).get()?.n ?? 0;
      if (input.capacity < active) throw ApiError.validation([{ path: 'capacity', message: `${active} students are already assigned` }]);
      const updated = tx.update(batches).set(values).where(eq(batches.id, id)).returning().get();
      recordAudit(tx, ctx, { action: 'update', entityType: 'batch', entityId: id, summary: `Updated batch ${updated.batchCode}`, ...diff(existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>) });
      return id;
    }
    const row = tx.insert(batches).values({ ...values, createdById: ctx.actorId || null }).returning().get();
    recordAudit(tx, ctx, { action: 'create', entityType: 'batch', entityId: row.id, summary: `Created batch ${row.batchCode} ${row.name}`, after: row });
    return row.id;
  });
  return getBatch(batchId);
}

/* ------------------------------------------------------------------ *
 * Assignment and transfer
 * ------------------------------------------------------------------ */

function capacityCheck(tx: DbLike, batch: Batch, adding: number, ctx: RequestContext, override: boolean): void {
  const active = tx.select({ n: count() }).from(batchAssignments).where(and(eq(batchAssignments.batchId, batch.id), eq(batchAssignments.status, 'active'))).get()?.n ?? 0;
  if (active + adding <= batch.capacity) return;
  if (override && ctx.isOwner) return;
  throw ApiError.conflict(
    `${batch.batchCode} has ${Math.max(0, batch.capacity - active)} seat(s) left; ${adding} requested.${ctx.isOwner ? ' Confirm the override to exceed capacity.' : ''}`,
    'BATCH_FULL',
  );
}

export function assignToBatch(ctx: RequestContext, raw: unknown): BatchDetail {
  const input = assignSchema.parse(raw);
  db.transaction((tx) => {
    const batch = tx.select().from(batches).where(eq(batches.id, input.batchId)).get();
    if (!batch) throw ApiError.notFound('Batch');
    if (!(BATCH_ASSIGNABLE_STATUSES as readonly string[]).includes(batch.status)) {
      throw ApiError.unprocessable(`${batch.batchCode} is ${batch.status}; it is not taking students.`, 'BATCH_CLOSED');
    }
    const targets = tx.select().from(admissions).where(inArray(admissions.id, input.admissionIds)).all();
    if (targets.length !== input.admissionIds.length) throw ApiError.notFound('One or more admissions');
    for (const a of targets) {
      if (a.courseId !== batch.courseId) throw ApiError.unprocessable(`${a.admissionNumber} is for a different course than ${batch.batchCode}.`, 'COURSE_MISMATCH');
      if (!['pending_payment', 'active'].includes(a.status)) throw ApiError.unprocessable(`${a.admissionNumber} is ${a.status.replace(/_/g, ' ')}.`, 'ADMISSION_NOT_LIVE');
      const current = tx.select({ id: batchAssignments.id }).from(batchAssignments).where(and(eq(batchAssignments.admissionId, a.id), eq(batchAssignments.status, 'active'))).get();
      if (current) throw ApiError.conflict(`${a.admissionNumber} is already in a batch; transfer it instead.`, 'ALREADY_ASSIGNED');
    }
    capacityCheck(tx, batch, targets.length, ctx, input.allowOverCapacity);

    for (const a of targets) {
      tx.insert(batchAssignments).values({ admissionId: a.id, studentId: a.studentId, batchId: batch.id, assignedOn: input.assignedOn, assignedById: ctx.actorId || null }).run();
      tx.update(admissions).set({ batchStatus: 'assigned' }).where(eq(admissions.id, a.id)).run();
    }
    recordAudit(tx, ctx, {
      action: 'create',
      entityType: 'batch_assignment',
      entityId: batch.id,
      summary: `Assigned ${targets.length} student(s) to ${batch.batchCode}${input.allowOverCapacity && ctx.isOwner ? ' (capacity override)' : ''}`,
      after: { admissionIds: input.admissionIds, overCapacity: input.allowOverCapacity },
    });
  });
  return getBatch(input.batchId);
}

export function transferAssignment(ctx: RequestContext, assignmentId: string, raw: unknown, allowOverCapacity = false): BatchDetail {
  const input = transferSchema.parse(raw);
  db.transaction((tx) => {
    const current = tx.select().from(batchAssignments).where(eq(batchAssignments.id, assignmentId)).get();
    if (!current) throw ApiError.notFound('Assignment');
    if (current.status !== 'active') throw ApiError.conflict('Only an active assignment can be transferred.');
    if (current.batchId === input.toBatchId) throw ApiError.unprocessable('The student is already in that batch.');
    const from = tx.select().from(batches).where(eq(batches.id, current.batchId)).get()!;
    const to = tx.select().from(batches).where(eq(batches.id, input.toBatchId)).get();
    if (!to) throw ApiError.notFound('Batch');
    if (to.courseId !== from.courseId) throw ApiError.unprocessable('Transfers must stay within the same course.', 'COURSE_MISMATCH');
    if (!(BATCH_ASSIGNABLE_STATUSES as readonly string[]).includes(to.status)) throw ApiError.unprocessable(`${to.batchCode} is not taking students.`, 'BATCH_CLOSED');
    if (input.date < current.assignedOn) throw ApiError.validation([{ path: 'date', message: 'Cannot be before the current assignment started' }]);
    capacityCheck(tx, to, 1, ctx, allowOverCapacity);

    // Close first: the unique "one active assignment" index forbids two at once.
    tx.update(batchAssignments).set({ status: 'transferred_out', endedOn: input.date, reason: input.reason }).where(eq(batchAssignments.id, current.id)).run();
    const next = tx
      .insert(batchAssignments)
      .values({ admissionId: current.admissionId, studentId: current.studentId, batchId: to.id, assignedOn: input.date, reason: `Transferred from ${from.batchCode}: ${input.reason}`, assignedById: ctx.actorId || null })
      .returning()
      .get();
    tx.update(batchAssignments).set({ transferredToId: next.id }).where(eq(batchAssignments.id, current.id)).run();
    recordAudit(tx, ctx, { action: 'update', entityType: 'batch_assignment', entityId: next.id, summary: `Transferred a student from ${from.batchCode} to ${to.batchCode}: ${input.reason}` });
  });
  // The destination batch, where the student now sits.
  return getBatch(input.toBatchId);
}

/* ------------------------------------------------------------------ *
 * Queue
 * ------------------------------------------------------------------ */

export function batchQueue(q: z.output<typeof queueQuerySchema>) {
  const conditions: SQL[] = [
    inArray(admissions.status, ['pending_payment', 'active']),
    sql`not exists (select 1 from batch_assignments ba where ba.admission_id = ${qualified('admissions', 'id')} and ba.status = 'active')`,
  ];
  if (q.courseId) conditions.push(eq(admissions.courseId, q.courseId));
  if (q.batchStatus) conditions.push(eq(admissions.batchStatus, q.batchStatus));
  if (q.q) conditions.push(or(containsText(students.fullName, q.q), containsText(admissions.admissionNumber, q.q), containsText(students.phone, q.q))!);
  const where = and(...conditions);

  const total = db.select({ n: count() }).from(admissions).innerJoin(students, eq(students.id, admissions.studentId)).where(where).get()?.n ?? 0;
  const { limit, offset } = pageWindow(q.page, q.limit);
  const rows = db
    .select({ a: admissions, studentName: students.fullName, studentPhone: students.phone, courseName: courses.name })
    .from(admissions)
    .innerJoin(students, eq(students.id, admissions.studentId))
    .innerJoin(courses, eq(courses.id, admissions.courseId))
    .where(where)
    .orderBy(asc(admissions.admissionDate))
    .limit(limit)
    .offset(offset)
    .all();

  const today = instituteToday();
  const courseIds = [...new Set(rows.map((r) => r.a.courseId))];
  const open = courseIds.length
    ? batchQuery()
        .where(and(inArray(batches.courseId, courseIds), inArray(batches.status, [...BATCH_ASSIGNABLE_STATUSES])))
        .orderBy(asc(batches.startDate))
        .all()
        .map(toBatchDto)
    : [];

  const items: QueueItem[] = rows.map((r) => ({
    admissionId: r.a.id,
    admissionNumber: r.a.admissionNumber,
    studentId: r.a.studentId,
    studentName: r.studentName,
    studentPhone: r.studentPhone,
    courseId: r.a.courseId,
    courseName: r.courseName,
    admissionDate: r.a.admissionDate,
    admissionStatus: r.a.status,
    batchStatus: r.a.batchStatus,
    daysWaiting: Math.max(0, diffDays(r.a.admissionDate, today)),
    openBatches: open.filter((b) => b.courseId === r.a.courseId && b.seatsLeft > 0).map((b) => ({ id: b.id, batchCode: b.batchCode, name: b.name, startDate: b.startDate, seatsLeft: b.seatsLeft })),
  }));
  return paginated(items, total, q.page, q.limit);
}

export function setQueueStatus(ctx: RequestContext, admissionId: string, raw: unknown): void {
  const { batchStatus } = queueStatusSchema.parse(raw);
  db.transaction((tx) => {
    const a = tx.select().from(admissions).where(eq(admissions.id, admissionId)).get();
    if (!a) throw ApiError.notFound('Admission');
    const active = tx.select({ id: batchAssignments.id }).from(batchAssignments).where(and(eq(batchAssignments.admissionId, admissionId), eq(batchAssignments.status, 'active'))).get();
    if (active) throw ApiError.conflict('This student is already in a batch.');
    tx.update(admissions).set({ batchStatus }).where(eq(admissions.id, admissionId)).run();
    recordAudit(tx, ctx, { action: 'status_change', entityType: 'admission', entityId: admissionId, summary: `Batch queue status for ${a.admissionNumber}: ${batchStatus.replace(/_/g, ' ')}` });
  });
}

/* ------------------------------------------------------------------ *
 * Admission lifecycle
 * ------------------------------------------------------------------ */

admissionHooks.registerOnStatusChanged((tx, _ctx, _before, after, date) => {
  if (after.status === 'completed') {
    tx.update(batchAssignments).set({ status: 'completed', endedOn: date }).where(and(eq(batchAssignments.admissionId, after.id), eq(batchAssignments.status, 'active'))).run();
  }
  if (after.status === 'withdrawn' || after.status === 'cancelled') {
    tx.update(batchAssignments).set({ status: 'dropped', endedOn: date, reason: `Admission ${after.status}` }).where(and(eq(batchAssignments.admissionId, after.id), eq(batchAssignments.status, 'active'))).run();
  }
});
