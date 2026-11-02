/**
 * Study material: notes, slides, code and video links for a course or one
 * batch of it. Files sit in private storage and are served only through an
 * authorised route; each open is logged (who and when).
 */

import { materialSchema, type MaterialDto, type materialListQuerySchema } from '@ims/shared';
import { and, count, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { db } from '../../db';
import { qualified } from '../../db/dialect';
import { batches, courses, materialAccess, materials, users, type Material } from '../../db/schema';
import { recordAudit } from '../../services/audit';
import { newKey, readStoredFile, saveFile } from '../../services/storage';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { containsText, pageWindow, paginated } from '../../utils/pagination';
import { facultyBatchIds } from '../../utils/scope';
import { checkFile, MATERIAL_TYPES, type UploadedFile } from '../documents/documents.service';

const M_ID = qualified('materials', 'id');

function query(withOpens: boolean) {
  return db
    .select({
      m: materials,
      courseName: courses.name,
      batchCode: batches.batchCode,
      uploadedByName: users.name,
      opens: withOpens ? sql<number>`(select count(*) from material_access ma where ma.material_id = ${M_ID})`.mapWith(Number) : sql<null>`null`,
    })
    .from(materials)
    .innerJoin(courses, eq(courses.id, materials.courseId))
    .leftJoin(batches, eq(batches.id, materials.batchId))
    .leftJoin(users, eq(users.id, materials.uploadedById));
}

type Row = Awaited<ReturnType<ReturnType<typeof query>['all']>>[number];

function toDto(r: Row): MaterialDto {
  const m = r.m;
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    kind: m.kind,
    courseId: m.courseId,
    courseName: r.courseName,
    batchId: m.batchId,
    batchCode: r.batchCode,
    hasFile: Boolean(m.fileKey),
    fileName: m.fileName,
    fileSize: m.fileSize,
    externalUrl: m.externalUrl,
    isPublished: m.isPublished,
    uploadedByName: r.uploadedByName,
    createdAt: m.createdAt.toISOString(),
    opens: r.opens === null ? null : Number(r.opens),
  };
}

/** Faculty: material for the courses they teach (course-wide) or their own batches. */
async function staffScope(ctx: RequestContext): Promise<SQL | undefined> {
  const ids = await facultyBatchIds(ctx);
  if (ids === null) return undefined;
  if (ids.length === 0) return sql`0`;
  const courseIds = (await db.select({ courseId: batches.courseId }).from(batches).where(inArray(batches.id, ids)).all()).map((b) => b.courseId);
  return or(inArray(materials.batchId, ids), and(isNull(materials.batchId), inArray(materials.courseId, courseIds)));
}

export async function listMaterials(ctx: RequestContext, q: z.output<typeof materialListQuerySchema>) {
  const conditions: (SQL | undefined)[] = [isNull(materials.deletedAt), await staffScope(ctx)];
  if (q.q) conditions.push(or(containsText(materials.title, q.q), containsText(materials.description, q.q)));
  if (q.courseId) conditions.push(eq(materials.courseId, q.courseId));
  if (q.batchId) conditions.push(eq(materials.batchId, q.batchId));
  if (q.kind) conditions.push(eq(materials.kind, q.kind));
  const where = and(...conditions);
  const total = (await db.select({ n: count() }).from(materials).where(where).get())?.n ?? 0;
  const { limit, offset } = pageWindow(q.page, q.limit);
  return paginated((await query(true).where(where).orderBy(desc(materials.createdAt)).limit(limit).offset(offset).all()).map(toDto), total, q.page, q.limit);
}

async function materialForStaff(ctx: RequestContext, id: string): Promise<Material> {
  const m = await db.select().from(materials).where(and(eq(materials.id, id), isNull(materials.deletedAt), await staffScope(ctx))).get();
  if (!m) throw ApiError.notFound('Material');
  return m;
}

async function assertTarget(ctx: RequestContext, courseId: string, batchId: string | undefined): Promise<void> {
  if (!await db.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId)).get()) throw ApiError.validation([{ path: 'courseId', message: 'Choose a valid course' }]);
  if (batchId) {
    const b = await db.select({ courseId: batches.courseId }).from(batches).where(eq(batches.id, batchId)).get();
    if (!b || b.courseId !== courseId) throw ApiError.validation([{ path: 'batchId', message: 'That batch is not part of the course' }]);
  }
  const ids = await facultyBatchIds(ctx);
  if (ids !== null) {
    if (batchId ? !ids.includes(batchId) : !await db.select({ id: batches.id }).from(batches).where(and(eq(batches.courseId, courseId), inArray(batches.id, ids.length ? ids : ['-']))).get()) {
      throw ApiError.forbidden('You can only share material with your own batches and courses.');
    }
  }
}

