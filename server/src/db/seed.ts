/**
 * CLI: insert missing reference data.   npm run db:seed
 *
 * Safe to run repeatedly -- see seeders.ts.
 */

import { env, usingDevOwnerPassword } from '../config/env';
import { logger } from '../config/logger';
import { closeDatabase, databaseLocation, db, sqlite } from './index';
import { getMigrationStatus } from './migrator';
import { seedDatabase } from './seeders';

async function main(): Promise<void> {
  const status = getMigrationStatus(sqlite);
  if (status.applied === 0 || status.pending.length > 0) {
    throw new Error(
      `Database schema is not up to date (${status.pending.length} pending). ` + 'Run "npm run db:migrate" first.',
    );
  }

  const results = await seedDatabase(db);
  for (const result of results) {
    logger.info(
      { table: result.name, inserted: result.inserted },
      result.inserted > 0 ? `Seeded ${result.name}` : `${result.name} already present, left unchanged`,
    );
  }

  const owner = results.find((r) => r.name === 'owner_account');
  if (owner?.inserted) {
    logger.info(
      { email: env.OWNER_EMAIL },
      'Owner account created. Sign in with OWNER_EMAIL and OWNER_INITIAL_PASSWORD; you will be asked to choose a new password.',
    );
    if (usingDevOwnerPassword) {
      logger.warn(
        'The owner was created with the published DEVELOPMENT password. Never use this database in production.',
      );
    }
  }
  logger.info({ database: databaseLocation }, 'Seeding complete');
}

main()
  .catch((error) => {
    logger.error({ err: error }, 'Seeding failed');
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
