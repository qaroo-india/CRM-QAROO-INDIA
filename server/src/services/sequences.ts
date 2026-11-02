/**
 * Human-facing codes: STU-2026-00042, RCT-2026-00117, ADM-2026-00009.
 *
 * The counter is incremented with an atomic upsert inside the caller's
 * transaction. Transactions hold the write lock from their first statement
 * (BEGIN IMMEDIATE), so two requests cannot interleave between "read counter"
 * and "use number", and a rolled-back insert rolls back its number too --
 * receipts never skip.
 */

import { formatCode } from '@ims/shared';
import { sql } from 'drizzle-orm';
import { sequences } from '../db/schema';
import type { DbLike } from '../db/types';

export async function nextSequence(database: DbLike, name: string, year: number): Promise<number> {
  const row = await database
    .insert(sequences)
    .values({ name, year, value: 1 })
    .onConflictDoUpdate({
      target: [sequences.name, sequences.year],
      set: { value: sql`${sequences.value} + 1` },
    })
    .returning({ value: sequences.value })
    .get();
  return row.value;
}

/** Allocate the next code for a prefix in the year of a business date. */
export async function nextCode(database: DbLike, prefix: string, businessDate: string): Promise<string> {
  const year = Number(businessDate.slice(0, 4));
  return formatCode(prefix, year, await nextSequence(database, prefix.toUpperCase(), year));
}
