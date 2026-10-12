/**
 * CLI: apply pending migrations.   npm run db:migrate
 *
 * Kept as its own entry file (rather than a main-module check inside
 * migrator.ts) so bundling can never cause the server to run it on boot.
 */

import { logger } from '../config/logger';
import { closeDatabase, databaseLocation, db, sqlite } from './index';
import { getMigrationStatus, runMigrations } from './migrator';

try {
  const before = getMigrationStatus(sqlite);
  logger.info(
    { database: databaseLocation, pending: before.pending },
    `Applying ${before.pending.length} pending migration(s)`,
  );

  runMigrations(db);

  const after = getMigrationStatus(sqlite);
  if (after.pending.length > 0) {
    throw new Error(`Migrations still pending after apply: ${after.pending.join(', ')}`);
  }
  logger.info({ applied: after.applied }, 'Database schema is up to date');
  closeDatabase();
} catch (error) {
  logger.error({ err: error }, 'Migration failed');
  closeDatabase();
  process.exitCode = 1;
}
