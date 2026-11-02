/**
 * Students: one identity per real person, many admissions over time.
 *
 * A student's balance is never stored; it is the sum of their admissions'
 * outstanding amounts from the ledger. The profile timeline merges the audit
 * trail of everything linked to the student with their enquiry activity.
 */

import {
  normalisePhone,
  type StudentDto,
  type StudentProfile,
  type TimelineEvent,
  studentListQuerySchema,
  studentSchema,
} from '@ims/shared';
import { and, asc, count, desc, eq, inArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';
import { db } from '../../db';
import {
  admissions,
  auditLogs,
  batchAssignments,
  documents,
  leadActivities,
  leads,
  loans,
  payments,
  placementApplications,
  placementProfiles,
  students,
  users,
  type Student,
} from '../../db/schema';
import { qualified } from '../../db/dialect';
import { diff, recordAudit } from '../../services/audit';
import { instituteToday } from '../../services/clock';
import { findDuplicateStudents } from '../../services/duplicates';
import { outstandingExpr } from '../../services/ledger';
import { nextCode } from '../../services/sequences';
import { getSettings } from '../../services/settings';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { containsText, pageWindow, paginated } from '../../utils/pagination';
import { admissionQuery, toAdmissionDto } from '../admissions/admissions.service';
import { leadsByIds } from '../leads/leads.service';

const actor = alias(users, 'timeline_actor');

// Correlated subqueries use qualified() names: see db/dialect.ts for why.
const S_ID = qualified('students', 'id');
const admissionCount = sql<number>`(select count(*) from admissions a2 where a2.student_id = ${S_ID})`;
const latestCourseName = sql<string | null>`(select c.name from admissions a2 join courses c on c.id = a2.course_id where a2.student_id = ${S_ID} order by a2.admission_date desc, a2.id desc limit 1)`;
/** Σ outstanding over the student's admissions (each computed from the ledger). */
// The ledger expression correlates on "admissions".*, which here binds to this
// subquery's admissions row -- exactly the per-admission figure we sum.
const studentOutstanding = sql<number>`(select coalesce(sum(${outstandingExpr()}), 0) from admissions where "admissions"."student_id" = ${S_ID})`;

const S_USER = qualified('students', 'user_id');
const studentSelect = {
  student: students,
  portalActive: sql<number | null>`(select u.is_active from users u where u.id = ${S_USER})`,
  portalLastLogin: sql<number | null>`(select u.last_login_at from users u where u.id = ${S_USER})`,
  admissionCount: admissionCount.mapWith(Number),
  latestCourseName,
  outstandingMinor: studentOutstanding.mapWith(Number),
};

function toDto(row: { student: Student; admissionCount: number; latestCourseName: string | null; outstandingMinor: number; portalActive: number | null; portalLastLogin: number | null }): StudentDto {
  const s = row.student;
  return {
    id: s.id,
    studentCode: s.studentCode,
    fullName: s.fullName,
    phone: s.phone,
    email: s.email,
    address: s.address,
    city: s.city,
    dateOfBirth: s.dateOfBirth,
    emergencyContactName: s.emergencyContactName,
    emergencyContactPhone: s.emergencyContactPhone,
    notes: s.notes,
    gender: s.gender ?? null,
    qualification: s.qualification,
    yearOfPassing: s.yearOfPassing,
    state: s.state,
    pincode: s.pincode,
    guardianName: s.guardianName,
    guardianPhone: s.guardianPhone,
    status: s.status,
    portal: s.userId
      ? { userId: s.userId, isActive: Boolean(Number(row.portalActive)), lastLoginAt: row.portalLastLogin ? new Date(Number(row.portalLastLogin)).toISOString() : null }
      : null,
    admissionCount: row.admissionCount,
    latestCourseName: row.latestCourseName,
    outstandingMinor: row.outstandingMinor,
    createdAt: s.createdAt.toISOString(),
  };
}

export async function getStudent(id: string): Promise<StudentDto> {
  const row = await db.select(studentSelect).from(students).where(eq(students.id, id)).get();
  if (!row) throw ApiError.notFound('Student');
  return toDto(row);
}

type ListQuery = z.output<typeof studentListQuerySchema>;

const SORTS: Record<string, SQLWrapper> = {
  fullName: students.fullName,
  studentCode: students.studentCode,
  createdAt: students.createdAt,
  outstanding: studentOutstanding,
};

export async function listStudents(query: ListQuery) {
  const conditions: SQL[] = [];
  if (query.q) {
    const digits = query.q.replace(/\D/g, '');
    const text = [containsText(students.fullName, query.q), containsText(students.studentCode, query.q), containsText(students.email, query.q)];
    if (digits.length >= 4) text.push(containsText(students.phoneNormalized, digits));
    conditions.push(or(...text)!);
  }
  if (query.courseId) {
    conditions.push(sql`exists (select 1 from admissions a2 where a2.student_id = ${S_ID} and a2.course_id = ${query.courseId})`);
  }
  if (query.admissionStatus) {
    conditions.push(sql`exists (select 1 from admissions a2 where a2.student_id = ${S_ID} and a2.status = ${query.admissionStatus})`);
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const total = (await db.select({ n: count() }).from(students).where(where).get())?.n ?? 0;
  const sortColumn = SORTS[query.sort ?? 'createdAt'] ?? students.createdAt;
  const { limit, offset } = pageWindow(query.page, query.limit);
  const rows = await db
    .select(studentSelect)
    .from(students)
    .where(where)
    .orderBy(query.order === 'asc' ? asc(sortColumn) : desc(sortColumn), desc(students.id))
    .limit(limit)
    .offset(offset)
    .all();
  return paginated(rows.map(toDto), total, query.page, query.limit);
}

/* ------------------------------------------------------------------ *
 * Profile and timeline
 * ------------------------------------------------------------------ */

const LINKS: Record<string, (id: string, studentId: string) => string> = {
  student: (_id, studentId) => `/students/${studentId}`,
  admission: (_id, studentId) => `/students/${studentId}?tab=admissions`,
  payment: (_id, studentId) => `/students/${studentId}?tab=payments`,
  fee_plan: (_id, studentId) => `/students/${studentId}?tab=instalments`,
  fee_adjustment: (_id, studentId) => `/students/${studentId}?tab=payments`,
  loan: (_id, studentId) => `/students/${studentId}?tab=loans`,
  batch_assignment: (_id, studentId) => `/students/${studentId}?tab=batches`,
  placement_profile: (_id, studentId) => `/students/${studentId}?tab=placement`,
  placement_application: (_id, studentId) => `/students/${studentId}?tab=placement`,
  document: (_id, studentId) => `/students/${studentId}?tab=documents`,
};

const ACTIVITY_TITLES: Record<string, string> = {
  note: 'Note added to enquiry',
  call: 'Call logged',
  email: 'Email logged',
  meeting: 'Meeting logged',
  assignment: 'Enquiry assigned',
  follow_up_set: 'Follow-up scheduled',
  conversion: 'Enquiry converted to admission',
};

async function timelineFor(studentId: string, admissionIds: string[], leadIds: string[]): Promise<TimelineEvent[]> {
  // Every record that belongs to this student, so its audit entries can be shown.
  const ids = new Set<string>([studentId, ...admissionIds, ...leadIds]);
  if (admissionIds.length) {
    for (const table of [payments, loans, batchAssignments, placementProfiles] as const) {
      (await db.select({ id: table.id }).from(table).where(inArray(table.admissionId, admissionIds)).all()).forEach((r) => ids.add(r.id));
    }
  }
  (await db.select({ id: placementApplications.id }).from(placementApplications).where(eq(placementApplications.studentId, studentId)).all()).forEach((r) => ids.add(r.id));
  (await db.select({ id: documents.id }).from(documents).where(and(eq(documents.ownerType, 'student'), eq(documents.ownerId, studentId))).all()).forEach((r) => ids.add(r.id));

  const audit = (await db
    .select({ log: auditLogs, actorName: actor.name })
    .from(auditLogs)
    .leftJoin(actor, eq(actor.id, auditLogs.actorId))
    .where(inArray(auditLogs.entityId, [...ids]))
    .orderBy(desc(auditLogs.occurredAt))
    .limit(150)
    .all())
    .map<TimelineEvent>(({ log, actorName }) => ({
      id: log.id,
      at: log.occurredAt.toISOString(),
      kind: log.entityType,
      title: log.summary,
      detail: null,
      actorName,
      href: LINKS[log.entityType]?.(log.entityId ?? '', studentId) ?? null,
    }));

  const activities = leadIds.length
    ? (await db
        .select({ activity: leadActivities, actorName: actor.name })
        .from(leadActivities)
        .leftJoin(actor, eq(actor.id, leadActivities.actorId))
        .where(and(inArray(leadActivities.leadId, leadIds), sql`${leadActivities.type} <> 'status_change'`))
        .orderBy(desc(leadActivities.occurredAt))
        .limit(100)
        .all())
        .map<TimelineEvent>(({ activity, actorName }) => ({
          id: activity.id,
          at: activity.occurredAt.toISOString(),
          kind: 'lead_activity',
          title: ACTIVITY_TITLES[activity.type] ?? activity.type,
          detail: activity.note,
          actorName,
          href: `/leads?lead=${activity.leadId}`,
        }))
    : [];

  return [...audit, ...activities].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 200);
}

export async function getStudentProfile(id: string): Promise<StudentProfile> {
  const student = await getStudent(id);
  const admissionRows = await admissionQuery().where(eq(admissions.studentId, id)).orderBy(desc(admissions.admissionDate)).all();
  const admissionDtos = admissionRows.map(toAdmissionDto);

  const leadIdSet = new Set<string>(
    (await db.select({ id: leads.id }).from(leads).where(eq(leads.studentId, id)).all()).map((l) => l.id),
  );
  admissionDtos.forEach((a) => a.leadId && leadIdSet.add(a.leadId));
  const leadIds = [...leadIdSet];
  const linkedLeads = await leadsByIds(leadIds);

  return {
    student,
    admissions: admissionDtos,
    leads: linkedLeads,
    timeline: await timelineFor(id, admissionDtos.map((a) => a.id), leadIds),
  };
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

type StudentInput = z.output<typeof studentSchema>;

function columnsFrom(input: StudentInput) {
  return {
    fullName: input.fullName,
    phone: input.phone,
    phoneNormalized: normalisePhone(input.phone),
    email: input.email ?? null,
    address: input.address ?? null,
    city: input.city ?? null,
    dateOfBirth: input.dateOfBirth ?? null,
    emergencyContactName: input.emergencyContactName ?? null,
    emergencyContactPhone: input.emergencyContactPhone ?? null,
    notes: input.notes ?? null,
    gender: input.gender ?? null,
    qualification: input.qualification ?? null,
    yearOfPassing: input.yearOfPassing ?? null,
    state: input.state ?? null,
    pincode: input.pincode ?? null,
    guardianName: input.guardianName ?? null,
    guardianPhone: input.guardianPhone ?? null,
    status: input.status,
  };
}

export async function createStudent(ctx: RequestContext, raw: unknown): Promise<StudentDto> {
  const body = (raw ?? {}) as { allowDuplicate?: unknown };
  const input = studentSchema.parse(raw);
  if (body.allowDuplicate !== true) {
    const matches = await findDuplicateStudents(input.phone, input.email);
    if (matches.length) {
      throw ApiError.conflict(
        'A student with this phone or email already exists. Open the existing profile, or confirm this is a different person.',
        'DUPLICATE_STUDENT',
        { matches },
      );
    }
  }
  const id = await db.transaction(async (tx) => {
    const student = await tx
      .insert(students)
      .values({ ...columnsFrom(input), studentCode: await nextCode(tx, getSettings().studentCodePrefix, instituteToday()), createdById: ctx.actorId })
      .returning()
      .get();
    await recordAudit(tx, ctx, { action: 'create', entityType: 'student', entityId: student.id, summary: `Registered student ${student.studentCode} ${student.fullName}`, after: student });
    return student.id;
  });
  return await getStudent(id);
}

export async function updateStudent(ctx: RequestContext, id: string, raw: unknown): Promise<StudentDto> {
  const input = studentSchema.parse(raw);
  const existing = await db.select().from(students).where(eq(students.id, id)).get();
  if (!existing) throw ApiError.notFound('Student');
  await db.transaction(async (tx) => {
    const updated = await tx.update(students).set(columnsFrom(input)).where(eq(students.id, id)).returning().get();
    await recordAudit(tx, ctx, {
      action: 'update',
      entityType: 'student',
      entityId: id,
      summary: `Updated student ${existing.studentCode}`,
      ...diff(existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>),
    });
  });
  return await getStudent(id);
}
