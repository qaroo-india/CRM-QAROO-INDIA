/**
 * Enquiries: capture, pipeline movement, follow-ups, assignment, timeline.
 *
 * Rules enforced here:
 *   - 'converted' is reached only by registering an admission (admissions
 *     service), never by dragging a card, and it is terminal.
 *   - Once converted, a lead's source is frozen: past admissions must never
 *     be silently re-attributed to a different campaign.
 *   - Every status, assignment and follow-up change writes a timeline entry.
 */

import {
  LEAD_STATUSES,
  normalisePhone,
  type LeadActivityDto,
  type LeadBoardColumn,
  type LeadDetail,
  type LeadDto,
  bulkAssignSchema,
  leadActivitySchema,
  leadListQuerySchema,
  leadSchema,
  leadStatusChangeSchema,
} from '@ims/shared';
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, notInArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';
import { db } from '../../db';
import { admissions, courses, leadActivities, leadSources, leads, users, type Lead } from '../../db/schema';
import type { DbLike } from '../../db/types';
import { diff, recordAudit } from '../../services/audit';
import { instituteToday } from '../../services/clock';
import { nextCode } from '../../services/sequences';
import { getSettings } from '../../services/settings';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { containsText, pageWindow, paginated } from '../../utils/pagination';

const counsellor = alias(users, 'counsellor');
const actor = alias(users, 'actor');

const CLOSED_STATUSES = ['converted', 'not_interested', 'lost', 'unreachable'] as const;

const leadSelect = {
  lead: leads,
  sourceName: leadSources.name,
  courseName: courses.name,
  counsellorName: counsellor.name,
};

type LeadRow = { lead: Lead; sourceName: string | null; courseName: string | null; counsellorName: string | null };

