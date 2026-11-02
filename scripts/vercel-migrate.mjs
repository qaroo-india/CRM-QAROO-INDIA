/**
 * The database step of a Vercel build, run by scripts/build.mjs after
 * bundling when VERCEL is set: on PRODUCTION deployments, bring the hosted
 * database up to date -- apply pending migrations, then insert missing
 * reference data (seed). A failure fails the build, so broken code never
 * goes live.
 *
 * Preview deployments skip it, so a branch can never change the production
 * schema. Give previews their own database and set MIGRATE_ON_BUILD=true for
 * the Preview environment to migrate that one.
 *
 * It runs with NODE_ENV=production, so the production checks in
 * config/env.ts apply: the seed can never create the owner with the
 * published development password.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dist = (file) => fileURLToPath(new URL(`../dist/${file}`, import.meta.url));

if (process.env.VERCEL_ENV === 'production' || process.env.MIGRATE_ON_BUILD === 'true') {
  const env = { ...process.env, NODE_ENV: 'production', JOBS_ENABLED: 'false' };
  for (const step of ['migrate.js', 'seed.js']) execFileSync(process.execPath, [dist(step)], { stdio: 'inherit', env });
} else {
  console.log(`Database left unchanged (VERCEL_ENV=${process.env.VERCEL_ENV ?? 'unset'}). Set MIGRATE_ON_BUILD=true to migrate this environment's database.`);
}
