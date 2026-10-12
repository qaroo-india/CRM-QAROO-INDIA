/**
 * Duplicate detection across leads and students.
 *
 * Phones are compared on their last 10 digits ("+91 98765-43210" and
 * "9876543210" are the same person); emails case-insensitively. A match is a
 * warning for leads and a confirmation step for new students -- the brief
 * forbids duplicating a student's identity silently.
 */

import { normalisePhone, type DuplicateMatch } from '@ims/shared';
import { and, eq, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { leads, students } from '../db/schema';

interface DuplicateQuery {
  phone?: string;
  email?: string;
  excludeLeadId?: string;
  excludeStudentId?: string;
}

function matchedOn(row: { phoneNormalized: string; email: string | null }, phone: string | null, email: string | null) {
  const on: ('phone' | 'email')[] = [];
  if (phone && row.phoneNormalized === phone) on.push('phone');
  if (email && row.email?.toLowerCase() === email) on.push('email');
  return on;
}

export function findDuplicates(query: DuplicateQuery): DuplicateMatch[] {
  const phone = query.phone ? normalisePhone(query.phone) : null;
  const email = query.email?.trim().toLowerCase() || null;
  if ((!phone || phone.length < 7) && !email) return [];

  const leadConditions: SQL[] = [];
  if (phone && phone.length >= 7) leadConditions.push(eq(leads.phoneNormalized, phone));
  if (email) leadConditions.push(sql`lower(${leads.email}) = ${email}`);
  const studentConditions: SQL[] = [];
  if (phone && phone.length >= 7) studentConditions.push(eq(students.phoneNormalized, phone));
  if (email) studentConditions.push(sql`lower(${students.email}) = ${email}`);

  const leadRows = db
    .select()
    .from(leads)
    .where(and(or(...leadConditions), query.excludeLeadId ? ne(leads.id, query.excludeLeadId) : undefined))
    .limit(10)
    .all();
  const studentRows = db
    .select()
    .from(students)
    .where(and(or(...studentConditions), query.excludeStudentId ? ne(students.id, query.excludeStudentId) : undefined))
    .limit(10)
    .all();

  return [
    ...studentRows.map<DuplicateMatch>((s) => ({
      kind: 'student',
      id: s.id,
      code: s.studentCode,
      name: s.fullName,
      phone: s.phone,
      email: s.email,
      status: null,
      matchedOn: matchedOn(s, phone, email),
    })),
    ...leadRows.map<DuplicateMatch>((l) => ({
      kind: 'lead',
      id: l.id,
      code: l.leadCode,
      name: l.name,
      phone: l.phone,
      email: l.email,
      status: l.status,
      matchedOn: matchedOn(l, phone, email),
    })),
  ];
}

export function findDuplicateStudents(phone: string, email?: string, excludeStudentId?: string): DuplicateMatch[] {
  return findDuplicates({ phone, email, excludeStudentId }).filter((m) => m.kind === 'student');
}
