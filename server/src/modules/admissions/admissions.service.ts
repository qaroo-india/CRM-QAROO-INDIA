/**
 * Admissions: the hub joining a student, a course, a fee and (optionally) the
 * lead it came from.
 *
 * Creating one is a single synchronous transaction: student (matched or
 * created), admission number, lead conversion, timeline and audit entries all
 * commit together or not at all. An Idempotency-Key makes a double-clicked or
 * retried submission return the first admission instead of creating two.
 *
 * Lifecycle:
 *   pending_payment --activate--> active --complete--> completed
 *   pending_payment|active --withdraw--> withdrawn   (balance optionally written off)
 *   pending_payment|active --cancel--> cancelled     (only if no money was received)
 */

import {
  normalisePhone,
  type AdmissionDto,
  admissionCreateSchema,
  admissionListQuerySchema,
  admissionStatusChangeSchema,
  admissionUpdateSchema,
} from '@ims/shared';
import { and, asc, count, desc, eq, inArray, isNull, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';
import { db } from '../../db';
import {
  admissions,
  courses,
  feeAdjustments,
  leads,
  leadSources,
  students,
  users,
  type Admission,
} from '../../db/schema';
import type { DbLike, Tx } from '../../db/types';
import { diff, recordAudit } from '../../services/audit';
import { instituteToday } from '../../services/clock';
import { findDuplicateStudents } from '../../services/duplicates';
import { financeColumns, outstandingExpr } from '../../services/ledger';
import { nextCode } from '../../services/sequences';
import { getSettings } from '../../services/settings';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { containsText, pageWindow, paginated } from '../../utils/pagination';
import { markLeadConverted } from '../leads/leads.service';
import { admissionHooks } from './hooks';

const counsellor = alias(users, 'adm_counsellor');

export function admissionQuery(database: DbLike = db, asOf?: string) {
  return database
    .select({
      admission: admissions,
      studentName: students.fullName,
      studentCode: students.studentCode,
      studentPhone: students.phone,
      courseName: courses.name,
      courseCode: courses.code,
      counsellorName: counsellor.name,
      sourceName: leadSources.name,
      ...financeColumns(instituteToday(), asOf),
    })
    .from(admissions)
    .innerJoin(students, eq(students.id, admissions.studentId))
    .innerJoin(courses, eq(courses.id, admissions.courseId))
    .leftJoin(counsellor, eq(counsellor.id, admissions.counsellorId))
    .leftJoin(leadSources, eq(leadSources.id, admissions.attributedSourceId));
}

type AdmissionRow = Awaited<ReturnType<ReturnType<typeof admissionQuery>['all']>>[number];

export function toAdmissionDto(row: AdmissionRow): AdmissionDto {
  const a = row.admission;
  return {
    id: a.id,
    admissionNumber: a.admissionNumber,
    studentId: a.studentId,
    studentName: row.studentName,
    studentCode: row.studentCode,
    studentPhone: row.studentPhone,
    leadId: a.leadId,
    attributedSourceId: a.attributedSourceId,
    sourceName: row.sourceName,
    courseId: a.courseId,
    courseName: row.courseName,
    courseCode: row.courseCode,
    admissionDate: a.admissionDate,
    listFeeMinor: a.listFeeMinor,
    discountMinor: a.discountMinor,
    agreedFeeMinor: a.agreedFeeMinor,
    admissionFeeRequiredMinor: a.admissionFeeRequiredMinor,
    counsellorId: a.counsellorId,
    counsellorName: row.counsellorName,
    status: a.status,
    batchStatus: a.batchStatus,
    notes: a.notes,
    activatedOn: a.activatedOn,
    completedOn: a.completedOn,
    withdrawnOn: a.withdrawnOn,
    cancelledOn: a.cancelledOn,
    statusReason: a.statusReason,
    adjustmentsMinor: row.adjustmentsMinor,
    paidMinor: row.paidMinor,
    refundedMinor: row.refundedMinor,
    netPaidMinor: row.paidMinor - row.refundedMinor,
    outstandingMinor: row.outstandingMinor,
    overdueMinor: row.overdueMinor,
    hasActivePlan: row.hasActivePlan,
    createdAt: a.createdAt.toISOString(),
  };
}

export async function getAdmission(id: string, database: DbLike = db): Promise<AdmissionDto> {
  const row = await admissionQuery(database).where(eq(admissions.id, id)).get();
  if (!row) throw ApiError.notFound('Admission');
  return toAdmissionDto(row);
}

export async function getAdmissionRow(id: string, database: DbLike = db): Promise<Admission> {
  const row = await database.select().from(admissions).where(eq(admissions.id, id)).get();
  if (!row) throw ApiError.notFound('Admission');
  return row;
}

/* ------------------------------------------------------------------ *
 * List
 * ------------------------------------------------------------------ */

type ListQuery = z.output<typeof admissionListQuerySchema>;

export function admissionFilters(query: Partial<ListQuery>): SQL[] {
  const conditions: SQL[] = [];
  if (query.q) {
    const digits = query.q.replace(/\D/g, '');
    const text = [
      containsText(admissions.admissionNumber, query.q),
      containsText(students.fullName, query.q),
      containsText(students.studentCode, query.q),
    ];
    if (digits.length >= 4) text.push(containsText(students.phoneNormalized, digits));
    conditions.push(or(...text)!);
  }
  if (query.status?.length) conditions.push(inArray(admissions.status, query.status));
  if (query.courseId) conditions.push(eq(admissions.courseId, query.courseId));
  if (query.counsellorId) conditions.push(eq(admissions.counsellorId, query.counsellorId));
  if (query.sourceId === 'unattributed') conditions.push(isNull(admissions.attributedSourceId));
  else if (query.sourceId) conditions.push(eq(admissions.attributedSourceId, query.sourceId));
  if (query.batchStatus) conditions.push(eq(admissions.batchStatus, query.batchStatus));
  if (query.from) conditions.push(sql`${admissions.admissionDate} >= ${query.from}`);
  if (query.to) conditions.push(sql`${admissions.admissionDate} <= ${query.to}`);
  if (query.studentId) conditions.push(eq(admissions.studentId, query.studentId));
  if (query.outstanding) conditions.push(sql`${outstandingExpr()} > 0`);
  return conditions;
}

const SORTS: Record<string, SQLWrapper> = {
  admissionDate: admissions.admissionDate,
  admissionNumber: admissions.admissionNumber,
  studentName: sql`${students.fullName}`,
  agreedFee: admissions.agreedFeeMinor,
  outstanding: outstandingExpr(),
  createdAt: admissions.createdAt,
};

export async function listAdmissions(query: ListQuery) {
  const where = and(...admissionFilters(query));
  const total =
    (await db
      .select({ n: count() })
      .from(admissions)
      .innerJoin(students, eq(students.id, admissions.studentId))
      .where(where)
      .get())?.n ?? 0;
  const sortColumn = SORTS[query.sort ?? 'admissionDate'] ?? admissions.admissionDate;
  const { limit, offset } = pageWindow(query.page, query.limit);
  const rows = await admissionQuery()
    .where(where)
    .orderBy(query.order === 'asc' ? asc(sortColumn) : desc(sortColumn), desc(admissions.id))
    .limit(limit)
    .offset(offset)
    .all();
  return paginated(rows.map(toAdmissionDto), total, query.page, query.limit);
}

/* ------------------------------------------------------------------ *
 * Create
 * ------------------------------------------------------------------ */

export interface CreatedAdmission {
  admission: AdmissionDto;
  /** False when an Idempotency-Key replay returned the original. */
  created: boolean;
}

export async function createAdmission(ctx: RequestContext, raw: unknown, idempotencyKey?: string): Promise<CreatedAdmission> {
  if (idempotencyKey) {
    const existing = await db.select({ id: admissions.id }).from(admissions).where(eq(admissions.idempotencyKey, idempotencyKey)).get();
    if (existing) return { admission: await getAdmission(existing.id), created: false };
  }

  const input = admissionCreateSchema.parse(raw);

  const course = await db.select().from(courses).where(eq(courses.id, input.courseId)).get();
  if (!course) throw ApiError.validation([{ path: 'courseId', message: 'Choose a valid course' }]);
  if (!course.isActive) throw ApiError.unprocessable(`${course.name} is not accepting admissions.`, 'COURSE_INACTIVE');

  const lead = input.leadId ? await db.select().from(leads).where(eq(leads.id, input.leadId)).get() : undefined;
  if (input.leadId && !lead) throw ApiError.validation([{ path: 'leadId', message: 'Lead not found' }]);
  if (lead?.status === 'converted') {
    throw ApiError.conflict('This lead has already been converted to an admission.', 'LEAD_ALREADY_CONVERTED');
  }

  if (input.studentId && !await db.select({ id: students.id }).from(students).where(eq(students.id, input.studentId)).get()) {
    throw ApiError.validation([{ path: 'studentId', message: 'Student not found' }]);
  }
  if (input.newStudent && !input.allowDuplicate) {
    const matches = await findDuplicateStudents(input.newStudent.phone, input.newStudent.email);
    if (matches.length > 0) {
      throw ApiError.conflict(
        'A student with this phone or email already exists. Choose the existing student, or confirm this is a different person.',
        'DUPLICATE_STUDENT',
        { matches },
      );
    }
  }

  const counsellorId = input.counsellorId ?? lead?.counsellorId ?? null;
  if (counsellorId && !await db.select({ id: users.id }).from(users).where(eq(users.id, counsellorId)).get()) {
    throw ApiError.validation([{ path: 'counsellorId', message: 'Choose a valid counsellor' }]);
  }

  const settings = getSettings();

  const id = await db.transaction(async (tx) => {
    let studentId = input.studentId;
    if (input.newStudent) {
      const s = input.newStudent;
      const student = await tx
        .insert(students)
        .values({
          studentCode: await nextCode(tx, settings.studentCodePrefix, input.admissionDate),
          fullName: s.fullName,
          phone: s.phone,
          phoneNormalized: normalisePhone(s.phone),
          email: s.email ?? null,
          address: s.address ?? null,
          city: s.city ?? null,
          dateOfBirth: s.dateOfBirth ?? null,
          emergencyContactName: s.emergencyContactName ?? null,
          emergencyContactPhone: s.emergencyContactPhone ?? null,
          notes: s.notes ?? null,
          createdById: ctx.actorId,
        })
        .returning()
        .get();
      studentId = student.id;
      await recordAudit(tx, ctx, { action: 'create', entityType: 'student', entityId: student.id, summary: `Registered student ${student.studentCode} ${student.fullName}`, after: student });
    }

    const admissionNumber = await nextCode(tx, settings.admissionNumberPrefix, input.admissionDate);
    const admission = await tx
      .insert(admissions)
      .values({
        admissionNumber,
        studentId: studentId!,
        leadId: lead?.id ?? null,
        // Attribution is copied now, so later edits to the lead cannot move it.
        attributedSourceId: lead?.leadSourceId ?? null,
        courseId: course.id,
        admissionDate: input.admissionDate,
        listFeeMinor: input.listFeeMinor,
        discountMinor: input.discountMinor,
        agreedFeeMinor: input.listFeeMinor - input.discountMinor,
        admissionFeeRequiredMinor: input.admissionFeeRequiredMinor,
        counsellorId,
        // No up-front requirement means nothing to wait for: the student is
        // enrolled now. The full balance still shows as outstanding --
        // active means enrolled, never 'financially settled'.
        status: input.admissionFeeRequiredMinor === 0 ? 'active' : 'pending_payment',
        activatedOn: input.admissionFeeRequiredMinor === 0 ? input.admissionDate : null,
        notes: input.notes ?? null,
        idempotencyKey: idempotencyKey ?? null,
        createdById: ctx.actorId,
      })
      .returning()
      .get();

    if (lead) await markLeadConverted(tx, ctx, lead, studentId!, input.admissionDate, admissionNumber);

    await recordAudit(tx, ctx, {
      action: 'create',
      entityType: 'admission',
      entityId: admission.id,
      summary: `Registered admission ${admissionNumber} for ${course.name}`,
      after: admission,
    });

    await admissionHooks.onCreated(tx, ctx, admission, raw);
    return admission.id;
  });

  await admissionHooks.afterCommit('created', id);
  return { admission: await getAdmission(id), created: true };
}

/* ------------------------------------------------------------------ *
 * Update and lifecycle
 * ------------------------------------------------------------------ */

export async function updateAdmission(ctx: RequestContext, id: string, raw: unknown): Promise<AdmissionDto> {
  const input = admissionUpdateSchema.parse(raw);
  const existing = await getAdmissionRow(id);
  if (input.counsellorId && !await db.select({ id: users.id }).from(users).where(eq(users.id, input.counsellorId)).get()) {
    throw ApiError.validation([{ path: 'counsellorId', message: 'Choose a valid counsellor' }]);
  }
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(admissions)
      .set({
        ...(input.counsellorId !== undefined && { counsellorId: input.counsellorId ?? null }),
        ...(input.notes !== undefined && { notes: input.notes ?? null }),
      })
      .where(eq(admissions.id, id))
      .returning()
      .get();
    await recordAudit(tx, ctx, {
      action: 'update',
      entityType: 'admission',
      entityId: id,
      summary: `Updated admission ${existing.admissionNumber}`,
      ...diff(existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>),
    });
  });
  return await getAdmission(id);
}

