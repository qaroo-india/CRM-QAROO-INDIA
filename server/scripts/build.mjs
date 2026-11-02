/**
 * Production build: bundle the server into plain JavaScript in ./dist.
 *
 * Why bundle instead of running `tsc`: the @ims/shared workspace is consumed as
 * TypeScript source, which Node cannot execute. esbuild inlines it (and the
 * server's own modules) while leaving real npm dependencies external -- they
 * are installed in production as usual, and libSQL and Argon2 load native
 * binaries that must never be bundled.
 *
 * dist/vercel.js is the Vercel Function (see src/vercel.ts, index.js and
 * vercel.json); the others are for a long-running server and the database
 * CLI. On Vercel (VERCEL=1) a production build then migrates the database:
 * see scripts/vercel-migrate.mjs.
 *
 * Type checking is NOT done here; run `npm run typecheck` (CI does both).
 */

import { readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Every runtime dependency stays external except the in-repo workspace package.
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@ims/'));

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });

// Files the server reads at run time, carried inside the bundle so a Vercel
// Function needs nothing else on disk: the PDF fonts (src/pdf/document.ts)
// and the migration journal for the health check (src/db/migrator.ts).
const font = (file) => readFileSync(new URL(`../assets/fonts/${file}`, import.meta.url)).toString('base64');
const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
const define = {
  __EMBEDDED_FONTS__: JSON.stringify({ regular: font('Inter_400Regular.ttf'), semiBold: font('Inter_600SemiBold.ttf') }),
  __EMBEDDED_JOURNAL__: JSON.stringify(journal.entries.map(({ idx, tag, when }) => ({ idx, tag, when }))),
};

const result = await build({
  entryPoints: {
    server: 'src/server.ts',
    vercel: 'src/vercel.ts',
    migrate: 'src/db/migrate.ts',
    seed: 'src/db/seed.ts',
    backup: 'src/db/backup.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  define,
  sourcemap: true,
  external: [...external, 'pino-pretty'],
  logLevel: 'info',
  metafile: true,
});

const outputs = Object.entries(result.metafile.outputs)
  .filter(([file]) => file.endsWith('.js'))
  .map(([file, meta]) => `  ${file}  ${(meta.bytes / 1024).toFixed(1)} KB`);

console.log(`\nBuilt ${outputs.length} entry points:\n${outputs.join('\n')}`);

if (process.env.VERCEL === '1') await import('./vercel-migrate.mjs');
