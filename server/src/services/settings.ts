/**
 * Institute settings, cached in memory.
 *
 * Nearly every request needs the time zone, currency or code prefixes, and the
 * row changes only when an owner edits Settings, so reads stay synchronous and
 * come from this cache. `loadSettings()` fills it: at start-up, in the
 * request middleware below, in tests and in scripts. Several server instances
 * (serverless) each keep their own copy, so the middleware re-reads the row
 * once a minute and an owner's change reaches every instance within that.
 */

import { eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import { db } from '../db';
import { INSTITUTE_SETTINGS_ID, instituteSettings, type InstituteSettings } from '../db/schema';
import type { DbLike } from '../db/types';
import { ApiError } from '../utils/ApiError';

const REFRESH_AFTER_MS = 60_000;

let cached: InstituteSettings | null = null;
let loadedAt = 0;
let loading: Promise<InstituteSettings> | null = null;

/** Read the settings row into the cache. */
export async function loadSettings(database: DbLike = db): Promise<InstituteSettings> {
  const row = await database.select().from(instituteSettings).where(eq(instituteSettings.id, INSTITUTE_SETTINGS_ID)).get();
  if (!row) {
    throw new ApiError(503, 'NOT_SEEDED', 'Institute settings are missing. Run "npm run db:seed".');
  }
  cached = row;
  loadedAt = Date.now();
  return row;
}

/** The cached settings. Loaded before any request handler runs. */
export function getSettings(): InstituteSettings {
  if (!cached) {
    throw new ApiError(503, 'NOT_SEEDED', 'Institute settings are missing. Run "npm run db:seed".');
  }
  return cached;
}

/**
 * Express middleware: make sure the cache is loaded and fresh before routes
 * run. Concurrent requests share one reload. A failed reload is not fatal
 * here: the previous copy stays in use, the health check reports a missing
 * row or schema, and routes that need settings answer 503 until it exists.
 */
export const ensureSettings: RequestHandler = async (req, _res, next) => {
  if (!cached || Date.now() - loadedAt > REFRESH_AFTER_MS) {
    loading ??= loadSettings().finally(() => {
      loading = null;
    });
    try {
      await loading;
    } catch (error) {
      if (!(error instanceof ApiError)) req.log?.warn({ err: error }, 'Could not load institute settings');
    }
  }
  next();
};
