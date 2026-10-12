/**
 * GET /search?q=   global search for the command palette.
 *
 * Each record type is searched only if the caller may read it, so search can
 * never be used to discover records a user is not allowed to open.
 * Phone numbers match on digits, ignoring spaces, dashes and country codes.
 */

import { hasPermission, searchQuerySchema } from '@ims/shared';
import { desc, eq, or } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../../db';
import { admissions, courses, leads, students } from '../../db/schema';
import { contextFrom } from '../../utils/context';
import { containsText } from '../../utils/pagination';
import { ok } from '../../utils/respond';
import { parseQuery } from '../../utils/validate';

export const searchRouter = Router();

interface Hit {
  type: 'student' | 'lead' | 'admission' | 'course';
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

const PER_TYPE = 5;

searchRouter.get('/', (req, res) => {
  const { q } = parseQuery(searchQuerySchema, req);
  const ctx = contextFrom(req);
  const digits = q.replace(/\D/g, '');
  const hits: Hit[] = [];

  if (hasPermission(ctx.permissions, 'students:read')) {
    const conditions = [containsText(students.fullName, q), containsText(students.studentCode, q), containsText(students.email, q)];
    if (digits.length >= 4) conditions.push(containsText(students.phoneNormalized, digits));
    for (const s of db.select().from(students).where(or(...conditions)).orderBy(desc(students.createdAt)).limit(PER_TYPE).all()) {
      hits.push({ type: 'student', id: s.id, title: s.fullName, subtitle: `${s.studentCode} · ${s.phone}`, href: `/students/${s.id}` });
    }
  }

  if (hasPermission(ctx.permissions, 'admissions:read')) {
    const rows = db
      .select({ id: admissions.id, number: admissions.admissionNumber, status: admissions.status, studentId: students.id, studentName: students.fullName, courseName: courses.name })
      .from(admissions)
      .innerJoin(students, eq(students.id, admissions.studentId))
      .innerJoin(courses, eq(courses.id, admissions.courseId))
      .where(or(containsText(admissions.admissionNumber, q), containsText(students.fullName, q)))
      .orderBy(desc(admissions.admissionDate))
      .limit(PER_TYPE)
      .all();
    for (const a of rows) {
      hits.push({ type: 'admission', id: a.id, title: `${a.number} · ${a.studentName}`, subtitle: `${a.courseName} · ${a.status.replace(/_/g, ' ')}`, href: `/students/${a.studentId}?tab=admissions` });
    }
  }

  if (hasPermission(ctx.permissions, 'leads:read')) {
    const conditions = [containsText(leads.name, q), containsText(leads.leadCode, q), containsText(leads.email, q)];
    if (digits.length >= 4) conditions.push(containsText(leads.phoneNormalized, digits));
    for (const l of db.select().from(leads).where(or(...conditions)).orderBy(desc(leads.enquiryDate)).limit(PER_TYPE).all()) {
      hits.push({ type: 'lead', id: l.id, title: l.name, subtitle: `${l.leadCode} · ${l.status.replace(/_/g, ' ')}`, href: `/leads?lead=${l.id}` });
    }
  }

  if (hasPermission(ctx.permissions, 'courses:read')) {
    for (const c of db.select().from(courses).where(or(containsText(courses.name, q), containsText(courses.code, q))).limit(PER_TYPE).all()) {
      hits.push({ type: 'course', id: c.id, title: c.name, subtitle: c.code, href: `/courses?course=${c.id}` });
    }
  }

  ok(res, hits);
});
