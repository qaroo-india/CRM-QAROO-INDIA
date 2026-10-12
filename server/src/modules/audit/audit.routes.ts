/**
 * GET /audit -- the change history (audit:read).
 * Filters: entityType, entityId, actorId, action, from, to (calendar days in
 * the institute zone), q (summary text). Newest first, paginated.
 */

import { addDays, dateOnlySchema, paginationSchema, zonedDayStart, type AuditLogEntry } from '@ims/shared';
import { and, count, desc, eq, gte, lt, type SQL } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db';
import { auditLogs, users } from '../../db/schema';
import { requirePermission } from '../../middleware/auth';
import { getSettings } from '../../services/settings';
import { containsText, pageWindow, paginated } from '../../utils/pagination';
import { ok } from '../../utils/respond';
import { parseQuery } from '../../utils/validate';

export const auditRouter = Router();

const auditQuery = paginationSchema.extend({
  entityType: z.string().trim().max(60).optional(),
  entityId: z.string().trim().max(60).optional(),
  actorId: z.string().trim().max(60).optional(),
  action: z.string().trim().max(40).optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  q: z.string().trim().max(100).optional(),
});

auditRouter.get('/', requirePermission('audit:read'), (req, res) => {
  const query = parseQuery(auditQuery, req);
  const { timezone } = getSettings();
  const conditions: SQL[] = [];

  if (query.entityType) conditions.push(eq(auditLogs.entityType, query.entityType));
  if (query.entityId) conditions.push(eq(auditLogs.entityId, query.entityId));
  if (query.actorId) conditions.push(eq(auditLogs.actorId, query.actorId));
  if (query.action) conditions.push(eq(auditLogs.action, query.action));
  if (query.q) conditions.push(containsText(auditLogs.summary, query.q));
  if (query.from) conditions.push(gte(auditLogs.occurredAt, zonedDayStart(query.from, timezone)));
  if (query.to) {
    conditions.push(lt(auditLogs.occurredAt, zonedDayStart(addDays(query.to, 1), timezone)));
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const total = db.select({ n: count() }).from(auditLogs).where(where).get()?.n ?? 0;
  const { limit, offset } = pageWindow(query.page, query.limit);

  const rows = db
    .select({ log: auditLogs, actorName: users.name })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(where)
    .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
    .limit(limit)
    .offset(offset)
    .all();

  const items: AuditLogEntry[] = rows.map(({ log, actorName }) => ({
    id: log.id,
    actorId: log.actorId,
    actorName,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    summary: log.summary,
    before: log.before,
    after: log.after,
    requestId: log.requestId,
    occurredAt: log.occurredAt.toISOString(),
  }));

  ok(res, paginated(items, total, query.page, query.limit));
});
