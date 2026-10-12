/**
 * Document center: files attached to students, admissions, loans, expenses,
 * placement applications or the institute itself.
 *
 * - Only an allow-list of types is accepted, checked by extension, declared
 *   type AND the file's first bytes, so a renamed executable is refused.
 * - Files live in private storage and are only served through an authorised
 *   download route, as attachments, with nosniff.
 * - 'restricted' documents (loan paperwork, identity proofs) are invisible
 *   without documents:restricted -- not just undownloadable, unlisted.
 * - Deleting is a soft delete with a reason; the file and row are retained.
 */

import { extname } from 'node:path';
import {
  documentDeleteSchema,
  documentUploadSchema,
  hasPermission,
  type DocumentDto,
  type DocumentOwnerType,
  type Permission,
  type documentListQuerySchema,
} from '@ims/shared';
import { and, count, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';
import { db } from '../../db';
import { admissions, documents, expenses, loans, placementApplications, students, users, type DocumentRow } from '../../db/schema';
import { recordAudit } from '../../services/audit';
import { newKey, readStoredFile, saveFile } from '../../services/storage';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { containsText, pageWindow, paginated } from '../../utils/pagination';

export interface FileType {
  mime: string;
  /** Magic-number check on the first bytes; null = text, checked for NUL bytes. */
  sniff: ((head: Buffer) => boolean) | null;
}

const starts = (...bytes: number[]) => (head: Buffer) => bytes.every((b, i) => head[i] === b);
const ZIP = starts(0x50, 0x4b, 0x03, 0x04);
const OLE = starts(0xd0, 0xcf, 0x11, 0xe0);

export const ALLOWED_TYPES: Record<string, FileType> = {
  '.pdf': { mime: 'application/pdf', sniff: starts(0x25, 0x50, 0x44, 0x46, 0x2d) },
  '.png': { mime: 'image/png', sniff: starts(0x89, 0x50, 0x4e, 0x47) },
  '.jpg': { mime: 'image/jpeg', sniff: starts(0xff, 0xd8, 0xff) },
  '.jpeg': { mime: 'image/jpeg', sniff: starts(0xff, 0xd8, 0xff) },
  '.webp': { mime: 'image/webp', sniff: (h) => h.subarray(0, 4).toString('latin1') === 'RIFF' && h.subarray(8, 12).toString('latin1') === 'WEBP' },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sniff: ZIP },
  '.xlsx': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sniff: ZIP },
  '.doc': { mime: 'application/msword', sniff: OLE },
  '.xls': { mime: 'application/vnd.ms-excel', sniff: OLE },
  '.csv': { mime: 'text/csv', sniff: null },
  '.txt': { mime: 'text/plain', sniff: null },
};

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Validate a file against the allow-list; returns the canonical type. */
/** Study material also accepts slides and source-code archives. */
export const MATERIAL_TYPES: Record<string, FileType> = {
  ...ALLOWED_TYPES,
  '.pptx': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', sniff: ZIP },
  '.ppt': { mime: 'application/vnd.ms-powerpoint', sniff: OLE },
  '.zip': { mime: 'application/zip', sniff: ZIP },
  '.md': { mime: 'text/markdown', sniff: null },
};

export function checkFile(file: UploadedFile | undefined, allowed: Record<string, FileType> = ALLOWED_TYPES): { ext: string; mime: string } {
  if (!file) throw ApiError.validation([{ path: 'file', message: 'Choose a file to upload' }]);
  if (file.size === 0) throw ApiError.validation([{ path: 'file', message: 'The file is empty' }]);
  const ext = extname(file.originalname).toLowerCase();
  const type = allowed[ext];
  if (!type) {
    const list = Object.keys(allowed).map((e) => e.slice(1).toUpperCase()).join(', ');
    throw ApiError.validation([{ path: 'file', message: `${ext || 'This file type'} is not allowed. Use ${list}.` }]);
  }
  const head = file.buffer.subarray(0, 16);
  const contentOk = type.sniff ? type.sniff(head) : !file.buffer.subarray(0, 4096).includes(0);
  if (!contentOk) throw ApiError.validation([{ path: 'file', message: `The file's contents do not match a ${ext} file` }]);
  return { ext, mime: type.mime };
}

/** Loan paperwork and identity documents are always restricted. */
function effectiveAccess(ownerType: DocumentOwnerType, kind: string, requested: 'general' | 'restricted'): 'general' | 'restricted' {
  if (ownerType === 'loan' || /identity/i.test(kind)) return 'restricted';
  return requested;
}

function ownerExists(ownerType: DocumentOwnerType, ownerId: string): boolean {
  const table = { student: students, admission: admissions, loan: loans, expense: expenses, placement_application: placementApplications }[ownerType as Exclude<DocumentOwnerType, 'institute'>];
  if (!table) return true;
  return Boolean(db.select({ id: table.id }).from(table).where(eq(table.id, ownerId)).get());
}

