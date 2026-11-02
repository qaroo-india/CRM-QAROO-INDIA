/**
 * Imported first by src/vercel.ts, before config/env.ts reads the
 * environment: a Vercel deployment is production unless NODE_ENV says
 * otherwise, so the production safety checks always apply there.
 */

if (process.env.VERCEL === '1') {
  process.env.NODE_ENV ||= 'production';
}
