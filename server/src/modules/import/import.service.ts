/**
 * Bulk import of leads or students from CSV / Excel, in two steps:
 *
 *   1. preview -- parse, map columns, validate every row with the same
 *      schemas the forms use, and flag duplicates (existing records by phone
 *      or email, and repeats inside the file). Nothing is written.
 *   2. commit  -- the user confirms which rows to import; each row goes
 *      through the normal create path (codes, audit trail, duplicate rules).
 *
 * Previews are kept for 30 minutes, in the database so any server instance
 * can confirm them, and only for the user who made them. Dates with slashes
 * are read day-first (DD/MM/YYYY), as written in India.
 */

import { randomBytes } from 'node:crypto';
import { leadSchema, normalisePhone, studentSchema, type ImportEntity, type ImportPreview, type ImportResult, type ImportRowResult, importCommitSchema } from '@ims/shared';
import { and, eq, gt, lt } from 'drizzle-orm';
import { db } from '../../db';
import { courses, importPreviews, leadSources, users } from '../../db/schema';
import { recordAudit } from '../../services/audit';
import { instituteToday } from '../../services/clock';
import { findDuplicates } from '../../services/duplicates';
import { readTable } from '../../services/tabular';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { createLead } from '../leads/leads.service';
import { createStudent } from '../students/students.service';
import type { UploadedFile } from '../documents/documents.service';
import { mapSeries } from '../../utils/series';

export const MAX_IMPORT_ROWS = 2000;
const TTL_MS = 30 * 60_000;

async function prune(now = new Date()) {
  await db.delete(importPreviews).where(lt(importPreviews.expiresAt, now)).run();
}

const norm = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '');

const LEAD_FIELDS: Record<string, string[]> = {
  name: ['name', 'fullname', 'leadname', 'studentname', 'candidatename'],
  phone: ['phone', 'mobile', 'phonenumber', 'mobilenumber', 'contact', 'contactnumber', 'whatsapp'],
  email: ['email', 'emailaddress', 'emailid', 'mail'],
  enquiryDate: ['enquirydate', 'inquirydate', 'date', 'enquiredon', 'createdon'],
  source: ['source', 'leadsource', 'channel'],
  course: ['course', 'interestedcourse', 'program', 'programme'],
  counsellor: ['counsellor', 'counselor', 'assignedto', 'owner'],
  followUpDate: ['followupdate', 'followup', 'nextfollowup', 'nextfollowupdate'],
  priority: ['priority'],
  campaignName: ['campaign', 'campaignname'],
  adReference: ['ad', 'adreference', 'adname', 'adid'],
  utmSource: ['utmsource'],
  utmMedium: ['utmmedium'],
  utmCampaign: ['utmcampaign'],
  utmTerm: ['utmterm'],
  utmContent: ['utmcontent'],
  notes: ['notes', 'note', 'remarks', 'comments', 'comment'],
};

const STUDENT_FIELDS: Record<string, string[]> = {
  fullName: ['name', 'fullname', 'studentname'],
  phone: ['phone', 'mobile', 'phonenumber', 'mobilenumber', 'contact', 'contactnumber'],
  email: ['email', 'emailaddress', 'emailid', 'mail'],
  address: ['address'],
  city: ['city', 'town'],
  dateOfBirth: ['dateofbirth', 'dob', 'birthdate'],
  emergencyContactName: ['emergencycontactname', 'guardianname', 'parentname', 'emergencycontact'],
  emergencyContactPhone: ['emergencycontactphone', 'guardianphone', 'parentphone', 'emergencyphone'],
  notes: ['notes', 'note', 'remarks', 'comments'],
};

/** 'YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY' or 'DD.MM.YYYY' -> 'YYYY-MM-DD'; else unchanged (schema reports it). */
export function normaliseDate(value: string): string {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return v;
}

function mapColumns(headers: string[], fields: Record<string, string[]>): Map<number, string> {
  const map = new Map<number, string>();
  headers.forEach((header, index) => {
    const key = norm(header);
    const field = Object.entries(fields).find(([, aliases]) => aliases.includes(key))?.[0];
    if (field && ![...map.values()].includes(field)) map.set(index, field);
  });
  return map;
}

async function lookups() {
  const sources = await db.select({ id: leadSources.id, name: leadSources.name, isActive: leadSources.isActive }).from(leadSources).all();
  const courseRows = await db.select({ id: courses.id, name: courses.name, code: courses.code }).from(courses).all();
  const people = await db.select({ id: users.id, name: users.name, email: users.email, isActive: users.isActive }).from(users).all();
  const find = <T extends { name: string }>(list: T[], value: string, extra?: (item: T) => string[]) =>
    list.find((item) => [item.name, ...(extra?.(item) ?? [])].some((v) => v.trim().toLowerCase() === value.trim().toLowerCase()));
  return {
    source: (v: string) => find(sources.filter((s) => s.isActive), v),
    course: (v: string) => find(courseRows, v, (c) => [c.code]),
    counsellor: (v: string) => find(people.filter((p) => p.isActive), v, (p) => [p.email]),
  };
}

