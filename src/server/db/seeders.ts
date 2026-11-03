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

export async function seedInstituteSettings(database: Db | Tx): Promise<SeedResult> {
  const result = await database
    .insert(instituteSettings)
    .values({
      id: INSTITUTE_SETTINGS_ID,
      name: env.INSTITUTE_NAME,
      legalName: 'Qaroo India Private Limited',
      logoUrl: '/logo.png',
      timezone: env.INSTITUTE_TIMEZONE,
      currency: env.INSTITUTE_CURRENCY,
      locale: env.INSTITUTE_LOCALE,
    })
    .onConflictDoNothing({ target: instituteSettings.id })
    .run();

  return { name: 'institute_settings', inserted: result.rowsAffected };
}

/** Insert names that are not present yet (case-insensitive), preserving order. */
async function seedNames(
  database: Db | Tx,
  name: string,
  table: typeof leadSources | typeof expenseCategories,
  values: readonly string[],
): Promise<SeedResult> {
  const existing = new Set(
    (await database
      .select({ name: table.name })
      .from(table)
      .all())
      .map((row) => row.name.toLowerCase()),
  );
  let inserted = 0;
  for (const [index, value] of values.entries()) {
    if (existing.has(value.toLowerCase())) continue;
    await database.insert(table).values({ name: value, sortOrder: index + 1 }).run();
    inserted += 1;
  }
  return { name, inserted };
}

async function seedJobCategories(database: Db | Tx): Promise<SeedResult> {
  const existing = new Set(
    (await database
      .select({ track: jobCategories.track, name: jobCategories.name })
      .from(jobCategories)
      .all())
      .map((row) => `${row.track}:${row.name.toLowerCase()}`),
  );
  let inserted = 0;
  const lists = [
    ['technical', DEFAULT_TECHNICAL_JOB_CATEGORIES],
    ['non_technical', DEFAULT_NON_TECHNICAL_JOB_CATEGORIES],
  ] as const;
  for (const [track, names] of lists) {
    for (const [index, name] of names.entries()) {
      if (existing.has(`${track}:${name.toLowerCase()}`)) continue;
      await database.insert(jobCategories).values({ track, name, sortOrder: index + 1 }).run();
      inserted += 1;
    }
  }
  return { name: 'job_categories', inserted };
}

/**
 * Create the first owner when the institute has none. The account must change
 * its password at first sign-in, so the configured initial password is only
 * ever a one-time key.
 */
async function seedOwner(database: Db | Tx, passwordHash: string): Promise<SeedResult> {
  const owners = (await database.select({ n: count() }).from(users).where(eq(users.role, 'owner')).get())?.n ?? 0;
  if (owners > 0) return { name: 'owner_account', inserted: 0 };

  const emailTaken = await database.select({ id: users.id }).from(users).where(eq(users.email, env.OWNER_EMAIL)).get();
  if (emailTaken) return { name: 'owner_account', inserted: 0 };

  await database
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
  // Hash before opening the transaction: it holds the database's write lock,
  // so nothing slow should run inside it.
  const ownerHash = await hashPassword(env.OWNER_INITIAL_PASSWORD);

  return await database.transaction(async (tx) => [
    await seedInstituteSettings(tx),
    await seedOwner(tx, ownerHash),
    await seedNames(tx, 'lead_sources', leadSources, DEFAULT_LEAD_SOURCES),
    await seedNames(tx, 'expense_categories', expenseCategories, DEFAULT_EXPENSE_CATEGORIES),
    await seedJobCategories(tx),
  ]);
}
