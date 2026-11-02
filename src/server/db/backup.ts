/**
 * CLI: consistent copy of the live database.     npm run db:backup
 *                                                (production: node dist/backup.js)
 *
 * Local database file: uses SQLite's VACUUM INTO, which writes a consistent
 * snapshot while the server keeps running and writing -- unlike copying the
 * .db file, which can capture a half-written page or miss transactions still
 * in the -wal file.
 *
 * Writes <database folder>/backups/institute-YYYYMMDD-HHMMSS.db, verifies the
 * copy with an integrity check, and keeps the newest --keep=N copies (default
 * 30). Copy the backups folder OFF the server too: a backup on the same disk
 * does not survive losing that disk. See docs/DEPLOYMENT.md (Backups).
 *
 * A hosted (Turso) database is backed up by Turso itself (point-in-time
 * restore); this script refuses it and says so.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { logger } from '../config/logger';
import { client, closeDatabase, databaseLocation, isRemoteDatabase } from './index';

async function main(): Promise<void> {
  if (isRemoteDatabase) {
    throw new Error(
      'This is a hosted Turso database. Use Turso point-in-time restore, or "turso db shell <name> .dump" for an off-site copy.',
    );
  }
  if (databaseLocation === ':memory:') throw new Error('An in-memory database cannot be backed up.');
  const keepArg = process.argv.find((a) => a.startsWith('--keep='));
  const keep = keepArg ? Math.max(1, Number(keepArg.split('=')[1]) || 30) : 30;
  const folder = join(dirname(databaseLocation), 'backups');
  mkdirSync(folder, { recursive: true });

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const target = join(folder, `institute-${stamp}.db`);
  if (existsSync(target)) throw new Error(`Backup ${target} already exists; wait a second and retry.`);
  await client.execute({ sql: 'VACUUM INTO ?', args: [target] });

  // A self-contained single file (no -wal/-shm sidecars), then verify it.
  const copy = createClient({ url: pathToFileURL(target).href });
  try {
    await copy.execute('PRAGMA journal_mode = DELETE');
    const integrity = (await copy.execute('PRAGMA integrity_check')).rows[0]?.[0];
    if (integrity !== 'ok') throw new Error(`Backup written but failed its integrity check: ${String(integrity)}`);
  } finally {
    copy.close();
  }

  const backups = readdirSync(folder)
    .filter((f) => /^institute-\d{8}-\d{6}\.db$/.test(f))
    .sort()
    .reverse();
  for (const old of backups.slice(keep)) rmSync(join(folder, old));

  logger.info({ file: target, bytes: statSync(target).size, kept: Math.min(backups.length, keep), removed: Math.max(0, backups.length - keep) }, 'Backup complete and verified');
}

await main()
  .catch((error) => {
    logger.error({ err: error }, 'Backup failed');
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