export async function createMaterial(ctx: RequestContext, file: UploadedFile | undefined, raw: unknown): Promise<MaterialDto> {
  const input = materialSchema.parse(raw);
  await assertTarget(ctx, input.courseId, input.batchId);
  if (!file && !input.externalUrl) throw ApiError.validation([{ path: 'file', message: 'Upload a file or give a link' }]);
  let stored: { key: string; name: string; mime: string; size: number } | null = null;
  if (file) {
    const { ext, mime } = checkFile(file, MATERIAL_TYPES);
    const key = newKey('materials', ext);
    await saveFile(key, file.buffer);
    stored = { key, name: file.originalname.replace(/[\\/\r\n\t"]/g, '_').slice(0, 200), mime, size: file.size };
  }
  const id = await db.transaction(async (tx) => {
    const row = await tx
      .insert(materials)
      .values({
        title: input.title,
        description: input.description ?? null,
        kind: input.kind,
        courseId: input.courseId,
        batchId: input.batchId ?? null,
        fileKey: stored?.key ?? null,
        fileName: stored?.name ?? null,
        fileMime: stored?.mime ?? null,
        fileSize: stored?.size ?? null,
        externalUrl: input.externalUrl ?? null,
        isPublished: input.isPublished,
        uploadedById: ctx.actorId || null,
      })
      .returning()
      .get();
    await recordAudit(tx, ctx, { action: 'create', entityType: 'material', entityId: row.id, summary: `Shared ${input.kind.replace('_', ' ')} "${input.title}"` });
    return row.id;
  });
  return toDto((await query(true).where(eq(materials.id, id)).get())!);
}

export async function updateMaterial(ctx: RequestContext, id: string, raw: unknown): Promise<MaterialDto> {
  const existing = await materialForStaff(ctx, id);
  const input = materialSchema.parse(raw);
  await assertTarget(ctx, input.courseId, input.batchId);
  if (!existing.fileKey && !input.externalUrl) throw ApiError.validation([{ path: 'externalUrl', message: 'A link-only item needs its link' }]);
  await db.transaction(async (tx) => {
    await tx.update(materials)
      .set({ title: input.title, description: input.description ?? null, kind: input.kind, courseId: input.courseId, batchId: input.batchId ?? null, externalUrl: input.externalUrl ?? null, isPublished: input.isPublished })
      .where(eq(materials.id, id))
      .run();
    await recordAudit(tx, ctx, { action: 'update', entityType: 'material', entityId: id, summary: `Updated material "${input.title}"${existing.isPublished !== input.isPublished ? (input.isPublished ? ' (published)' : ' (hidden)') : ''}` });
  });
  return toDto((await query(true).where(eq(materials.id, id)).get())!);
}

/** Removed from every list; the file and row stay for the access log. */
export async function deleteMaterial(ctx: RequestContext, id: string): Promise<void> {
  const existing = await materialForStaff(ctx, id);
  await db.transaction(async (tx) => {
    await tx.update(materials).set({ deletedAt: new Date() }).where(eq(materials.id, id)).run();
    await recordAudit(tx, ctx, { action: 'delete', entityType: 'material', entityId: id, summary: `Removed material "${existing.title}"` });
  });
}

/* ------------------------------------------------------------------ *
 * Students
 * ------------------------------------------------------------------ */

function studentScope(studentId: string): SQL {
  return and(
    eq(materials.isPublished, true),
    isNull(materials.deletedAt),
    sql`${materials.courseId} in (select a.course_id from admissions a where a.student_id = ${studentId} and a.status <> 'cancelled')`,
    or(isNull(materials.batchId), sql`${materials.batchId} in (select ba.batch_id from batch_assignments ba where ba.student_id = ${studentId})`),
  )!;
}

export async function portalMaterials(studentId: string): Promise<MaterialDto[]> {
  return (await query(false).where(studentScope(studentId)).orderBy(desc(materials.createdAt)).limit(500).all()).map(toDto);
}

async function logOpen(materialId: string, userId: string): Promise<void> {
  await db.insert(materialAccess).values({ materialId, userId, accessedAt: new Date() }).run();
}

/** Open (download or follow the link). `studentId` set: a student, checked against their courses. */
export async function openMaterial(ctx: RequestContext, id: string, studentId: string | null): Promise<{ file: { buffer: Buffer; fileName: string; mimeType: string } | null; url: string | null }> {
  const m = studentId
    ? await db.select().from(materials).where(and(eq(materials.id, id), studentScope(studentId))).get()
    : await materialForStaff(ctx, id);
  if (!m) throw ApiError.notFound('Material');
  await logOpen(m.id, ctx.actorId);
  if (m.fileKey) {
    const buffer = await readStoredFile(m.fileKey);
    if (!buffer) throw ApiError.conflict('The stored file is missing. Ask the institute to upload it again.', 'FILE_MISSING');
    return { file: { buffer, fileName: m.fileName ?? 'material', mimeType: m.fileMime ?? 'application/octet-stream' }, url: null };
  }
  return { file: null, url: m.externalUrl };
}

export async function materialOpens(ctx: RequestContext, id: string) {
  await materialForStaff(ctx, id);
  return (await db
    .select({ name: users.name, accountType: users.accountType, accessedAt: materialAccess.accessedAt })
    .from(materialAccess)
    .innerJoin(users, eq(users.id, materialAccess.userId))
    .where(eq(materialAccess.materialId, id))
    .orderBy(desc(materialAccess.accessedAt))
    .limit(200)
    .all())
    .map((r) => ({ name: r.name, accountType: r.accountType, accessedAt: r.accessedAt.toISOString() }));
}
