/**
 * Institute settings and the owner-curated lookup lists.
 *
 *   GET   /settings                       any signed-in user
 *   PATCH /settings                       settings:write
 *   GET   /settings/{lookup}              any signed-in user (?includeInactive=true)
 *   POST  /settings/{lookup}              settings:write
 *   PATCH /settings/{lookup}/:id          settings:write
 *   POST  /settings/{lookup}/reorder      settings:write
 *
 * {lookup} is lead-sources, expense-categories or job-categories. Items are
 * deactivated rather than deleted, because past records still reference them.
 */

import {
  PROFILE_TRACKS,
  lookupCreateSchema,
  lookupUpdateSchema,
  reorderSchema,
  updateSettingsSchema,
  type LookupItem,
} from '@ims/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db';
import { expenseCategories, INSTITUTE_SETTINGS_ID, instituteSettings, jobCategories, leadSources } from '../../db/schema';
import { requirePermission } from '../../middleware/auth';
import { diff, recordAudit } from '../../services/audit';
import { getSettings, invalidateSettings } from '../../services/settings';
import { ApiError } from '../../utils/ApiError';
import { contextFrom } from '../../utils/context';
import { created, ok } from '../../utils/respond';
import { paramId, parseBody } from '../../utils/validate';
import { toInstituteInfo } from '../users/serialize';

export const settingsRouter = Router();

settingsRouter.get('/', (_req, res) => {
  ok(res, toInstituteInfo(getSettings()));
});

settingsRouter.patch('/', requirePermission('settings:write'), (req, res) => {
  const input = parseBody(updateSettingsSchema, req);
  const ctx = contextFrom(req);
  const before = getSettings();

  const updated = db.transaction((tx) => {
    const row = tx
      .update(instituteSettings)
      .set({ ...input, updatedById: ctx.actorId })
      .where(eq(instituteSettings.id, INSTITUTE_SETTINGS_ID))
      .returning()
      .get();
    recordAudit(tx, ctx, {
      action: 'update',
      entityType: 'settings',
      entityId: INSTITUTE_SETTINGS_ID,
      summary: 'Updated institute settings',
      ...diff(before as unknown as Record<string, unknown>, row as unknown as Record<string, unknown>),
    });
    return row;
  });

  invalidateSettings();
  ok(res, toInstituteInfo(updated));
});

/* ------------------------------------------------------------------ *
 * Lookup lists
 * ------------------------------------------------------------------ */

type LookupTable = typeof leadSources | typeof expenseCategories | typeof jobCategories;

interface LookupConfig {
  path: string;
  label: string;
  table: LookupTable;
  /** Extra fields required on create (job categories need a track). */
  createExtras?: z.ZodObject;
}

const LOOKUPS: LookupConfig[] = [
  { path: 'lead-sources', label: 'lead source', table: leadSources },
  { path: 'expense-categories', label: 'expense category', table: expenseCategories },
  {
    path: 'job-categories',
    label: 'job category',
    table: jobCategories,
    createExtras: z.object({ track: z.enum(PROFILE_TRACKS) }),
  },
];

const includeInactiveQuery = z.object({ includeInactive: z.enum(['true', 'false']).optional() });

for (const lookup of LOOKUPS) {
  const t = lookup.table;
  const base = `/${lookup.path}`;

  settingsRouter.get(base, (req, res) => {
    const { includeInactive } = includeInactiveQuery.parse(req.query);
    const rows = db
      .select()
      .from(t)
      .where(includeInactive === 'true' ? undefined : eq(t.isActive, true))
      .orderBy(asc(t.sortOrder), asc(t.name))
      .all();
    ok(res, rows as LookupItem[]);
  });

  settingsRouter.post(base, requirePermission('settings:write'), (req, res) => {
    const schema = lookup.createExtras ? lookupCreateSchema.extend(lookup.createExtras.shape) : lookupCreateSchema;
    const input = schema.parse(req.body ?? {}) as z.infer<typeof lookupCreateSchema> & { track?: string };
    const ctx = contextFrom(req);

    const duplicate = db
      .select({ id: t.id })
      .from(t)
      .where(sql`lower(${t.name}) = lower(${input.name})`)
      .get();
    if (duplicate) throw ApiError.conflict(`A ${lookup.label} named "${input.name}" already exists.`);

    const row = db.transaction((tx) => {
      const maxOrder = tx.select({ max: sql<number>`coalesce(max(${t.sortOrder}), 0)` }).from(t).get()?.max ?? 0;
      const inserted = tx
        .insert(t)
        .values({ ...input, sortOrder: maxOrder + 1 } as never)
        .returning()
        .get();
      recordAudit(tx, ctx, {
        action: 'create',
        entityType: lookup.path,
        entityId: inserted.id,
        summary: `Added ${lookup.label} "${inserted.name}"`,
        after: inserted,
      });
      return inserted;
    });
    created(res, row);
  });

  settingsRouter.patch(`${base}/:id`, requirePermission('settings:write'), (req, res) => {
    const id = paramId(req);
    const input = parseBody(lookupUpdateSchema, req);
    const ctx = contextFrom(req);
    const existing = db.select().from(t).where(eq(t.id, id)).get();
    if (!existing) throw ApiError.notFound(lookup.label);

    if (input.name) {
      const clash = db
        .select({ id: t.id })
        .from(t)
        .where(and(sql`lower(${t.name}) = lower(${input.name})`, sql`${t.id} <> ${id}`))
        .get();
      if (clash) throw ApiError.conflict(`A ${lookup.label} named "${input.name}" already exists.`);
    }

    const row = db.transaction((tx) => {
      const updated = tx.update(t).set(input).where(eq(t.id, id)).returning().get();
      recordAudit(tx, ctx, {
        action: 'update',
        entityType: lookup.path,
        entityId: id,
        summary: `Updated ${lookup.label} "${updated.name}"`,
        ...diff(existing as Record<string, unknown>, updated as Record<string, unknown>),
      });
      return updated;
    });
    ok(res, row);
  });

  settingsRouter.post(`${base}/reorder`, requirePermission('settings:write'), (req, res) => {
    const { ids } = parseBody(reorderSchema, req);
    db.transaction((tx) => {
      ids.forEach((id, index) => {
        tx.update(t).set({ sortOrder: index + 1 }).where(eq(t.id, id)).run();
      });
    });
    ok(res, { reordered: ids.length });
  });
}