function toDto(row: LeadRow): LeadDto {
  const l = row.lead;
  return {
    id: l.id,
    leadCode: l.leadCode,
    name: l.name,
    phone: l.phone,
    email: l.email,
    enquiryDate: l.enquiryDate,
    leadSourceId: l.leadSourceId,
    sourceName: row.sourceName ?? '—',
    campaignName: l.campaignName,
    adReference: l.adReference,
    utmSource: l.utmSource,
    utmMedium: l.utmMedium,
    utmCampaign: l.utmCampaign,
    utmTerm: l.utmTerm,
    utmContent: l.utmContent,
    interestedCourseId: l.interestedCourseId,
    courseName: row.courseName,
    counsellorId: l.counsellorId,
    counsellorName: row.counsellorName,
    followUpDate: l.followUpDate,
    priority: l.priority,
    status: l.status,
    lostReason: l.lostReason,
    notes: l.notes,
    convertedOn: l.convertedOn,
    studentId: l.studentId,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

function baseQuery(database: DbLike = db) {
  return database
    .select(leadSelect)
    .from(leads)
    .leftJoin(leadSources, eq(leadSources.id, leads.leadSourceId))
    .leftJoin(courses, eq(courses.id, leads.interestedCourseId))
    .leftJoin(counsellor, eq(counsellor.id, leads.counsellorId));
}

export function getLeadRow(id: string, database: DbLike = db): Lead {
  const lead = database.select().from(leads).where(eq(leads.id, id)).get();
  if (!lead) throw ApiError.notFound('Lead');
  return lead;
}

function assertReferences(input: { leadSourceId?: string; interestedCourseId?: string; counsellorId?: string }): void {
  if (input.leadSourceId && !db.select({ id: leadSources.id }).from(leadSources).where(eq(leadSources.id, input.leadSourceId)).get()) {
    throw ApiError.validation([{ path: 'leadSourceId', message: 'Choose a valid lead source' }]);
  }
  if (input.interestedCourseId && !db.select({ id: courses.id }).from(courses).where(eq(courses.id, input.interestedCourseId)).get()) {
    throw ApiError.validation([{ path: 'interestedCourseId', message: 'Choose a valid course' }]);
  }
  if (input.counsellorId && !db.select({ id: users.id }).from(users).where(and(eq(users.id, input.counsellorId), eq(users.isActive, true))).get()) {
    throw ApiError.validation([{ path: 'counsellorId', message: 'Choose an active staff member' }]);
  }
}

function logActivity(
  database: DbLike,
  ctx: RequestContext,
  leadId: string,
  entry: { type: LeadActivityDto['type']; note?: string | null; fromStatus?: string; toStatus?: string; metadata?: Record<string, unknown> },
): void {
  database
    .insert(leadActivities)
    .values({
      leadId,
      type: entry.type as typeof leadActivities.$inferInsert.type,
      note: entry.note ?? null,
      fromStatus: entry.fromStatus ?? null,
      toStatus: entry.toStatus ?? null,
      metadata: entry.metadata ?? null,
      actorId: ctx.actorId || null,
    })
    .run();
}

/* ------------------------------------------------------------------ *
 * Queries
 * ------------------------------------------------------------------ */

type ListQuery = z.output<typeof leadListQuerySchema>;

function filters(query: ListQuery, includeStatus = true): SQL[] {
  const conditions: SQL[] = [];
  if (query.q) {
    const digits = query.q.replace(/\D/g, '');
    const text = [containsText(leads.name, query.q), containsText(leads.email, query.q), containsText(leads.leadCode, query.q)];
    if (digits.length >= 4) text.push(containsText(leads.phoneNormalized, digits));
    conditions.push(or(...text)!);
  }
  if (includeStatus && query.status?.length) conditions.push(inArray(leads.status, query.status));
  if (query.sourceId) conditions.push(eq(leads.leadSourceId, query.sourceId));
  if (query.courseId) conditions.push(eq(leads.interestedCourseId, query.courseId));
  if (query.counsellorId === 'unassigned') conditions.push(isNull(leads.counsellorId));
  else if (query.counsellorId) conditions.push(eq(leads.counsellorId, query.counsellorId));
  if (query.priority) conditions.push(eq(leads.priority, query.priority));
  if (query.from) conditions.push(sql`${leads.enquiryDate} >= ${query.from}`);
  if (query.to) conditions.push(sql`${leads.enquiryDate} <= ${query.to}`);
  if (query.followUpFrom) conditions.push(sql`${leads.followUpDate} >= ${query.followUpFrom}`);
  if (query.followUpTo) conditions.push(sql`${leads.followUpDate} <= ${query.followUpTo}`);
  if (query.followUp) {
    const today = instituteToday();
    const open = notInArray(leads.status, [...CLOSED_STATUSES]);
    if (query.followUp === 'overdue') conditions.push(and(lt(leads.followUpDate, today), open)!);
    if (query.followUp === 'today') conditions.push(and(eq(leads.followUpDate, today), open)!);
    if (query.followUp === 'upcoming') conditions.push(and(gt(leads.followUpDate, today), open)!);
    if (query.followUp === 'none') conditions.push(and(isNull(leads.followUpDate), open)!);
  }
  return conditions;
}

const SORTS: Record<string, SQLWrapper> = {
  enquiryDate: leads.enquiryDate,
  name: leads.name,
  followUpDate: leads.followUpDate,
  createdAt: leads.createdAt,
  updatedAt: leads.updatedAt,
  status: leads.status,
  priority: sql`case ${leads.priority} when 'high' then 3 when 'medium' then 2 else 1 end`,
};

export function listLeads(query: ListQuery) {
  const where = and(...filters(query));
  const total = db.select({ n: count() }).from(leads).where(where).get()?.n ?? 0;
  const sortColumn = SORTS[query.sort ?? 'enquiryDate'] ?? leads.enquiryDate;
  const { limit, offset } = pageWindow(query.page, query.limit);
  const rows = baseQuery()
    .where(where)
    .orderBy(query.order === 'asc' ? asc(sortColumn) : desc(sortColumn), desc(leads.id))
    .limit(limit)
    .offset(offset)
    .all();
  return paginated(rows.map(toDto), total, query.page, query.limit);
}

/** Every lead matching the list filters, for export. Capped so one request cannot stall the server. */
export function leadsForExport(query: ListQuery, cap = 10_000): { rows: LeadDto[]; total: number } {
  const where = and(...filters(query));
  const total = db.select({ n: count() }).from(leads).where(where).get()?.n ?? 0;
  const sortColumn = SORTS[query.sort ?? 'enquiryDate'] ?? leads.enquiryDate;
  const rows = baseQuery()
    .where(where)
    .orderBy(query.order === 'asc' ? asc(sortColumn) : desc(sortColumn), desc(leads.id))
    .limit(cap)
    .all();
  return { rows: rows.map(toDto), total };
}

/** Kanban: every status with its total and the most recently touched cards. */
export function leadBoard(query: ListQuery, perColumn = 50): LeadBoardColumn[] {
  const base = filters(query, false);
  return LEAD_STATUSES.map((status) => {
    const where = and(...base, eq(leads.status, status));
    const total = db.select({ n: count() }).from(leads).where(where).get()?.n ?? 0;
    const rows = baseQuery().where(where).orderBy(desc(leads.updatedAt)).limit(perColumn).all();
    return { status, total, leads: rows.map(toDto) };
  });
}

/** Leads by id (e.g. those linked to one student), newest enquiry first. */
export function leadsByIds(ids: string[]): LeadDto[] {
  if (ids.length === 0) return [];
  return baseQuery().where(inArray(leads.id, ids)).orderBy(desc(leads.enquiryDate)).all().map(toDto);
}

export function getLead(id: string): LeadDetail {
  const row = baseQuery().where(eq(leads.id, id)).get();
  if (!row) throw ApiError.notFound('Lead');
  const activities = db
    .select({ activity: leadActivities, actorName: actor.name })
    .from(leadActivities)
    .leftJoin(actor, eq(actor.id, leadActivities.actorId))
    .where(eq(leadActivities.leadId, id))
    .orderBy(desc(leadActivities.occurredAt), desc(leadActivities.id))
    .all();
  const admission = db.select({ id: admissions.id }).from(admissions).where(eq(admissions.leadId, id)).get();
  return {
    ...toDto(row),
    admissionId: admission?.id ?? null,
    activities: activities.map(({ activity, actorName }) => ({
      id: activity.id,
      type: activity.type,
      fromStatus: activity.fromStatus,
      toStatus: activity.toStatus,
      note: activity.note,
      actorName,
      occurredAt: activity.occurredAt.toISOString(),
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

type LeadInput = z.output<typeof leadSchema>;

function columnsFrom(input: LeadInput) {
  return {
    name: input.name,
    phone: input.phone,
    phoneNormalized: normalisePhone(input.phone),
    email: input.email ?? null,
    enquiryDate: input.enquiryDate,
    leadSourceId: input.leadSourceId,
    campaignName: input.campaignName ?? null,
    adReference: input.adReference ?? null,
    utmSource: input.utmSource ?? null,
    utmMedium: input.utmMedium ?? null,
    utmCampaign: input.utmCampaign ?? null,
    utmTerm: input.utmTerm ?? null,
    utmContent: input.utmContent ?? null,
    interestedCourseId: input.interestedCourseId ?? null,
    counsellorId: input.counsellorId ?? null,
    followUpDate: input.followUpDate ?? null,
    priority: input.priority,
    notes: input.notes ?? null,
  };
}

export function createLead(ctx: RequestContext, raw: unknown): LeadDetail {
  const input = leadSchema.parse(raw);
  assertReferences(input);
  const id = db.transaction((tx) => {
    const lead = tx
      .insert(leads)
      .values({ ...columnsFrom(input), leadCode: nextCode(tx, getSettings().leadCodePrefix, input.enquiryDate), createdById: ctx.actorId })
      .returning()
      .get();
    if (lead.counsellorId) logActivity(tx, ctx, lead.id, { type: 'assignment', metadata: { counsellorId: lead.counsellorId } });
    if (lead.followUpDate) logActivity(tx, ctx, lead.id, { type: 'follow_up_set', note: `Follow-up on ${lead.followUpDate}` });
    recordAudit(tx, ctx, { action: 'create', entityType: 'lead', entityId: lead.id, summary: `Recorded enquiry ${lead.leadCode} from ${lead.name}`, after: lead });
    return lead.id;
  });
  return getLead(id);
}

export function updateLead(ctx: RequestContext, id: string, raw: unknown): LeadDetail {
  const input = leadSchema.parse(raw);
  const existing = getLeadRow(id);
  if (existing.status === 'converted' && input.leadSourceId !== existing.leadSourceId) {
    throw ApiError.conflict('The source of a converted lead cannot change: its admission is attributed to it.');
  }
  assertReferences(input);

  db.transaction((tx) => {
    const updated = tx.update(leads).set(columnsFrom(input)).where(eq(leads.id, id)).returning().get();
    if (updated.counsellorId !== existing.counsellorId) {
      logActivity(tx, ctx, id, { type: 'assignment', metadata: { from: existing.counsellorId, to: updated.counsellorId } });
    }
    if (updated.followUpDate !== existing.followUpDate && updated.followUpDate) {
      logActivity(tx, ctx, id, { type: 'follow_up_set', note: `Follow-up on ${updated.followUpDate}` });
    }
    recordAudit(tx, ctx, {
      action: 'update',
      entityType: 'lead',
      entityId: id,
      summary: `Updated enquiry ${existing.leadCode}`,
      ...diff(existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>),
    });
  });
  return getLead(id);
}

export function changeLeadStatus(ctx: RequestContext, id: string, raw: unknown): LeadDetail {
  const input = leadStatusChangeSchema.parse(raw);
  const existing = getLeadRow(id);
  if (existing.status === 'converted') {
    throw ApiError.conflict('This lead has been converted to an admission; its status is final.');
  }
  if (existing.status === input.status && !input.followUpDate) return getLead(id);

  db.transaction((tx) => {
    tx.update(leads)
      .set({
        status: input.status as Lead['status'],
        lostReason: ['lost', 'not_interested'].includes(input.status) ? (input.lostReason ?? null) : null,
        ...(input.followUpDate !== undefined && { followUpDate: input.followUpDate }),
      })
      .where(eq(leads.id, id))
      .run();
    if (existing.status !== input.status) {
      logActivity(tx, ctx, id, { type: 'status_change', fromStatus: existing.status, toStatus: input.status, note: input.note ?? input.lostReason ?? null });
    }
    if (input.followUpDate) logActivity(tx, ctx, id, { type: 'follow_up_set', note: `Follow-up on ${input.followUpDate}` });
    recordAudit(tx, ctx, {
      action: 'status_change',
      entityType: 'lead',
      entityId: id,
      summary: `Moved ${existing.leadCode} from ${existing.status} to ${input.status}`,
      before: { status: existing.status },
      after: { status: input.status, lostReason: input.lostReason ?? null },
    });
  });
  return getLead(id);
}

export function addLeadActivity(ctx: RequestContext, id: string, raw: unknown): LeadDetail {
  const input = leadActivitySchema.parse(raw);
  const existing = getLeadRow(id);

  db.transaction((tx) => {
    logActivity(tx, ctx, id, { type: input.type, note: input.note });
    // Logging real contact moves a brand-new lead forward automatically.
    if (existing.status === 'new' && input.type !== 'note') {
      tx.update(leads).set({ status: 'contacted' }).where(eq(leads.id, id)).run();
      logActivity(tx, ctx, id, { type: 'status_change', fromStatus: 'new', toStatus: 'contacted' });
    }
    if (input.followUpDate) {
      tx.update(leads).set({ followUpDate: input.followUpDate }).where(eq(leads.id, id)).run();
      logActivity(tx, ctx, id, { type: 'follow_up_set', note: `Follow-up on ${input.followUpDate}` });
    } else {
      // Touching the lead counts as activity for "recently updated" ordering.
      tx.update(leads).set({ updatedAt: new Date() }).where(eq(leads.id, id)).run();
    }
  });
  return getLead(id);
}

export function assignLeads(ctx: RequestContext, raw: unknown): { updated: number } {
  const input = bulkAssignSchema.parse(raw);
  assertReferences({ counsellorId: input.counsellorId });
  const targets = db.select().from(leads).where(inArray(leads.id, input.leadIds)).all();
  if (targets.length !== input.leadIds.length) throw ApiError.notFound('One or more leads');

  db.transaction((tx) => {
    for (const lead of targets) {
      if (lead.counsellorId === input.counsellorId) continue;
      tx.update(leads).set({ counsellorId: input.counsellorId }).where(eq(leads.id, lead.id)).run();
      logActivity(tx, ctx, lead.id, { type: 'assignment', metadata: { from: lead.counsellorId, to: input.counsellorId } });
    }
    recordAudit(tx, ctx, {
      action: 'update',
      entityType: 'lead',
      summary: `Assigned ${targets.length} lead(s) to a counsellor`,
      after: { leadIds: input.leadIds, counsellorId: input.counsellorId },
    });
  });
  return { updated: targets.length };
}

/** Called by the admissions service inside its transaction. */
export function markLeadConverted(tx: DbLike, ctx: RequestContext, lead: Lead, studentId: string, admissionDate: string, admissionNumber: string): void {
  tx.update(leads)
    .set({ status: 'converted', convertedOn: admissionDate, studentId, lostReason: null })
    .where(eq(leads.id, lead.id))
    .run();
  logActivity(tx, ctx, lead.id, {
    type: 'conversion',
    fromStatus: lead.status,
    toStatus: 'converted',
    note: `Admission ${admissionNumber} registered`,
  });
}
