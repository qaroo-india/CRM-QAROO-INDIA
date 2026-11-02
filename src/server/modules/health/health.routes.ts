/**
 * GET /api/v1/health        readiness: database, migrations, seed data
 * GET /api/v1/health/live   liveness: process is up (no dependency checks)
 *
 * Both are public by design -- they reveal no records, credentials or paths --
 * so hosting platforms and uptime monitors can call them without a session.
 *
 * Readiness returns 503 only when the database is DOWN. A "degraded" state
 * (pending migrations, missing seed data) returns 200 with the reason, because
 * the process can still answer and the fix is an operator action, not a restart.
 */

import { Router } from 'express';
import { ok } from '../../utils/respond';
import { getLiveness, getReadiness } from './health.service';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const health = await getReadiness();
  res.setHeader('Cache-Control', 'no-store');
  ok(res, health, undefined, health.status === 'down' ? 503 : 200);
});

healthRouter.get('/live', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  ok(res, getLiveness());
});
