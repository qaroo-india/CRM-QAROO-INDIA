/**
 * Faculty scope. A faculty login may act only on the batches they teach,
 * whatever permissions they hold; team accounts are not restricted here.
 * Every campus service that touches batch data runs through these helpers.
 */

import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { batches } from '../db/schema';
import type { AnyColumn } from '../db/dialect';
import { ApiError } from './ApiError';
import type { RequestContext } from './context';

/** null = unrestricted (team); otherwise the batches this faculty member teaches. */
export async function facultyBatchIds(ctx: RequestContext): Promise<string[] | null> {
  if (ctx.accountType !== 'faculty') return null;
  if (!ctx.trainerId) return [];
  return (await db.select({ id: batches.id }).from(batches).where(eq(batches.trainerId, ctx.trainerId)).all()).map((b) => b.id);
}

/** A WHERE fragment limiting `column` (a batch id column) to the caller's scope, or undefined. */
export async function batchScope(ctx: RequestContext, column: AnyColumn): Promise<SQL | undefined> {
  const ids = await facultyBatchIds(ctx);
  if (ids === null) return undefined;
  return ids.length ? inArray(column, ids) : sql`0`;
}

/** Throw "not found" when a faculty member reaches for a batch that is not theirs. */
export async function assertBatchInScope(ctx: RequestContext, batchId: string | null | undefined, what = 'Batch'): Promise<void> {
  const ids = await facultyBatchIds(ctx);
  if (ids === null) return;
  if (!batchId || !ids.includes(batchId)) throw ApiError.notFound(what);
}
