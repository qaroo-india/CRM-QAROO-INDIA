/**
 * GET /api/v1/cron/tick   run the background jobs once (Vercel Cron)
 *
 * On Vercel nothing runs between requests, so the reminder sweep and the due
 * report schedules are triggered by Vercel Cron (see vercel.json "crons").
 * Vercel sends "Authorization: Bearer <CRON_SECRET>"; any other caller is
 * refused, and without CRON_SECRET the endpoint refuses everyone.
 *
 * Answers 500 when a job failed, so the failure shows in Vercel's cron logs.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { env } from '../../config/env';
import { runJobsOnce } from '../../jobs';
import { ApiError } from '../../utils/ApiError';
import { ok } from '../../utils/respond';

export const cronRouter = Router();

/** Constant-time comparison, also for inputs of different lengths. */
function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

cronRouter.get('/tick', async (req, res) => {
  if (!env.CRON_SECRET) {
    throw new ApiError(503, 'CRON_NOT_CONFIGURED', 'Set CRON_SECRET to enable scheduled jobs');
  }
  if (!sameSecret(req.get('authorization') ?? '', `Bearer ${env.CRON_SECRET}`)) {
    throw ApiError.unauthorized();
  }
  const result = await runJobsOnce();
  res.setHeader('Cache-Control', 'no-store');
  const failed = result.remindersCreated === null || result.reportsRan === null;
  ok(res, result, undefined, failed ? 500 : 200);
});