const ALLOWED_FROM: Record<string, readonly Admission['status'][]> = {
  activate: ['pending_payment'],
  complete: ['active'],
  withdraw: ['pending_payment', 'active'],
  cancel: ['pending_payment', 'active'],
};

export async function changeAdmissionStatus(ctx: RequestContext, id: string, raw: unknown): Promise<AdmissionDto> {
  const input = admissionStatusChangeSchema.parse(raw);
  const existing = await getAdmissionRow(id);
  const current = await getAdmission(id);

  if (!ALLOWED_FROM[input.action]!.includes(existing.status)) {
    throw ApiError.conflict(`An admission that is ${existing.status.replace(/_/g, ' ')} cannot be moved with "${input.action}".`, 'INVALID_TRANSITION');
  }
  if (input.date < existing.admissionDate) {
    throw ApiError.validation([{ path: 'date', message: 'The date cannot be before the admission date' }]);
  }
  if (input.action === 'cancel' && current.netPaidMinor > 0) {
    throw ApiError.conflict(
      'Money has been received against this admission. Refund it first, or mark the admission as withdrawn instead.',
      'HAS_PAYMENTS',
    );
  }

  await db.transaction(async (tx) => {
    const changes: Partial<Admission> = {};
    if (input.action === 'activate') Object.assign(changes, { status: 'active', activatedOn: input.date });
    if (input.action === 'complete') Object.assign(changes, { status: 'completed', completedOn: input.date, batchStatus: 'completed' });
    if (input.action === 'withdraw') Object.assign(changes, { status: 'withdrawn', withdrawnOn: input.date, statusReason: input.reason });
    if (input.action === 'cancel') Object.assign(changes, { status: 'cancelled', cancelledOn: input.date, statusReason: input.reason });

    const updated = await tx.update(admissions).set(changes).where(eq(admissions.id, id)).returning().get();

    if (input.action === 'withdraw' && input.writeOffBalance && current.outstandingMinor > 0) {
      await tx.insert(feeAdjustments)
        .values({
          admissionId: id,
          type: 'write_off',
          amountMinor: current.outstandingMinor,
          effectiveDate: input.date,
          reason: `Written off on withdrawal: ${input.reason}`,
          approvedById: ctx.actorId,
          createdById: ctx.actorId,
        })
        .run();
    }

    await recordAudit(tx, ctx, {
      action: 'status_change',
      entityType: 'admission',
      entityId: id,
      summary: `${input.action[0]!.toUpperCase()}${input.action.slice(1)} admission ${existing.admissionNumber}${input.reason ? `: ${input.reason}` : ''}`,
      before: { status: existing.status },
      after: { status: updated.status, date: input.date, writeOff: input.writeOffBalance ? current.outstandingMinor : 0 },
    });

    await admissionHooks.onStatusChanged(tx, ctx, existing, updated, input.date);
  });

  return await getAdmission(id);
}

/** Activate a pending admission once its admission fee is covered (called by payments). */
export async function activateIfFeeCovered(tx: Tx, ctx: RequestContext, admissionId: string, paymentDate: string): Promise<void> {
  const admission = await getAdmissionRow(admissionId, tx);
  if (admission.status !== 'pending_payment') return;
  const finance = await getAdmission(admissionId, tx);
  if (finance.netPaidMinor >= admission.admissionFeeRequiredMinor) {
    await tx.update(admissions).set({ status: 'active', activatedOn: paymentDate }).where(eq(admissions.id, admissionId)).run();
    await recordAudit(tx, ctx, {
      action: 'status_change',
      entityType: 'admission',
      entityId: admissionId,
      summary: `Admission ${admission.admissionNumber} activated: admission fee received`,
      before: { status: 'pending_payment' },
      after: { status: 'active' },
    });
  }
}
