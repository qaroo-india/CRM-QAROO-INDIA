/**
 * Private file storage (uploaded documents, generated reports, photos).
 * Files are never served statically: every download goes through an
 * authorised route that looks the file up by its database record.
 *
 * Two drivers, chosen by STORAGE_DRIVER (see config/env.ts):
 *   local -- STORAGE_DIR on this server's disk (development, tests, a VM)
 *   blob  -- a PRIVATE Vercel Blob store (Vercel, whose disk is temporary).
 *            Private blobs have no public URL; only this server, holding the
 *            store's credentials, can read them.
 *
 * Keys are generated here ("documents/2026/10/<uuid>.pdf"), never taken from
 * a client, and are checked so they cannot escape their folder.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { newId } from '@ims/shared';
import { get, put } from '@vercel/blob';
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

/** The same rule for blob pathnames: relative, no "..", no backslashes. */
function blobPathname(key: string): string {
  if (key.startsWith('/') || key.includes('\\') || key.split('/').some((part) => part === '..' || part === '.' || part === '')) {
    throw new Error('Storage key escapes the storage directory');
  }
  return key;
}

/** A fresh key under a folder, partitioned by month to keep directories small. */
export function newKey(folder: 'documents' | 'reports' | 'photos' | 'materials' | 'certificates' | 'tasks', extension: string, now: Date = new Date()): string {
  const ext = extension.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8) || 'bin';
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${folder}/${y}/${m}/${newId()}.${ext}`;
}

export async function saveFile(key: string, data: Buffer): Promise<void> {
  if (env.STORAGE_DRIVER === 'blob') {
    // allowOverwrite: false fails rather than overwrite: keys are unique by construction.
    await put(blobPathname(key), data, { access: 'private', addRandomSuffix: false, allowOverwrite: false });
    return;
  }
  const full = pathForKey(key);
  mkdirSync(dirname(full), { recursive: true });
  // 'wx' fails rather than overwrite: keys are unique by construction.
  writeFileSync(full, data, { flag: 'wx' });
}

export async function readStoredFile(key: string): Promise<Buffer | null> {
  if (env.STORAGE_DRIVER === 'blob') {
    // useCache: false reads from origin, so a file is readable right after upload.
    const result = await get(blobPathname(key), { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }
  const full = pathForKey(key);
  return existsSync(full) ? await readFile(full) : null;
}
