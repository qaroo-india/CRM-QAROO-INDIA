/**
 * The student portal. Every function takes the student id from the SESSION
 * (never from the request), so a student can only ever see their own
 * admissions, fees, receipts, attendance, exams, material, certificates and
 * placement.
 */

import { addDays, type PortalAdmission, type PortalAttendance, type PortalFees, type PortalInstalment, type PortalOverview, type PortalPayment, type PortalPlacement } from '@ims/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import { admissions, attendanceRecords, attendanceSessions, batchAssignments, batches, certificates, classSessions, companies, courses, interviews, payments, placementApplications, placementProfiles, students, trainers } from '../../db/schema';
import { instituteToday } from '../../services/clock';
import { instalmentPaidSql } from '../../services/ledger';
import { ApiError } from '../../utils/ApiError';
import { countsByAdmission, percentOf } from '../attendance/attendance.service';
import { admissionQuery } from '../admissions/admissions.service';
import { portalExams } from '../exams/exams.service';
import { drivesForStudent } from '../placements/drives.service';
import { listSessions } from '../schedule/schedule.service';
import type { RequestContext } from '../../utils/context';


async function studentRow(studentId: string) {
  const s = await db.select().from(students).where(eq(students.id, studentId)).get();
  if (!s) throw ApiError.notFound('Student');
  return s;
}

/** The batch an admission is in now (active), else the last one it was in. */
async function currentBatches(admissionIds: string[]) {
  if (admissionIds.length === 0) return new Map<string, PortalAdmission['batch']>();
  const rows = await db
    .select({ admissionId: batchAssignments.admissionId, status: batchAssignments.status, assignedOn: batchAssignments.assignedOn, id: batches.id, batchCode: batches.batchCode, name: batches.name, schedule: batches.schedule, trainerName: trainers.name })
    .from(batchAssignments)
    .innerJoin(batches, eq(batches.id, batchAssignments.batchId))
    .leftJoin(trainers, eq(trainers.id, batches.trainerId))
    .where(inArray(batchAssignments.admissionId, admissionIds))
    .orderBy(desc(batchAssignments.assignedOn))
    .all();
  const map = new Map<string, PortalAdmission['batch']>();
  for (const r of rows) {
    const current = map.get(r.admissionId);
    if (!current || r.status === 'active') map.set(r.admissionId, { id: r.id, batchCode: r.batchCode, name: r.name, trainerName: r.trainerName, schedule: r.schedule });
  }
  return map;
}

async function myAdmissions(studentId: string): Promise<PortalAdmission[]> {
  const rows = await admissionQuery().where(and(eq(admissions.studentId, studentId), sql`${admissions.status} <> 'cancelled'`)).orderBy(desc(admissions.admissionDate)).all();
  const ids = rows.map((r) => r.admission.id);
  const batchMap = await currentBatches(ids);
  const attendance = await countsByAdmission({ admissionIds: ids });
  const today = instituteToday();
  const next = ids.length
    ? await db.all<{ admissionId: string; dueDate: string; owed: number }>(sql`
        select i.admission_id as admissionId, i.due_date as dueDate, max(0, i.amount_minor - ${instalmentPaidSql()}) as owed
        from instalments i
        where i.state = 'active' and i.admission_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) and i.due_date >= ${today}
        order by i.due_date`)
    : [];
  return rows.map((r) => {
    const a = r.admission;
    const upcoming = next.find((n) => n.admissionId === a.id && Number(n.owed) > 0);
    const counts = attendance.get(a.id);
    return {
      id: a.id,
      admissionNumber: a.admissionNumber,
      courseId: a.courseId,
      courseName: r.courseName,
      status: a.status,
      admissionDate: a.admissionDate,
      batch: batchMap.get(a.id) ?? null,
      agreedFeeMinor: a.agreedFeeMinor,
      paidMinor: r.paidMinor - r.refundedMinor,
      outstandingMinor: r.outstandingMinor,
      overdueMinor: r.overdueMinor,
      nextInstalment: upcoming ? { dueDate: upcoming.dueDate, amountMinor: Number(upcoming.owed) } : null,
      attendancePercent: counts ? percentOf(counts) : null,
    };
  });
}

