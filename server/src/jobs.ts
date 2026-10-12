/**
 * In-process background work: due report schedules every minute and the
 * notification sweep every 15 minutes. Enabled by JOBS_ENABLED (off in
 * tests, which call the functions directly).
 *
 * Run ONE API instance with jobs enabled. Two instances would both send a
 * scheduled email (the dedupe keys protect notifications, not emails).
 */

import { env } from './config/env';
import { logger } from './config/logger';
import { runNotificationSweep } from './modules/notifications/notifications.service';
import { runDueSchedules } from './modules/reports/delivery.service';

const SCHEDULE_EVERY_MS = 60_000;
const SWEEP_EVERY_MS = 15 * 60_000;

export function startBackgroundJobs(): () => void {
  if (!env.JOBS_ENABLED) {
    logger.info('Background jobs are disabled (JOBS_ENABLED=false)');
    return () => {};
  }

  const schedules = async () => {
    try {
      const ran = await runDueSchedules();
      if (ran > 0) logger.info({ ran }, 'Ran scheduled reports');
    } catch (error) {
      logger.error({ err: error }, 'Scheduled report runner failed');
    }
  };
  const sweep = () => {
    try {
      const { created } = runNotificationSweep();
      if (created > 0) logger.info({ created }, 'Notification sweep created reminders');
    } catch (error) {
      logger.error({ err: error }, 'Notification sweep failed');
    }
  };

  const first = setTimeout(() => {
    sweep();
    void schedules();
  }, 10_000);
  const scheduleTimer = setInterval(() => void schedules(), SCHEDULE_EVERY_MS);
  const sweepTimer = setInterval(sweep, SWEEP_EVERY_MS);
  for (const t of [first, scheduleTimer, sweepTimer]) t.unref();
  logger.info('Background jobs started (report schedules every minute, reminders every 15 minutes)');

  return () => {
    clearTimeout(first);
    clearInterval(scheduleTimer);
    clearInterval(sweepTimer);
  };
}
