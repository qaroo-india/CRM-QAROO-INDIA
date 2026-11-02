/**
 * Background work: due report schedules and the notification sweep.
 *
 * Two ways to run it:
 *   - A long-running server (local, VM, container) uses in-process timers:
 *     report schedules every minute, the sweep every 15 minutes. Enabled by
 *     JOBS_ENABLED (off in tests, which call the functions directly).
 *   - On Vercel there is no process between requests, so Vercel Cron calls
 *     GET /api/v1/cron/tick, which runs `runJobsOnce()`.
 *
 * Several runners are safe: each due schedule is claimed atomically before
 * its email is sent, and notification dedupe keys stop duplicate reminders.
 */

import { env } from './config/env';
import { logger } from './config/logger';
import { runNotificationSweep } from './modules/notifications/notifications.service';
import { runDueSchedules } from './modules/reports/delivery.service';

const SCHEDULE_EVERY_MS = 60_000;
const SWEEP_EVERY_MS = 15 * 60_000;

async function schedules(): Promise<number | null> {
  try {
    const ran = await runDueSchedules();
    if (ran > 0) logger.info({ ran }, 'Ran scheduled reports');
    return ran;
  } catch (error) {
    logger.error({ err: error }, 'Scheduled report runner failed');
    return null;
  }
}

async function sweep(): Promise<number | null> {
  try {
    const { created } = await runNotificationSweep();
    if (created > 0) logger.info({ created }, 'Notification sweep created reminders');
    return created;
  } catch (error) {
    logger.error({ err: error }, 'Notification sweep failed');
    return null;
  }
}

export interface JobsRun {
  /** Reminders created by the sweep, or null if it failed (see the logs). */
  remindersCreated: number | null;
  /** Scheduled reports run, or null if the runner failed. */
  reportsRan: number | null;
}

/** One pass of every job. A failure in one does not stop the other. */
export async function runJobsOnce(): Promise<JobsRun> {
  const remindersCreated = await sweep();
  const reportsRan = await schedules();
  return { remindersCreated, reportsRan };
}

export function startBackgroundJobs(): () => void {
  if (!env.JOBS_ENABLED) {
    logger.info('Background jobs are disabled (JOBS_ENABLED=false)');
    return () => {};
  }

  const first = setTimeout(() => void runJobsOnce(), 10_000);
  const scheduleTimer = setInterval(() => void schedules(), SCHEDULE_EVERY_MS);
  const sweepTimer = setInterval(() => void sweep(), SWEEP_EVERY_MS);
  for (const t of [first, scheduleTimer, sweepTimer]) t.unref();
  logger.info('Background jobs started (report schedules every minute, reminders every 15 minutes)');

  return () => {
    clearTimeout(first);
    clearInterval(scheduleTimer);
    clearInterval(sweepTimer);
  };
}
