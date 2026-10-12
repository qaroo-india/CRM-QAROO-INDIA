/**
 * Private file storage on the server's disk (uploaded documents, generated
 * reports). Files are never served statically: every download goes through
 * an authorised route that looks the file up by its database record.
 *
 * Keys are generated here ("documents/2026/10/<uuid>.pdf"), never taken from
 * a client, and are resolved strictly inside STORAGE_DIR.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { newId } from '@ims/shared';
import { env } from '../config/env';

export function storageRoot(): string {
  return resolve(process.cwd(), env.STORAGE_DIR);
}

/** Absolute path for a key, refusing anything that escapes the storage root. */
export function pathForKey(key: string): string {
  const root = storageRoot();
  const full = resolve(root, key);
  if (!full.startsWith(root + sep)) throw new Error('Storage key escapes the storage directory');
  return full;
}

/** A fresh key under a folder, partitioned by month to keep directories small. */
export function newKey(folder: 'documents' | 'reports' | 'photos' | 'materials' | 'certificates' | 'tasks', extension: string, now: Date = new Date()): string {
  const ext = extension.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8) || 'bin';
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${folder}/${y}/${m}/${newId()}.${ext}`;
}

export function saveFile(key: string, data: Buffer): void {
  const full = pathForKey(key);
  mkdirSync(dirname(full), { recursive: true });
  // 'wx' fails rather than overwrite: keys are unique by construction.
  writeFileSync(full, data, { flag: 'wx' });
}

export function readStoredFile(key: string): Buffer | null {
  const full = pathForKey(key);
  return existsSync(full) ? readFileSync(full) : null;
}
