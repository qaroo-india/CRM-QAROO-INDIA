/**
 * Production build: bundle the server into plain JavaScript in ./dist.
 *
 * Why bundle instead of running `tsc`: the @ims/shared workspace is consumed as
 * TypeScript source, which Node cannot execute. esbuild inlines it (and the
 * server's own modules) while leaving real npm dependencies external -- they
 * are installed in production as usual, and better-sqlite3 ships a native
 * binary that must never be bundled.
 *
 * Type checking is NOT done here; run `npm run typecheck` (CI does both).
 */

import { readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Every runtime dependency stays external except the in-repo workspace package.
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@ims/'));

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });

const result = await build({
  entryPoints: {
    server: 'src/server.ts',
    migrate: 'src/db/migrate.ts',
    seed: 'src/db/seed.ts',
    backup: 'src/db/backup.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: [...external, 'pino-pretty'],
  logLevel: 'info',
  metafile: true,
});

const outputs = Object.entries(result.metafile.outputs)
  .filter(([file]) => file.endsWith('.js'))
  .map(([file, meta]) => `  ${file}  ${(meta.bytes / 1024).toFixed(1)} KB`);

console.log(`\nBuilt ${outputs.length} entry points:\n${outputs.join('\n')}`);