/** Batches the student belongs (or belonged) to. */
async function myBatchIds(studentId: string): Promise<string[]> {
  return (await db.select({ batchId: batchAssignments.batchId }).from(batchAssignments).where(eq(batchAssignments.studentId, studentId)).all()).map((r) => r.batchId);
}

export async function myClasses(ctx: RequestContext, studentId: string, from: string, to: string) {
  const ids = [...new Set(await myBatchIds(studentId))];
  if (ids.length === 0) return [];
  // The student has no batch permissions; scope comes from their own assignments.
  const asTeam: RequestContext = { ...ctx, accountType: 'team' };
  return await listSessions(asTeam, { from, to, status: undefined }, inArray(classSessions.batchId, ids));
}

export async function overview(ctx: RequestContext, studentId: string): Promise<PortalOverview> {
  const s = await studentRow(studentId);
  const today = instituteToday();
  const exams = await portalExams(studentId);
  const recent = await db.get<{ n: number }>(sql`
    select count(*) as n from materials m
    where m.is_published = 1 and m.deleted_at is null and m.created_at >= ${Date.now() - 14 * 86_400_000}
      and m.course_id in (select a.course_id from admissions a where a.student_id = ${studentId} and a.status <> 'cancelled')
      and (m.batch_id is null or m.batch_id in (select ba.batch_id from batch_assignments ba where ba.student_id = ${studentId}))`);
  const certs = await db.select({ status: certificates.status }).from(certificates).where(eq(certificates.studentId, studentId)).all();
  return {
    student: { id: s.id, studentCode: s.studentCode, fullName: s.fullName, email: s.email, phone: s.phone },
    admissions: await myAdmissions(studentId),
    upcomingClasses: (await myClasses(ctx, studentId, today, addDays(today, 7))).filter((c) => c.status === 'scheduled' && new Date(c.endsAt).getTime() > Date.now()).slice(0, 8),
    openExams: exams.filter((e) => !e.blockedReason || e.inProgressAttemptId).length,
    newMaterials: Number(recent?.n ?? 0),
    certificates: { requested: certs.filter((c) => c.status !== 'issued' && c.status !== 'rejected').length, issued: certs.filter((c) => c.status === 'issued').length },
  };
}

export async function fees(studentId: string): Promise<PortalFees> {
  const adm = await myAdmissions(studentId);
  const ids = adm.map((a) => a.id);
  const today = instituteToday();
  const instalmentRows = ids.length
    ? await db.all<{ admissionId: string; sequence: number; kind: string; dueDate: string; amountMinor: number; paid: number }>(sql`
        select i.admission_id as admissionId, i.sequence, i.kind, i.due_date as dueDate, i.amount_minor as amountMinor, ${instalmentPaidSql()} as paid
        from instalments i
        where i.state = 'active' and i.admission_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        order by i.due_date, i.sequence`)
    : [];
  const instalments: PortalInstalment[] = instalmentRows.map((i) => {
    const a = adm.find((x) => x.id === i.admissionId)!;
    const paid = Math.min(Number(i.paid), i.amountMinor);
    const state: PortalInstalment['state'] = paid >= i.amountMinor ? 'paid' : i.dueDate < today ? 'overdue' : i.dueDate === today ? 'due' : paid > 0 ? 'partly_paid' : 'upcoming';
    return { admissionId: i.admissionId, admissionNumber: a.admissionNumber, courseName: a.courseName, sequence: i.sequence, kind: i.kind, dueDate: i.dueDate, amountMinor: i.amountMinor, paidMinor: paid, state };
  });
  const paymentRows: PortalPayment[] = ids.length
    ? (await db
        .select({ p: payments, admissionNumber: admissions.admissionNumber, courseName: courses.name })
        .from(payments)
        .innerJoin(admissions, eq(admissions.id, payments.admissionId))
        .innerJoin(courses, eq(courses.id, admissions.courseId))
        .where(and(inArray(payments.admissionId, ids), eq(payments.status, 'succeeded')))
        .orderBy(desc(payments.paymentDate), desc(payments.receiptNumber))
        .all())
        .map(({ p, admissionNumber, courseName }) => ({ id: p.id, receiptNumber: p.receiptNumber, paymentDate: p.paymentDate, admissionNumber, courseName, direction: p.direction, method: p.method, amountMinor: p.amountMinor }))
    : [];
  return { admissions: adm, instalments, payments: paymentRows };
}

