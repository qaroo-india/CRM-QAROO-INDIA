/**
 * Database connection: libSQL (the SQLite engine Turso runs).
 *
 *   - Locally the database is a file (`./data/institute.db`), the same SQLite
 *     file format as before.
 *   - In production it is Turso, a hosted libSQL database reached over the
 *     network (`libsql://...` plus an auth token), because serverless hosts
 *     such as Vercel have no disk that survives between requests.
 *
 * Every query is asynchronous. Work that must not interleave with other writes
 * runs in `db.transaction(async (tx) => ...)`: libSQL opens it as a WRITE
 * transaction (BEGIN IMMEDIATE), so no other writer can commit until it ends
 * and there is still no window between "read the balance" and "write the
 * payment". Inside a transaction, read and write through `tx` only: the plain
 * `db` uses another connection and would not see the transaction's own writes.
 *
 * libSQL enforces foreign keys on every connection by default.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Client } from '@libsql/client';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
// Wraps a client we create; this entry never loads libSQL's native engine.
import { drizzle } from 'drizzle-orm/libsql/web';
import { env } from '../config/env';
import { serverPath } from '../config/paths';
import * as schema from './schema';

/** Generated SQL migrations, committed to Git and applied in order. */
export const MIGRATIONS_FOLDER = serverPath('drizzle');

export type Db = LibSQLDatabase<typeof schema>;

export interface DatabaseHandle {
  client: Client;
  db: Db;
  /** File path or remote host. Safe to log -- contains no credentials. */
  location: string;
  remote: boolean;
}

const REMOTE_URL = /^(libsql|https?|wss?):\/\//i;

/** Wait up to 5 s for another writer instead of failing with SQLITE_BUSY. */
const BUSY_TIMEOUT_MS = 5000;

/**
 * The client is imported on demand: the default build loads libSQL's native
 * engine as soon as it is imported, which a hosted database never needs (and
 * a serverless bundle may not ship). Remote databases use the HTTP client.
 */
export async function openDatabase(url: string, authToken?: string): Promise<DatabaseHandle> {
  if (REMOTE_URL.test(url)) {
    const { createClient } = await import('@libsql/client/web');
    const client = createClient({ url, authToken });
    return { client, db: drizzle({ client, schema }), location: new URL(url).host, remote: true };
  }

  // ":memory:" (the automated tests): a private temporary file instead, so
  // transactions get their own connection exactly as in production.
  const isMemory = url === ':memory:';
  const path = isMemory ? join(tmpdir(), `ims-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`) : resolve(process.cwd(), url);
  mkdirSync(dirname(path), { recursive: true });
  if (isMemory) {
    process.once('exit', () => {
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          rmSync(path + suffix, { force: true });
        } catch {
          // Windows may still hold the file; the OS temp folder is cleaned eventually.
        }
      }
    });
  }

  const { createClient } = await import('@libsql/client');
  const client = createClient({ url: pathToFileURL(isAbsolute(path) ? path : resolve(path)).href, timeout: BUSY_TIMEOUT_MS });
  return { client, db: drizzle({ client, schema }), location: isMemory ? ':memory:' : path, remote: false };
}

const handle = await openDatabase(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN);

export const client = handle.client;
export const db = handle.db;
export const databaseLocation = handle.location;
export const isRemoteDatabase = handle.remote;

/**
 * One-time settings for a local database file. Write-ahead logging lets
 * readers and the single writer work side by side; it is stored in the file.
 * (Turso manages this itself.)
 */
export async function prepareDatabase(): Promise<void> {
  if (isRemoteDatabase) return;
  await client.execute('PRAGMA journal_mode = WAL');
}

export function closeDatabase(): void {
  if (!client.closed) client.close();
}
