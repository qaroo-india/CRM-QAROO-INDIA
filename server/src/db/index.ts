/**
 * Database connection.
 *
 * Together with ./dialect.ts, this is the only dialect-specific code in the
 * server. Turso/libSQL would swap the driver import here; Postgres would swap
 * it here and in the dialect module.
 *
 * better-sqlite3 is SYNCHRONOUS by design. That is a feature for a ledger:
 * a `db.transaction()` callback cannot be interleaved with another request's
 * writes, so there is no window between "read the balance" and "write the
 * payment" for a concurrent request to slip into. The flip side, which every
 * service must respect: transaction callbacks must not be `async`.
 */

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { env } from '../config/env';
import * as schema from './schema';

/** Generated SQL migrations, committed to Git and applied in order. */
export const MIGRATIONS_FOLDER = resolve(process.cwd(), 'drizzle');

export type Db = BetterSQLite3Database<typeof schema>;

export interface DatabaseHandle {
  sqlite: Database.Database;
  db: Db;
  /** Absolute file path, or ":memory:". Safe to log -- contains no credentials. */
  location: string;
}

export function openDatabase(url: string): DatabaseHandle {
  const isMemory = url === ':memory:';
  const location = isMemory ? ':memory:' : resolve(process.cwd(), url);

  if (!isMemory) {
    mkdirSync(dirname(location), { recursive: true });
  }

  const sqlite = new Database(location);

  // Write-ahead logging: readers never block the single writer and vice versa,
  // so a dashboard query does not stall a payment being recorded.
  sqlite.pragma('journal_mode = WAL');
  // Durable under WAL (a power cut can lose only the last un-checkpointed
  // commit, never corrupt the file) and far faster than FULL.
  sqlite.pragma('synchronous = NORMAL');
  // SQLite ships with foreign keys DISABLED for backwards compatibility.
  // Without this line every .references() in the schema is decorative.
  sqlite.pragma('foreign_keys = ON');
  // Wait up to 5s for a lock instead of failing instantly with SQLITE_BUSY.
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('temp_store = MEMORY');

  const db = drizzle({ client: sqlite, schema });
  return { sqlite, db, location };
}

const handle = openDatabase(env.DATABASE_URL);

export const sqlite = handle.sqlite;
export const db = handle.db;
export const databaseLocation = handle.location;

export function closeDatabase(): void {
  if (sqlite.open) sqlite.close();
}
