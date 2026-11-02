/**
 * CLI: add the campus and portal DEMO data to a database that already holds
 * the main demo (loaded before these areas existed).   npm run db:demo:campus
 *
 * Refuses in production, when migrations are pending, when the database is
 * not a demo database, or when any schedule, exam, material, certificate,
 * drive, leave, task or inventory record already exists -- so it never mixes
 * invented records into real ones. A fresh `npm run db:demo` already includes
 * this step.
 */

import { and, count, eq, like } from 'drizzle-orm';
import { isProduction } from '../config/env';
import { logger } from '../config/logger';
import { runNotificationSweep } from '../modules/notifications/notifications.service';
import { loadSettings } from '../services/settings';
import type { RequestContext } from '../utils/context';
import { campusAreasEmpty, loadCampusDemo } from './campusDemo';
import { client, closeDatabase, databaseLocation, db } from './index';
import { getMigrationStatus } from './migrator';
import { batches, users } from './schema';

async function main(): Promise<void> {
  if (isProduction) throw new Error('Refusing to load demo data in production.');
  const status = await getMigrationStatus(client);
  if (status.applied === 0 || status.pending.length > 0) throw new Error('Run "npm run db:migrate" first.');
  await loadSettings();
  const demoBatches = (await db.select({ n: count() }).from(batches).where(like(batches.notes, '%[DEMO DATA]%')).get())?.n ?? 0;
  if (demoBatches === 0) throw new Error('This is not a demo database (no [DEMO DATA] batches). Use "npm run db:demo" on an empty database instead.');
  if (!(await campusAreasEmpty())) throw new Error('The campus areas already have records, so demo data is not added.');
  const owner = await db.select().from(users).where(and(eq(users.role, 'owner'), eq(users.isActive, true))).get();
  if (!owner) throw new Error('No owner account. Run "npm run db:seed" first.');

  const ctx: RequestContext = { actorId: owner.id, actorName: owner.name, permissions: ['*'], isOwner: true, accountType: 'team' };
  const { counts, logins, failures } = await loadCampusDemo(ctx);
  const { created } = await runNotificationSweep();
  logger.info({ ...counts, notifications: created, database: databaseLocation }, 'Campus demo data loaded');
  if (failures.length) logger.warn({ skipped: failures.length, examples: failures.slice(0, 8) }, 'Some demo steps were skipped by business rules');
  if (logins.password) {
    // Printed once, development only. Both must choose their own password at first sign-in.
    console.log(`\nDEMO portal logins (development only)\n  Student: ${logins.student ?? '-'}\n  Faculty: ${logins.faculty ?? '-'}\n  Temporary password: ${logins.password}\n`);
  }
}

await main()
  .catch((error) => {
    logger.error({ err: error }, 'Loading campus demo data failed');
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
