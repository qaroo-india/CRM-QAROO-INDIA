/**
 * The instalment book across all admissions: what is overdue, due soon,
 * upcoming, partially paid or settled. Paid amounts come from the ledger.
 */

import { addDays, instalmentListQuerySchema, type InstalmentRow } from '@ims/shared';
import { and, asc, count, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';
import { db } from '../../db';
import { admissions, courses, instalments, students } from '../../db/schema';
import { instituteToday } from '../../services/clock';
import { instalmentPaidSql } from '../../services/ledger';
import { containsText, pageWindow, paginated } from '../../utils/pagination';

const i = alias(instalments, 'i');

type Query = z.output<typeof instalmentListQuerySchema>;

export function listInstalments(query: Query) {
  const today = instituteToday();
  const paid = instalmentPaidSql();
  const remaining = sql<number>`max(0, ${i.amountMinor} - ${paid})`;

  const conditions: SQL[] = [sql`${admissions.status} <> 'cancelled'`];
  const open = and(eq(i.state, 'active'), sql`${remaining} > 0`)!;
  switch (query.view ?? 'all_open') {
    case 'overdue':
      conditions.push(open, sql`${i.dueDate} < ${today}`);
      break;
    case 'due_soon':
      conditions.push(open, sql`${i.dueDate} >= ${today}`, sql`${i.dueDate} <= ${addDays(today, 7)}`);
      break;
    case 'upcoming':
      conditions.push(open, sql`${i.dueDate} >= ${today}`);
      break;
    case 'partially_paid':
      conditions.push(open, sql`${paid} > 0`);
      break;
    case 'paid':
      conditions.push(eq(i.state, 'active'), sql`${remaining} = 0`);
      break;
    case 'all_open':
      conditions.push(open);
      break;
  }
  if (query.from) conditions.push(sql`${i.dueDate} >= ${query.from}`);
  if (query.to) conditions.push(sql`${i.dueDate} <= ${query.to}`);
  if (query.courseId) conditions.push(eq(admissions.courseId, query.courseId));
  if (query.admissionId) conditions.push(eq(i.admissionId, query.admissionId));
  if (query.q) {
    const digits = query.q.replace(/\D/g, '');
    const text = [containsText(students.fullName, query.q), containsText(students.studentCode, query.q), containsText(admissions.admissionNumber, query.q)];
    if (digits.length >= 4) text.push(containsText(students.phoneNormalized, digits));
    conditions.push(or(...text)!);
  }
  const where = and(...conditions);

  const base = () =>
    db
      .select({
        inst: i,
        paidMinor: paid.mapWith(Number),
        status: sql<string>`case when ${i.state} <> 'active' then ${i.state} when ${paid} >= ${i.amountMinor} then 'paid' when ${i.dueDate} < ${today} then 'overdue' when ${paid} > 0 then 'partially_paid' else 'scheduled' end`,
        studentId: students.id,
        studentName: students.fullName,
        studentCode: students.studentCode,
        studentPhone: students.phone,
        admissionNumber: admissions.admissionNumber,
        courseName: courses.name,
      })
      .from(i)
      .innerJoin(admissions, eq(admissions.id, i.admissionId))
      .innerJoin(students, eq(students.id, admissions.studentId))
      .innerJoin(courses, eq(courses.id, admissions.courseId));

  const totals = db
    .select({
      n: count(),
      due: sql<number>`coalesce(sum(${i.amountMinor}), 0)`.mapWith(Number),
      remaining: sql<number>`coalesce(sum(${remaining}), 0)`.mapWith(Number),
    })
    .from(i)
    .innerJoin(admissions, eq(admissions.id, i.admissionId))
    .innerJoin(students, eq(students.id, admissions.studentId))
    .where(where)
    .get()!;

  const { limit, offset } = pageWindow(query.page, query.limit);
  const ascending = query.order === 'asc' || (query.view !== 'paid' && !query.sort);
  const rows = base()
    .where(where)
    .orderBy(ascending ? asc(i.dueDate) : desc(i.dueDate), asc(i.sequence))
    .limit(limit)
    .offset(offset)
    .all();

  const items: InstalmentRow[] = rows.map((r) => ({
    id: r.inst.id,
    feePlanId: r.inst.feePlanId,
    admissionId: r.inst.admissionId,
    sequence: r.inst.sequence,
    kind: r.inst.kind,
    dueDate: r.inst.dueDate,
    amountMinor: r.inst.amountMinor,
    paidMinor: r.paidMinor,
    remainingMinor: r.inst.state === 'active' ? Math.max(0, r.inst.amountMinor - r.paidMinor) : 0,
    status: r.status,
    state: r.inst.state,
    studentId: r.studentId,
    studentName: r.studentName,
    studentCode: r.studentCode,
    studentPhone: r.studentPhone,
    admissionNumber: r.admissionNumber,
    courseName: r.courseName,
  }));

  return { ...paginated(items, totals.n, query.page, query.limit), summary: { scheduledMinor: totals.due, remainingMinor: totals.remaining } };
}
