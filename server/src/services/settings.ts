/**
 * Institute settings, cached in memory.
 *
 * Nearly every request needs the time zone, currency or code prefixes, and the
 * row changes only when an owner edits Settings. One process owns the SQLite
 * file, so a simple in-process cache invalidated on update is always correct.
 */

import { eq } from 'drizzle-orm';
import { db } from '../db';
import { INSTITUTE_SETTINGS_ID, instituteSettings, type InstituteSettings } from '../db/schema';
import type { DbLike } from '../db/types';
import { ApiError } from '../utils/ApiError';

let cached: InstituteSettings | null = null;

export function getSettings(database: DbLike = db): InstituteSettings {
  if (cached) return cached;
  const row = database
    .select()
    .from(instituteSettings)
    .where(eq(instituteSettings.id, INSTITUTE_SETTINGS_ID))
    .get();
  if (!row) {
    throw new ApiError(503, 'NOT_SEEDED', 'Institute settings are missing. Run "npm run db:seed".');
  }
  cached = row;
  return row;
}

export function invalidateSettings(): void {
  cached = null;
}