/** "Priya Sharma (STU-2026-00012)" etc., for lists that mix owners. */
function ownerLabels(rows: DocumentRow[]): Map<string, string> {
  const labels = new Map<string, string>();
  const ids = (type: DocumentOwnerType) => [...new Set(rows.filter((r) => r.ownerType === type).map((r) => r.ownerId))];
  const put = (list: { id: string; label: string }[]) => list.forEach((r) => labels.set(r.id, r.label));
  const inList = (column: SQL, values: string[]) => sql`${column} in (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
  const s = ids('student');
  if (s.length) put(db.all<{ id: string; label: string }>(sql`select id, full_name || ' (' || student_code || ')' as label from students where ${inList(sql`id`, s)}`));
  const a = ids('admission');
  if (a.length) put(db.all<{ id: string; label: string }>(sql`select a.id, s.full_name || ' · ' || a.admission_number as label from admissions a join students s on s.id = a.student_id where ${inList(sql`a.id`, a)}`));
  const l = ids('loan');
  if (l.length) put(db.all<{ id: string; label: string }>(sql`select l.id, s.full_name || ' · ' || l.provider_name as label from loans l join students s on s.id = l.student_id where ${inList(sql`l.id`, l)}`));
  const e = ids('expense');
  if (e.length) put(db.all<{ id: string; label: string }>(sql`select id, expense_code || ' · ' || description as label from expenses where ${inList(sql`id`, e)}`));
  const p = ids('placement_application');
  if (p.length) put(db.all<{ id: string; label: string }>(sql`select pa.id, s.full_name || ' · ' || c.name as label from placement_applications pa join students s on s.id = pa.student_id join companies c on c.id = pa.company_id where ${inList(sql`pa.id`, p)}`));
  return labels;
}

const uploader = alias(users, 'uploader');

function toDtos(rows: { d: DocumentRow; uploadedByName: string | null }[]): DocumentDto[] {
  const labels = ownerLabels(rows.map((r) => r.d));
  return rows.map(({ d, uploadedByName }) => ({
    id: d.id,
    ownerType: d.ownerType,
    ownerId: d.ownerId,
    ownerLabel: d.ownerType === 'institute' ? 'Institute' : (labels.get(d.ownerId) ?? null),
    kind: d.kind,
    title: d.title,
    fileName: d.fileName,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    accessLevel: d.accessLevel,
    uploadedByName,
    createdAt: d.createdAt.toISOString(),
  }));
}

/** Seeing a record's documents requires being allowed to see the record. */
const OWNER_READ: Record<DocumentOwnerType, Permission | null> = {
  student: 'students:read',
  admission: 'admissions:read',
  loan: 'loans:read',
  expense: 'expenses:read',
  placement_application: 'placements:read',
  institute: null,
};

function readableOwnerTypes(ctx: RequestContext): DocumentOwnerType[] {
  return (Object.keys(OWNER_READ) as DocumentOwnerType[]).filter((t) => OWNER_READ[t] === null || hasPermission(ctx.permissions, OWNER_READ[t]!));
}

function canSee(ctx: RequestContext, row: Pick<DocumentRow, 'accessLevel' | 'ownerType'>): boolean {
  if (row.accessLevel === 'restricted' && !hasPermission(ctx.permissions, 'documents:restricted')) return false;
  return readableOwnerTypes(ctx).includes(row.ownerType);
}

function visibleTo(ctx: RequestContext): SQL | undefined {
  return and(
    hasPermission(ctx.permissions, 'documents:restricted') ? undefined : eq(documents.accessLevel, 'general'),
    inArray(documents.ownerType, readableOwnerTypes(ctx)),
  );
}

export function listDocuments(ctx: RequestContext, q: z.output<typeof documentListQuerySchema>) {
  const conditions: (SQL | undefined)[] = [isNull(documents.deletedAt), visibleTo(ctx)];
  if (q.ownerType) conditions.push(eq(documents.ownerType, q.ownerType));
  if (q.ownerId) conditions.push(eq(documents.ownerId, q.ownerId));
  if (q.kind) conditions.push(eq(documents.kind, q.kind));
  if (q.accessLevel) conditions.push(eq(documents.accessLevel, q.accessLevel));
  if (q.q) conditions.push(or(containsText(documents.title, q.q), containsText(documents.fileName, q.q), containsText(documents.kind, q.q)));
  const where = and(...conditions);
  const total = db.select({ n: count() }).from(documents).where(where).get()?.n ?? 0;
  const { limit, offset } = pageWindow(q.page, q.limit);
  const rows = db
    .select({ d: documents, uploadedByName: uploader.name })
    .from(documents)
    .leftJoin(uploader, eq(uploader.id, documents.uploadedById))
    .where(where)
    .orderBy(desc(documents.createdAt), desc(documents.id))
    .limit(limit)
    .offset(offset)
    .all();
  return paginated(toDtos(rows), total, q.page, q.limit);
}

/** Documents for a student: their own plus those on their admissions and loans. */
export function studentDocuments(ctx: RequestContext, studentId: string): DocumentDto[] {
  const rows = db
    .select({ d: documents, uploadedByName: uploader.name })
    .from(documents)
    .leftJoin(uploader, eq(uploader.id, documents.uploadedById))
    .where(
      and(
        isNull(documents.deletedAt),
        visibleTo(ctx),
        or(
          and(eq(documents.ownerType, 'student'), eq(documents.ownerId, studentId)),
          and(eq(documents.ownerType, 'admission'), sql`${documents.ownerId} in (select id from admissions where student_id = ${studentId})`),
          and(eq(documents.ownerType, 'loan'), sql`${documents.ownerId} in (select id from loans where student_id = ${studentId})`),
          and(eq(documents.ownerType, 'placement_application'), sql`${documents.ownerId} in (select id from placement_applications where student_id = ${studentId})`),
        ),
      ),
    )
    .orderBy(desc(documents.createdAt))
    .all();
  return toDtos(rows);
}

function getRow(ctx: RequestContext, id: string): DocumentRow {
  const row = db.select().from(documents).where(and(eq(documents.id, id), isNull(documents.deletedAt))).get();
  // A document the user may not see is "not found": they may not know it exists.
  if (!row || !canSee(ctx, row)) throw ApiError.notFound('Document');
  return row;
}

export function getDocument(ctx: RequestContext, id: string): DocumentDto {
  const row = getRow(ctx, id);
  const uploadedByName = row.uploadedById ? (db.select({ name: users.name }).from(users).where(eq(users.id, row.uploadedById)).get()?.name ?? null) : null;
  return toDtos([{ d: row, uploadedByName }])[0]!;
}

export function uploadDocument(ctx: RequestContext, file: UploadedFile | undefined, fields: unknown): DocumentDto {
  const input = documentUploadSchema.parse(fields);
  const { ext, mime } = checkFile(file);
  const ownerId = input.ownerType === 'institute' ? 'institute' : input.ownerId;
  if (!ownerId) throw ApiError.validation([{ path: 'ownerId', message: 'Choose what this document belongs to' }]);
  const ownerPermission = OWNER_READ[input.ownerType];
  if (ownerPermission && !hasPermission(ctx.permissions, ownerPermission)) throw ApiError.forbidden(`Attaching files to a ${input.ownerType.replace(/_/g, ' ')} needs access to it (${ownerPermission}).`);
  if (!ownerExists(input.ownerType, ownerId)) throw ApiError.validation([{ path: 'ownerId', message: 'That record does not exist' }]);
  const accessLevel = effectiveAccess(input.ownerType, input.kind, input.accessLevel);
  if (accessLevel === 'restricted' && !hasPermission(ctx.permissions, 'documents:restricted')) {
    throw ApiError.forbidden('Restricted documents (loan paperwork, identity proofs) need the restricted documents permission.');
  }

  const key = newKey('documents', ext);
  saveFile(key, file!.buffer);
  const safeName = file!.originalname.replace(/[\\/\r\n\t"]/g, '_').slice(0, 200);
  const id = db.transaction((tx) => {
    const doc = tx
      .insert(documents)
      .values({ ownerType: input.ownerType, ownerId, kind: input.kind, title: input.title, fileName: safeName, mimeType: mime, sizeBytes: file!.size, storageKey: key, accessLevel, uploadedById: ctx.actorId })
      .returning()
      .get();
    // An expense receipt is linked to its expense for the expenses screen.
    if (input.ownerType === 'expense' && /receipt|invoice|bill/i.test(input.kind)) {
      tx.update(expenses).set({ receiptDocumentId: doc.id }).where(eq(expenses.id, ownerId)).run();
    }
    recordAudit(tx, ctx, { action: 'create', entityType: 'document', entityId: doc.id, summary: `Uploaded ${input.kind.toLowerCase()} "${input.title}" (${accessLevel}) to ${input.ownerType.replace(/_/g, ' ')}`, after: { ownerType: input.ownerType, ownerId, kind: input.kind, title: input.title, fileName: safeName, sizeBytes: file!.size, accessLevel } });
    return doc.id;
  });
  return getDocument(ctx, id);
}

export function downloadDocument(ctx: RequestContext, id: string): { buffer: Buffer; fileName: string; mimeType: string } {
  const row = getRow(ctx, id);
  const buffer = readStoredFile(row.storageKey);
  if (!buffer) throw ApiError.conflict('The stored file is missing. Upload it again.', 'FILE_MISSING');
  if (row.accessLevel === 'restricted') {
    recordAudit(db, ctx, { action: 'export', entityType: 'document', entityId: row.id, summary: `Downloaded restricted document "${row.title}"` });
  }
  return { buffer, fileName: row.fileName, mimeType: row.mimeType };
}

export function deleteDocument(ctx: RequestContext, id: string, raw: unknown): void {
  const { reason } = documentDeleteSchema.parse(raw);
  const row = getRow(ctx, id);
  db.transaction((tx) => {
    tx.update(documents).set({ deletedAt: new Date(), deletedById: ctx.actorId }).where(eq(documents.id, id)).run();
    tx.update(expenses).set({ receiptDocumentId: null }).where(eq(expenses.receiptDocumentId, id)).run();
    recordAudit(tx, ctx, { action: 'delete', entityType: 'document', entityId: id, summary: `Removed document "${row.title}": ${reason} (file retained)`, before: { title: row.title, fileName: row.fileName, ownerType: row.ownerType, ownerId: row.ownerId } });
  });
}

