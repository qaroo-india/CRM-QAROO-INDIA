/**
 * CLI: consistent copy of the live database.     npm run db:backup
 *                                                (production: node dist/backup.js)
 *
 * Uses SQLite's online backup API, so it is safe while the server is running
 * and writing -- unlike copying the .db file, which can capture a half-written
 * page or miss transactions still in the -wal file.
 *
 * Writes <database folder>/backups/institute-YYYYMMDD-HHMMSS.db, verifies the
 * copy with an integrity check, and keeps the newest --keep=N copies (default
 * 30). Copy the backups folder OFF the server too: a backup on the same disk
 * does not survive losing that disk. See docs/DEPLOYMENT.md (Backups).
 */

import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { logger } from '../config/logger';
import { closeDatabase, databaseLocation, sqlite } from './index';

async function main(): Promise<void> {
  if (databaseLocation === ':memory:') throw new Error('An in-memory database cannot be backed up.');
  const keepArg = process.argv.find((a) => a.startsWith('--keep='));
  const keep = keepArg ? Math.max(1, Number(keepArg.split('=')[1]) || 30) : 30;
  const folder = join(dirname(databaseLocation), 'backups');
  mkdirSync(folder, { recursive: true });

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const target = join(folder, `institute-${stamp}.db`);
  await sqlite.backup(target);

  // A self-contained single file (no -wal/-shm sidecars), then verify it.
  const copy = new Database(target);
  copy.pragma('journal_mode = DELETE');
  const integrity = copy.pragma('integrity_check', { simple: true });
  copy.close();
  if (integrity !== 'ok') throw new Error(`Backup written but failed its integrity check: ${String(integrity)}`);

  const backups = readdirSync(folder)
    .filter((f) => /^institute-\d{8}-\d{6}\.db$/.test(f))
    .sort()
    .reverse();
  for (const old of backups.slice(keep)) rmSync(join(folder, old));

  logger.info({ file: target, bytes: statSync(target).size, kept: Math.min(backups.length, keep), removed: Math.max(0, backups.length - keep) }, 'Backup complete and verified');
}

main()
  .catch((error) => {
    logger.error({ err: error }, 'Backup failed');
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
