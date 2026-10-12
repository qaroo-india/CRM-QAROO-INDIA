/**
 * Reference-data seeding.
 *
 * Every seeder is idempotent: running `npm run db:seed` twice, or on a database
 * that already holds real data, inserts only what is missing and never
 * overwrites a value the owner has since edited.
 */

import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_LEAD_SOURCES,
  DEFAULT_NON_TECHNICAL_JOB_CATEGORIES,
  DEFAULT_TECHNICAL_JOB_CATEGORIES,
  ALL_PERMISSIONS,
} from '@ims/shared';
import { count, eq } from 'drizzle-orm';
import { env } from '../config/env';
import { hashPassword } from '../modules/auth/password';
import type { Db } from './index';
import {
  expenseCategories,
  INSTITUTE_SETTINGS_ID,
  instituteSettings,
  jobCategories,
  leadSources,
  users,
} from './schema';
import type { Tx } from './types';

export interface SeedResult {
  name: string;
  inserted: number;
}

export function seedInstituteSettings(database: Db | Tx): SeedResult {
  const result = database
    .insert(instituteSettings)
    .values({
      id: INSTITUTE_SETTINGS_ID,
      name: env.INSTITUTE_NAME,
      timezone: env.INSTITUTE_TIMEZONE,
      currency: env.INSTITUTE_CURRENCY,
      locale: env.INSTITUTE_LOCALE,
    })
    .onConflictDoNothing({ target: instituteSettings.id })
    .run();

  return { name: 'institute_settings', inserted: result.changes };
}

/** Insert names that are not present yet (case-insensitive), preserving order. */
function seedNames(
  database: Db | Tx,
  name: string,
  table: typeof leadSources | typeof expenseCategories,
  values: readonly string[],
): SeedResult {
  const existing = new Set(
    database
      .select({ name: table.name })
      .from(table)
      .all()
      .map((row) => row.name.toLowerCase()),
  );
  let inserted = 0;
  values.forEach((value, index) => {
    if (existing.has(value.toLowerCase())) return;
    database.insert(table).values({ name: value, sortOrder: index + 1 }).run();
    inserted += 1;
  });
  return { name, inserted };
}

function seedJobCategories(database: Db | Tx): SeedResult {
  const existing = new Set(
    database
      .select({ track: jobCategories.track, name: jobCategories.name })
      .from(jobCategories)
      .all()
      .map((row) => `${row.track}:${row.name.toLowerCase()}`),
  );
  let inserted = 0;
  const lists = [
    ['technical', DEFAULT_TECHNICAL_JOB_CATEGORIES],
    ['non_technical', DEFAULT_NON_TECHNICAL_JOB_CATEGORIES],
  ] as const;
  for (const [track, names] of lists) {
    names.forEach((name, index) => {
      if (existing.has(`${track}:${name.toLowerCase()}`)) return;
      database.insert(jobCategories).values({ track, name, sortOrder: index + 1 }).run();
      inserted += 1;
    });
  }
  return { name: 'job_categories', inserted };
}

/**
 * Create the first owner when the institute has none. The account must change
 * its password at first sign-in, so the configured initial password is only
 * ever a one-time key.
 */
function seedOwner(database: Db | Tx, passwordHash: string): SeedResult {
  const owners = database.select({ n: count() }).from(users).where(eq(users.role, 'owner')).get()?.n ?? 0;
  if (owners > 0) return { name: 'owner_account', inserted: 0 };

  const emailTaken = database.select({ id: users.id }).from(users).where(eq(users.email, env.OWNER_EMAIL)).get();
  if (emailTaken) return { name: 'owner_account', inserted: 0 };

  database
    .insert(users)
    .values({
      name: env.OWNER_NAME,
      email: env.OWNER_EMAIL,
      passwordHash,
      role: 'owner',
      permissions: [ALL_PERMISSIONS],
      mustChangePassword: true,
    })
    .run();
  return { name: 'owner_account', inserted: 1 };
}

/** Run all seeders inside one transaction, so a failure leaves nothing half-seeded. */
export async function seedDatabase(database: Db): Promise<SeedResult[]> {
  // Hash before opening the transaction: better-sqlite3 transactions are
  // synchronous and must not wait on async work.
  const ownerHash = await hashPassword(env.OWNER_INITIAL_PASSWORD);

  return database.transaction((tx) => [
    seedInstituteSettings(tx),
    seedOwner(tx, ownerHash),
    seedNames(tx, 'lead_sources', leadSources, DEFAULT_LEAD_SOURCES),
    seedNames(tx, 'expense_categories', expenseCategories, DEFAULT_EXPENSE_CATEGORIES),
    seedJobCategories(tx),
  ]);
}
