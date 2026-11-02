/**
 * Build for the Vercel "server" service (vercel.json):
 *   1. bundle the server (scripts/build.mjs), including dist/vercel.js
 *   2. on PRODUCTION deployments, bring the hosted database up to date:
 *      apply pending migrations, then insert missing reference data (seed).
 *
 * Preview deployments skip step 2, so a branch can never change the
 * production schema. Give previews their own database and set
 * MIGRATE_ON_BUILD=true for the Preview environment to migrate that one.
 *
 * The database steps run with NODE_ENV=production, so the production checks
 * in config/env.ts apply: the seed can never create the owner with the
 * published development password.
 */

import { execFileSync } from 'node:child_process';

function run(file, env = process.env) {
  execFileSync(process.execPath, [file], { stdio: 'inherit', env });
}

run('scripts/build.mjs');

if (process.env.VERCEL_ENV === 'production' || process.env.MIGRATE_ON_BUILD === 'true') {
  const env = { ...process.env, NODE_ENV: 'production', JOBS_ENABLED: 'false' };
  run('dist/migrate.js', env);
  run('dist/seed.js', env);
} else {
  console.log(`Database left unchanged (VERCEL_ENV=${process.env.VERCEL_ENV ?? 'unset'}). Set MIGRATE_ON_BUILD=true to migrate this environment's database.`);
}
