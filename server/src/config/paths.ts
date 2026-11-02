/**
 * The server folder, home of drizzle/ (migrations) and assets/ (PDF fonts).
 * Normally the working directory. A Vercel Function may start in the
 * repository root instead, with the server one folder down.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const serverDir = [process.cwd(), resolve(process.cwd(), 'server')].find((dir) => existsSync(resolve(dir, 'drizzle', 'meta'))) ?? process.cwd();

export function serverPath(...parts: string[]): string {
  return resolve(serverDir, ...parts);
}
