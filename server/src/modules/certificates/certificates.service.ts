/**
 * Course completion certificates.
 *
 *   requested -> under_review -> approved -> issued
 *            \______________\__________\-> rejected (with a reason)
 *
 * A certificate is for one ADMISSION, and only a completed admission
 * qualifies. Issuing assigns a CERT-YYYY-##### reference (gap-free, from the
 * sequences table) and generates the PDF. Anyone can check a reference at
 * the public verification endpoint, which reveals only name, course and date.
 */

import { certificateDecisionSchema, certificateRequestSchema, type CertificateDto, type CertificateVerification, type certificateListQuerySchema } from '@ims/shared';
import { and, count, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';
import { env } from '../../config/env';
import { db } from '../../db';
import { admissions, certificates, courses, students, users, type Certificate } from '../../db/schema';
import { renderCertificatePdf } from '../../pdf/certificate';
import { recordAudit } from '../../services/audit';
import { instituteToday } from '../../services/clock';
import { nextCode } from '../../services/sequences';
import { getSettings } from '../../services/settings';
import { newKey, readStoredFile, saveFile } from '../../services/storage';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { containsText, pageWindow, paginated } from '../../utils/pagination';
import { notifyPermission, notifyUsers, safely } from '../notifications/notifications.service';
import { toInstituteInfo } from '../users/serialize';

const reviewer = alias(users, 'reviewer');

const NEXT: Record<Certificate['status'], Certificate['status'][]> = {
  requested: ['under_review', 'approved', 'issued', 'rejected'],
  under_review: ['approved', 'issued', 'rejected'],
  approved: ['issued', 'rejected'],
  issued: [],
  rejected: [],
};

function query() {
  return db
    .select({ c: certificates, studentName: students.fullName, studentCode: students.studentCode, studentUserId: students.userId, admissionNumber: admissions.admissionNumber, admissionStatus: admissions.status, courseName: courses.name, reviewedByName: reviewer.name })
    .from(certificates)
    .innerJoin(students, eq(students.id, certificates.studentId))
    .innerJoin(admissions, eq(admissions.id, certificates.admissionId))
    .innerJoin(courses, eq(courses.id, certificates.courseId))
    .leftJoin(reviewer, eq(reviewer.id, certificates.reviewedById));
}

type Row = Awaited<ReturnType<ReturnType<typeof query>['all']>>[number];

function toDto(r: Row): CertificateDto {
  const c = r.c;
  return {
    id: c.id,
    studentId: c.studentId,
    studentName: r.studentName,
    studentCode: r.studentCode,
    admissionId: c.admissionId,
    admissionNumber: r.admissionNumber,
    courseName: r.courseName,
    admissionStatus: r.admissionStatus,
    status: c.status,
    referenceNumber: c.referenceNumber,
    issuedOn: c.issuedOn,
    requestNote: c.requestNote,
    reviewNote: c.reviewNote,
    hasFile: Boolean(c.fileKey),
    requestedAt: c.createdAt.toISOString(),
    reviewedByName: r.reviewedByName,
    reviewedAt: c.reviewedAt?.toISOString() ?? null,
  };
}

export async function getCertificate(id: string): Promise<CertificateDto> {
  const row = await query().where(eq(certificates.id, id)).get();
  if (!row) throw ApiError.notFound('Certificate');
  return toDto(row);
}

export async function listCertificates(q: z.output<typeof certificateListQuerySchema>, studentId?: string) {
  const conditions: (SQL | undefined)[] = [];
  if (studentId) conditions.push(eq(certificates.studentId, studentId));
  if (q.q) conditions.push(or(containsText(students.fullName, q.q), containsText(students.studentCode, q.q), containsText(certificates.referenceNumber, q.q)));
  if (q.status?.length) conditions.push(inArray(certificates.status, q.status));
  if (q.courseId) conditions.push(eq(certificates.courseId, q.courseId));
  const where = and(...conditions);
  const total = (await db.select({ n: count() }).from(certificates).innerJoin(students, eq(students.id, certificates.studentId)).where(where).get())?.n ?? 0;
  const { limit, offset } = pageWindow(q.page, q.limit);
  return paginated((await query().where(where).orderBy(desc(certificates.createdAt)).limit(limit).offset(offset).all()).map(toDto), total, q.page, q.limit);
}

/** A request for a completed admission. `studentId` set: the student is asking for their own. */
export async function requestCertificate(ctx: RequestContext, raw: unknown, studentId: string | null): Promise<CertificateDto> {
  const input = certificateRequestSchema.parse(raw);
  const admission = await db.select().from(admissions).where(eq(admissions.id, input.admissionId)).get();
  if (!admission || (studentId && admission.studentId !== studentId)) throw ApiError.notFound('Admission');
  if (admission.status !== 'completed') throw ApiError.unprocessable('A certificate can be requested once the course is completed.', 'NOT_COMPLETED');
  const live = await db.select({ id: certificates.id, status: certificates.status }).from(certificates).where(and(eq(certificates.admissionId, admission.id), sql`${certificates.status} <> 'rejected'`)).get();
  if (live) throw ApiError.conflict(`There is already a certificate for this course (${live.status.replace('_', ' ')}).`, 'ALREADY_REQUESTED');
  const id = await db.transaction(async (tx) => {
    const row = await tx
      .insert(certificates)
      .values({ studentId: admission.studentId, admissionId: admission.id, courseId: admission.courseId, requestNote: input.requestNote ?? null, requestedById: ctx.actorId || null })
      .returning()
      .get();
    await recordAudit(tx, ctx, { action: 'create', entityType: 'certificate', entityId: row.id, summary: `Certificate requested for ${admission.admissionNumber}` });
    return row.id;
  });
  if (studentId) {
    await safely('certificate_request', async () => {
      await notifyPermission('certificates:issue', { type: 'certificate_update', title: `Certificate requested: ${admission.admissionNumber}`, link: '/certificates', entityType: 'certificate', entityId: id, dedupeKey: `certificate_requested:${id}` });
    });
  }
  return await getCertificate(id);
}

export async function decideCertificate(ctx: RequestContext, id: string, raw: unknown): Promise<CertificateDto> {
  const cert = await db.select().from(certificates).where(eq(certificates.id, id)).get();
  if (!cert) throw ApiError.notFound('Certificate');
  const input = certificateDecisionSchema.parse(raw);
  if (!NEXT[cert.status].includes(input.status)) throw ApiError.conflict(`A certificate that is ${cert.status.replace('_', ' ')} cannot become ${input.status.replace('_', ' ')}.`, 'INVALID_TRANSITION');

  let fileKey = cert.fileKey;
  let referenceNumber = cert.referenceNumber;
  const issuedOn = input.status === 'issued' ? (input.issuedOn ?? instituteToday()) : cert.issuedOn;
  if (input.status === 'issued') {
    const admission = (await db.select().from(admissions).where(eq(admissions.id, cert.admissionId)).get())!;
    if (admission.status !== 'completed') throw ApiError.unprocessable('The admission is no longer completed.', 'NOT_COMPLETED');
    if (issuedOn! < (admission.completedOn ?? admission.admissionDate)) throw ApiError.validation([{ path: 'issuedOn', message: 'Cannot be before the course was completed' }]);
    // Reserve the reference first so the PDF prints the same number that is stored.
    referenceNumber = await db.transaction(async (tx) => await nextCode(tx, 'CERT', issuedOn!));
    const student = (await db.select().from(students).where(eq(students.id, cert.studentId)).get())!;
    const course = (await db.select().from(courses).where(eq(courses.id, cert.courseId)).get())!;
    const pdf = await renderCertificatePdf(
      {
        referenceNumber,
        studentName: student.fullName,
        studentCode: student.studentCode,
        courseName: course.name,
        admissionDate: admission.admissionDate,
        completedOn: admission.completedOn,
        issuedOn: issuedOn!,
        verifyUrl: `${env.APP_URL.replace(/\/+$/, '')}/verify/${referenceNumber}`,
      },
      toInstituteInfo(getSettings()),
    );
    fileKey = newKey('certificates', 'pdf');
    await saveFile(fileKey, pdf);
  }

  await db.transaction(async (tx) => {
    await tx.update(certificates)
      .set({ status: input.status, reviewNote: input.reviewNote ?? cert.reviewNote, reviewedById: ctx.actorId || null, reviewedAt: new Date(), referenceNumber, issuedOn, fileKey })
      .where(eq(certificates.id, id))
      .run();
    await recordAudit(tx, ctx, { action: input.status === 'rejected' ? 'reject' : input.status === 'issued' ? 'approve' : 'status_change', entityType: 'certificate', entityId: id, summary: `Certificate ${referenceNumber ?? ''}: ${cert.status} → ${input.status}${input.reviewNote ? ` (${input.reviewNote})` : ''}`.replace('  ', ' ') });
  });

  const dto = await getCertificate(id);
  await safely('certificate_update', async () => {
    const userId = (await db.select({ userId: students.userId }).from(students).where(eq(students.id, cert.studentId)).get())?.userId;
    if (!userId) return;
    await notifyUsers([userId], {
      type: 'certificate_update',
      severity: input.status === 'rejected' ? 'warning' : input.status === 'issued' ? 'success' : 'info',
      title: input.status === 'issued' ? `Your certificate for ${dto.courseName} is ready` : `Certificate request: ${input.status.replace('_', ' ')}`,
      body: input.reviewNote ?? null,
      link: '/portal/certificates',
      entityType: 'certificate',
      entityId: id,
      dedupeKey: `certificate:${id}:${input.status}`,
    });
  });
  return dto;
}

/** The PDF. `studentId` set: only their own, only once issued. */
export async function certificateFile(id: string, studentId: string | null): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  const cert = await db.select().from(certificates).where(eq(certificates.id, id)).get();
  if (!cert || (studentId && cert.studentId !== studentId)) throw ApiError.notFound('Certificate');
  if (cert.status !== 'issued' || !cert.fileKey) throw ApiError.conflict('This certificate has not been issued yet.', 'NOT_ISSUED');
  const buffer = await readStoredFile(cert.fileKey);
  if (!buffer) throw ApiError.conflict('The certificate file is missing. Ask the institute to reissue it.', 'FILE_MISSING');
  return { buffer, fileName: `${cert.referenceNumber}.pdf`, mimeType: 'application/pdf' };
}

/** Public: confirm a certificate reference. Reveals only what is printed on it. */
export async function verifyCertificate(reference: string): Promise<CertificateVerification> {
  const ref = reference.trim().toUpperCase().slice(0, 40);
  const row = await db
    .select({ c: certificates, studentName: students.fullName, courseName: courses.name })
    .from(certificates)
    .innerJoin(students, eq(students.id, certificates.studentId))
    .innerJoin(courses, eq(courses.id, certificates.courseId))
    .where(and(eq(certificates.referenceNumber, ref), eq(certificates.status, 'issued')))
    .get();
  if (!row) return { valid: false, referenceNumber: ref };
  return { valid: true, referenceNumber: ref, studentName: row.studentName, courseName: row.courseName, issuedOn: row.c.issuedOn!, institute: getSettings().name };
}