export async function previewImport(ctx: RequestContext, entity: ImportEntity, file: UploadedFile | undefined): Promise<ImportPreview> {
  if (!file) throw ApiError.validation([{ path: 'file', message: 'Choose a CSV or Excel (.xlsx) file' }]);
  const lower = file.originalname.toLowerCase();
  if (!lower.endsWith('.csv') && !lower.endsWith('.xlsx')) throw ApiError.validation([{ path: 'file', message: 'Use a .csv or .xlsx file' }]);
  let table;
  try {
    table = await readTable(file.buffer, file.originalname);
  } catch {
    throw ApiError.validation([{ path: 'file', message: 'The file could not be read. Save it again as CSV (UTF-8) or .xlsx.' }]);
  }
  if (table.rows.length === 0) throw ApiError.validation([{ path: 'file', message: 'The file has a header row but no data rows' }]);
  if (table.rows.length > MAX_IMPORT_ROWS) throw ApiError.validation([{ path: 'file', message: `At most ${MAX_IMPORT_ROWS} rows per import; this file has ${table.rows.length}` }]);

  const fields = entity === 'leads' ? LEAD_FIELDS : STUDENT_FIELDS;
  const columns = mapColumns(table.headers, fields);
  const mapped = new Set(columns.values());
  const required = entity === 'leads' ? ['name', 'phone', 'source'] : ['fullName', 'phone'];
  const missing = required.filter((f) => !mapped.has(f));
  if (missing.length) {
    throw ApiError.validation([{ path: 'file', message: `Missing column(s): ${missing.join(', ')}. Found: ${table.headers.join(', ') || 'none'}` }]);
  }

  const find = await lookups();
  const today = instituteToday();
  const seenPhones = new Map<string, number>();
  const seenEmails = new Map<string, number>();

  const rows: ImportRowResult[] = (await mapSeries(table.rows, async (cells, index) => {
    const rowNumber = index + 1;
    const raw: Record<string, string> = {};
    columns.forEach((field, col) => {
      raw[field] = (cells[col] ?? '').trim();
    });
    const errors: ImportRowResult['errors'] = [];
    let data: Record<string, unknown>;

    if (entity === 'leads') {
      const source = raw.source ? find.source(raw.source) : undefined;
      if (raw.source && !source) errors.push({ field: 'source', message: `Unknown lead source "${raw.source}"` });
      const course = raw.course ? find.course(raw.course) : undefined;
      if (raw.course && !course) errors.push({ field: 'course', message: `Unknown course "${raw.course}"` });
      const counsellor = raw.counsellor ? find.counsellor(raw.counsellor) : undefined;
      if (raw.counsellor && !counsellor) errors.push({ field: 'counsellor', message: `No active staff member "${raw.counsellor}"` });
      data = {
        name: raw.name,
        phone: raw.phone,
        email: raw.email || undefined,
        enquiryDate: raw.enquiryDate ? normaliseDate(raw.enquiryDate) : today,
        leadSourceId: source?.id ?? '',
        interestedCourseId: course?.id,
        counsellorId: counsellor?.id,
        followUpDate: raw.followUpDate ? normaliseDate(raw.followUpDate) : undefined,
        priority: raw.priority ? raw.priority.toLowerCase() : undefined,
        campaignName: raw.campaignName || undefined,
        adReference: raw.adReference || undefined,
        utmSource: raw.utmSource || undefined,
        utmMedium: raw.utmMedium || undefined,
        utmCampaign: raw.utmCampaign || undefined,
        utmTerm: raw.utmTerm || undefined,
        utmContent: raw.utmContent || undefined,
        notes: raw.notes || undefined,
      };
      const parsed = leadSchema.safeParse(data);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const field = String(issue.path[0] ?? 'row');
          if (field === 'leadSourceId' && errors.some((e) => e.field === 'source')) continue;
          errors.push({ field: field === 'leadSourceId' ? 'source' : field, message: issue.message });
        }
      } else data = parsed.data;
      // Display names alongside ids for the preview table.
      data = { ...data, sourceName: source?.name ?? raw.source, courseName: course?.name ?? (raw.course || null), counsellorName: counsellor?.name ?? (raw.counsellor || null) };
    } else {
      data = {
        fullName: raw.fullName,
        phone: raw.phone,
        email: raw.email || undefined,
        address: raw.address || undefined,
        city: raw.city || undefined,
        dateOfBirth: raw.dateOfBirth ? normaliseDate(raw.dateOfBirth) : undefined,
        emergencyContactName: raw.emergencyContactName || undefined,
        emergencyContactPhone: raw.emergencyContactPhone || undefined,
        notes: raw.notes || undefined,
      };
      const parsed = studentSchema.safeParse(data);
      if (!parsed.success) for (const issue of parsed.error.issues) errors.push({ field: String(issue.path[0] ?? 'row'), message: issue.message });
      else data = parsed.data;
    }

    const duplicates: ImportRowResult['duplicates'] = [];
    const phone = raw.phone ? normalisePhone(raw.phone) : '';
    const email = (raw.email ?? '').toLowerCase();
    if (phone.length >= 7 || email) {
      const matches = (await findDuplicates({ phone: raw.phone, email: raw.email || undefined })).filter((m) => (entity === 'students' ? m.kind === 'student' : true));
      for (const m of matches.slice(0, 3)) duplicates.push({ kind: 'existing', label: `${m.kind === 'lead' ? 'Lead' : 'Student'} ${m.code} · ${m.name} (${m.matchedOn.join(' & ')})` });
      const earlier = (phone.length >= 7 && seenPhones.get(phone)) || (email && seenEmails.get(email));
      if (earlier) duplicates.push({ kind: 'in_file', label: `Same ${seenPhones.get(phone) === earlier ? 'phone' : 'email'} as row ${earlier}` });
      if (phone.length >= 7 && !seenPhones.has(phone)) seenPhones.set(phone, rowNumber);
      if (email && !seenEmails.has(email)) seenEmails.set(email, rowNumber);
    }
    return { row: rowNumber, data, errors, duplicates };
  }));

  await prune();
  const token = randomBytes(18).toString('base64url');
  const expiresAt = Date.now() + TTL_MS;
  await db.insert(importPreviews).values({ token, entity, userId: ctx.actorId, fileName: file.originalname, rows, expiresAt: new Date(expiresAt) }).run();

  const invalid = rows.filter((r) => r.errors.length > 0).length;
  return {
    token,
    entity,
    fileName: file.originalname,
    expiresAt: new Date(expiresAt).toISOString(),
    columns: [...columns.values()],
    rows,
    summary: { total: rows.length, valid: rows.length - invalid, invalid, duplicates: rows.filter((r) => r.duplicates.length > 0).length },
  };
}

