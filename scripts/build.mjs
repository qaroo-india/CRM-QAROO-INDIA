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

import { readFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Every runtime dependency stays external except the in-repo shared module.
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@ims/'));

// Clean previous server bundle files without removing Vite client assets in dist/
for (const file of ['server.js', 'server.js.map', 'vercel.js', 'vercel.js.map', 'migrate.js', 'migrate.js.map', 'seed.js', 'seed.js.map', 'backup.js', 'backup.js.map']) {
  const target = new URL(`../dist/${file}`, import.meta.url);
  try { rmSync(target, { force: true }); } catch {}
}

// Files the server reads at run time, carried inside the bundle so a Vercel
// Function needs nothing else on disk: the PDF fonts (src/server/pdf/document.ts)
// and the migration journal for the health check (src/server/db/migrator.ts).
const font = (file) => readFileSync(new URL(`../assets/fonts/${file}`, import.meta.url)).toString('base64');
const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
const define = {
  __EMBEDDED_FONTS__: JSON.stringify({ regular: font('Inter_400Regular.ttf'), semiBold: font('Inter_600SemiBold.ttf') }),
  __EMBEDDED_JOURNAL__: JSON.stringify(journal.entries.map(({ idx, tag, when }) => ({ idx, tag, when }))),
};

const result = await build({
  entryPoints: {
    server: 'src/server/server.ts',
    vercel: 'src/server/vercel.ts',
    migrate: 'src/server/db/migrate.ts',
    seed: 'src/server/db/seed.ts',
    backup: 'src/server/db/backup.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  define,
  alias: {
    '@ims/shared': fileURLToPath(new URL('../src/shared/index.ts', import.meta.url)),
  },
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
