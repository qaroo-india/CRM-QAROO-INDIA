/**
 * GET  /courses          courses:read    ?q, active, track
 * GET  /courses/:id      courses:read
 * POST /courses          courses:write
 * PUT  /courses/:id      courses:write   full replace
 *
 * Courses are never deleted: deactivate one to stop new admissions while
 * every past admission keeps pointing at it.
 */

import { courseListQuerySchema, courseSchema, type CourseDto } from '@ims/shared';
import { and, asc, eq, ne, or, sql, type SQL } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../../db';
import { qualified } from '../../db/dialect';
import { courses, type Course } from '../../db/schema';
import { requirePermission } from '../../middleware/auth';
import { diff, recordAudit } from '../../services/audit';
import { ApiError } from '../../utils/ApiError';
import { contextFrom, type RequestContext } from '../../utils/context';
import { containsText } from '../../utils/pagination';
import { created, ok } from '../../utils/respond';
import { paramId, parseBody, parseQuery } from '../../utils/validate';

export const coursesRouter = Router();

// qualified(): the outer query has no joins, so a plain ${courses.id} would
// render as an unqualified "id" and bind to the subquery's own table.
const activeAdmissions = sql<number>`(select count(*) from admissions a where a.course_id = ${qualified('courses', 'id')} and a.status in ('pending_payment', 'active'))`;

function toDto(row: Course & { activeAdmissions: number }): CourseDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    durationWeeks: row.durationWeeks,
    standardFeeMinor: row.standardFeeMinor,
    modules: row.modules,
    placementTrack: row.placementTrack ?? null,
    defaultAdmissionFeeMinor: row.defaultAdmissionFeeMinor,
    defaultInstalmentCount: row.defaultInstalmentCount,
    isActive: row.isActive,
    activeAdmissions: Number(row.activeAdmissions),
    createdAt: row.createdAt.toISOString(),
  };
}

function fetchCourse(id: string): CourseDto {
  const row = db.select({ course: courses, activeAdmissions }).from(courses).where(eq(courses.id, id)).get();
  if (!row) throw ApiError.notFound('Course');
  return toDto({ ...row.course, activeAdmissions: row.activeAdmissions });
}

function assertCodeFree(code: string, exceptId?: string): void {
  const clash = db
    .select({ id: courses.id })
    .from(courses)
    .where(and(sql`upper(${courses.code}) = ${code.toUpperCase()}`, exceptId ? ne(courses.id, exceptId) : undefined))
    .get();
  if (clash) throw ApiError.conflict(`A course with code ${code} already exists.`);
}

coursesRouter.get('/', requirePermission('courses:read'), (req, res) => {
  const query = parseQuery(courseListQuerySchema, req);
  const conditions: SQL[] = [];
  if (query.q) conditions.push(or(containsText(courses.name, query.q), containsText(courses.code, query.q))!);
  if (query.active) conditions.push(eq(courses.isActive, query.active === 'true'));
  if (query.track) conditions.push(or(eq(courses.placementTrack, query.track), eq(courses.placementTrack, 'both'))!);

  const rows = db
    .select({ course: courses, activeAdmissions })
    .from(courses)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(sql`${courses.isActive} desc`, asc(courses.name))
    .all();
  ok(res, rows.map((r) => toDto({ ...r.course, activeAdmissions: r.activeAdmissions })));
});

coursesRouter.get('/:id', requirePermission('courses:read'), (req, res) => {
  ok(res, fetchCourse(paramId(req)));
});

/** Create a course (also used by the demo seed). */
export function createCourse(ctx: RequestContext, raw: unknown): CourseDto {
  const input = courseSchema.parse(raw);
  assertCodeFree(input.code);

  const row = db.transaction((tx) => {
    const inserted = tx
      .insert(courses)
      .values({
        ...input,
        description: input.description ?? null,
        durationWeeks: input.durationWeeks ?? null,
        defaultAdmissionFeeMinor: input.defaultAdmissionFeeMinor ?? null,
        defaultInstalmentCount: input.defaultInstalmentCount ?? null,
        createdById: ctx.actorId,
      })
      .returning()
      .get();
    recordAudit(tx, ctx, { action: 'create', entityType: 'course', entityId: inserted.id, summary: `Created course ${inserted.code} ${inserted.name}`, after: inserted });
    return inserted;
  });
  return fetchCourse(row.id);
}

coursesRouter.post('/', requirePermission('courses:write'), (req, res) => {
  created(res, createCourse(contextFrom(req), req.body));
});

coursesRouter.put('/:id', requirePermission('courses:write'), (req, res) => {
  const id = paramId(req);
  const input = parseBody(courseSchema, req);
  const ctx = contextFrom(req);
  const existing = db.select().from(courses).where(eq(courses.id, id)).get();
  if (!existing) throw ApiError.notFound('Course');
  assertCodeFree(input.code, id);

  db.transaction((tx) => {
    const updated = tx
      .update(courses)
      .set({
        ...input,
        description: input.description ?? null,
        durationWeeks: input.durationWeeks ?? null,
        defaultAdmissionFeeMinor: input.defaultAdmissionFeeMinor ?? null,
        defaultInstalmentCount: input.defaultInstalmentCount ?? null,
      })
      .where(eq(courses.id, id))
      .returning()
      .get();
    recordAudit(tx, ctx, {
      action: 'update',
      entityType: 'course',
      entityId: id,
      summary: `Updated course ${updated.code}`,
      ...diff(existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>),
    });
  });
  ok(res, fetchCourse(id));
});