export async function commitImport(ctx: RequestContext, entity: ImportEntity, raw: unknown): Promise<ImportResult> {
  const input = importCommitSchema.parse(raw);
  await prune();
  // Claim and delete in one statement: one commit per preview, so a double
  // click (or two instances) cannot import twice.
  const preview = await db
    .delete(importPreviews)
    .where(and(eq(importPreviews.token, input.token), eq(importPreviews.userId, ctx.actorId), eq(importPreviews.entity, entity), gt(importPreviews.expiresAt, new Date())))
    .returning()
    .get();
  if (!preview) {
    throw ApiError.conflict('This preview has expired or belongs to someone else. Upload the file again.', 'PREVIEW_EXPIRED');
  }

  const wanted = new Set(input.rows);
  const result: ImportResult = { created: 0, skipped: 0, codes: [], failures: [] };
  for (const row of preview.rows) {
    if (!wanted.has(row.row)) continue;
    if (row.errors.length > 0) {
      result.skipped += 1;
      result.failures.push({ row: row.row, message: row.errors.map((e) => `${e.field}: ${e.message}`).join('; ') });
      continue;
    }
    if (row.duplicates.length > 0 && !input.allowDuplicates) {
      result.skipped += 1;
      result.failures.push({ row: row.row, message: `Possible duplicate: ${row.duplicates.map((d) => d.label).join('; ')}` });
      continue;
    }
    try {
      if (entity === 'leads') {
        const { sourceName: _s, courseName: _c, counsellorName: _n, ...data } = row.data;
        result.codes.push((await createLead(ctx, data)).leadCode);
      } else {
        result.codes.push((await createStudent(ctx, { ...row.data, allowDuplicate: input.allowDuplicates })).studentCode);
      }
      result.created += 1;
    } catch (error) {
      result.skipped += 1;
      result.failures.push({ row: row.row, message: error instanceof Error ? error.message : 'Could not be saved' });
    }
  }
  await recordAudit(db, ctx, {
    action: 'import',
    entityType: entity === 'leads' ? 'lead' : 'student',
    summary: `Imported ${result.created} ${entity} from ${preview.fileName}${result.skipped ? ` (${result.skipped} skipped)` : ''}`,
    after: { fileName: preview.fileName, created: result.created, skipped: result.skipped, allowDuplicates: input.allowDuplicates },
  });
  return result;
}