/** A receipt may be downloaded only by the student it was issued to. */
export async function assertOwnPayment(studentId: string, paymentId: string): Promise<void> {
  const p = await db.select({ studentId: payments.studentId, status: payments.status }).from(payments).where(eq(payments.id, paymentId)).get();
  if (!p || p.studentId !== studentId) throw ApiError.notFound('Receipt');
}

export async function attendance(studentId: string): Promise<PortalAttendance[]> {
  const adm = await myAdmissions(studentId);
  if (adm.length === 0) return [];
  const counts = await countsByAdmission({ admissionIds: adm.map((a) => a.id) });
  const days = await db
    .select({ admissionId: attendanceRecords.admissionId, date: attendanceSessions.date, status: attendanceRecords.status, minutesLate: attendanceRecords.minutesLate, topic: attendanceSessions.topic, remark: attendanceRecords.remark })
    .from(attendanceRecords)
    .innerJoin(attendanceSessions, eq(attendanceSessions.id, attendanceRecords.attendanceSessionId))
    .where(eq(attendanceRecords.studentId, studentId))
    .orderBy(desc(attendanceSessions.date))
    .all();
  return adm.map((a) => {
    const c = counts.get(a.id) ?? { sessions: 0, present: 0, late: 0, onDuty: 0, absent: 0, holiday: 0 };
    return {
      admissionId: a.id,
      admissionNumber: a.admissionNumber,
      courseName: a.courseName,
      batchCode: a.batch?.batchCode ?? null,
      summary: { ...c, percent: percentOf(c) },
      days: days.filter((d) => d.admissionId === a.id).map(({ admissionId: _a, ...d }) => d),
    };
  });
}

export async function placement(studentId: string): Promise<PortalPlacement> {
  const profile = await db.select().from(placementProfiles).where(eq(placementProfiles.studentId, studentId)).orderBy(desc(placementProfiles.createdAt)).get();
  const apps = await db
    .select({ a: placementApplications, companyName: companies.name })
    .from(placementApplications)
    .innerJoin(companies, eq(companies.id, placementApplications.companyId))
    .where(eq(placementApplications.studentId, studentId))
    .orderBy(desc(placementApplications.appliedOn))
    .all();
  const rounds = apps.length ? await db.select().from(interviews).where(inArray(interviews.applicationId, apps.map((x) => x.a.id))).orderBy(asc(interviews.scheduledAt)).all() : [];
  return {
    profile: profile
      ? { id: profile.id, track: profile.track, stage: profile.stage, eligibleOn: profile.eligibleOn, resumeStatus: profile.resumeStatus, placed: apps.some((x) => x.a.outcome === 'joined') }
      : null,
    drives: await drivesForStudent(studentId),
    applications: apps.map(({ a, companyName }) => ({
      id: a.id,
      companyName,
      jobTitle: a.jobTitle,
      appliedOn: a.appliedOn,
      outcome: a.outcome,
      driveId: a.driveId,
      interviews: rounds.filter((r) => r.applicationId === a.id).map((r) => ({ roundName: r.roundName, scheduledAt: r.scheduledAt.toISOString(), result: r.result })),
    })),
  };
}

