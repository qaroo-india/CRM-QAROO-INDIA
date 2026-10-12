/**
 * Health checks.
 *
 * Readiness answers "can this instance do real work right now?" by probing
 * three things a working deployment needs, in order:
 *   1. database   -- the file opens and answers a query
 *   2. migrations -- the schema matches the committed migrations
 *   3. settings   -- reference data has been seeded
 * Each probe reports its own status, so the response says exactly which setup
 * step was missed instead of a bare "unhealthy".
 */

import { performance } from 'node:perf_hooks';
import type { DependencyHealth, HealthResponse, HealthState } from '@ims/shared';
import { and, count, eq } from 'drizzle-orm';
import { env } from '../../config/env';
import { db, sqlite } from '../../db';
import { getMigrationStatus } from '../../db/migrator';
import { INSTITUTE_SETTINGS_ID, instituteSettings, users } from '../../db/schema';
import packageJson from '../../../package.json' with { type: 'json' };

const SEVERITY: Record<HealthState, number> = { ok: 0, degraded: 1, down: 2 };

function elapsedMs(start: number): number {
  return Math.round((performance.now() - start) * 100) / 100;
}

function checkDatabase(): DependencyHealth {
  const start = performance.now();
  try {
    sqlite.prepare('select 1').get();
    return { name: 'database', status: 'ok', latencyMs: elapsedMs(start), detail: 'SQLite responding' };
  } catch {
    // The error itself is logged by the caller; never echo driver messages,
    // which can include file system paths.
    return { name: 'database', status: 'down', latencyMs: null, detail: 'Database is unreachable' };
  }
}

function checkMigrations(): DependencyHealth {
  const start = performance.now();
  const status = getMigrationStatus(sqlite);
  const latencyMs = elapsedMs(start);

  if (status.available === 0) {
    return {
      name: 'migrations',
      status: 'degraded',
      latencyMs,
      detail: 'No migrations found. Run "npm run db:generate" to create them.',
    };
  }
  if (status.pending.length > 0) {
    return {
      name: 'migrations',
      status: 'degraded',
      latencyMs,
      detail: `${status.pending.length} pending migration(s). Run "npm run db:migrate".`,
    };
  }
  return {
    name: 'migrations',
    status: 'ok',
    latencyMs,
    detail: `${status.applied} migration(s) applied, schema up to date`,
  };
}

function checkSettings(): { health: DependencyHealth; timezone: string | null } {
  const start = performance.now();
  try {
    const row = db
      .select({ timezone: instituteSettings.timezone })
      .from(instituteSettings)
      .where(eq(instituteSettings.id, INSTITUTE_SETTINGS_ID))
      .get();

    if (!row) {
      return {
        health: {
          name: 'settings',
          status: 'degraded',
          latencyMs: elapsedMs(start),
          detail: 'Institute settings not seeded. Run "npm run db:seed".',
        },
        timezone: null,
      };
    }
    return {
      health: { name: 'settings', status: 'ok', latencyMs: elapsedMs(start), detail: 'Institute settings present' },
      timezone: row.timezone,
    };
  } catch {
    // Most likely the table does not exist yet because migrations never ran.
    return {
      health: {
        name: 'settings',
        status: 'degraded',
        latencyMs: null,
        detail: 'Settings table unavailable. Run "npm run db:migrate" then "npm run db:seed".',
      },
      timezone: null,
    };
  }
}

function checkAccounts(): DependencyHealth {
  const start = performance.now();
  try {
    const owners =
      db
        .select({ n: count() })
        .from(users)
        .where(and(eq(users.role, 'owner'), eq(users.isActive, true)))
        .get()?.n ?? 0;
    return owners > 0
      ? { name: 'accounts', status: 'ok', latencyMs: elapsedMs(start), detail: 'An active owner account exists' }
      : {
          name: 'accounts',
          status: 'degraded',
          latencyMs: elapsedMs(start),
          detail: 'No active owner account. Run "npm run db:seed".',
        };
  } catch {
    return { name: 'accounts', status: 'degraded', latencyMs: null, detail: 'Accounts table unavailable. Run "npm run db:migrate".' };
  }
}

export function getReadiness(): HealthResponse {
  const database = checkDatabase();

  // Without a database the remaining probes can only fail the same way.
  const dependencies: DependencyHealth[] = [database];
  let timezone: string | null = null;

  if (database.status !== 'down') {
    dependencies.push(checkMigrations());
    const settings = checkSettings();
    dependencies.push(settings.health);
    dependencies.push(checkAccounts());
    timezone = settings.timezone;
  }

  const status = dependencies.reduce<HealthState>(
    (worst, dep) => (SEVERITY[dep.status] > SEVERITY[worst] ? dep.status : worst),
    'ok',
  );

  return {
    status,
    service: 'institute-management-api',
    version: packageJson.version,
    environment: env.NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    // The seeded settings row is authoritative once it exists.
    timezone: timezone ?? env.INSTITUTE_TIMEZONE,
    dependencies,
  };
}

export function getLiveness() {
  return { status: 'ok' as const, uptimeSeconds: Math.round(process.uptime()) };
}
