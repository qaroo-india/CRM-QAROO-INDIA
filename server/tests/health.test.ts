/**
 * Milestone 1 integration tests: the app boots, talks to a real SQLite
 * database (in memory), and the health endpoint reports each setup step
 * truthfully as the database moves from empty -> migrated -> seeded.
 *
 * Tests in this file run in order and share one in-memory database.
 */

import { healthResponseSchema, livenessResponseSchema } from '@ims/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { db, sqlite } from '../src/db';
import { getMigrationStatus, runMigrations } from '../src/db/migrator';
import { seedDatabase } from '../src/db/seeders';
import { toApiError } from '../src/middleware/errorHandler';
import { clientWith } from './support';

const app = createApp();

function dependency(body: { data: { dependencies: { name: string; status: string; detail?: string }[] } }, name: string) {
  const found = body.data.dependencies.find((d) => d.name === name);
  if (!found) throw new Error(`dependency "${name}" missing from health response`);
  return found;
}

describe('health readiness lifecycle', () => {
  it('reports degraded with pending migrations on an empty database', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('degraded');
    expect(dependency(res.body, 'database').status).toBe('ok');
    expect(dependency(res.body, 'migrations').status).toBe('degraded');
    expect(dependency(res.body, 'migrations').detail).toMatch(/db:migrate/);
  });

  it('applies every committed migration', () => {
    const before = getMigrationStatus(sqlite);
    expect(before.available).toBeGreaterThan(0);
    expect(before.pending.length).toBe(before.available);

    runMigrations(db);

    const after = getMigrationStatus(sqlite);
    expect(after.pending).toEqual([]);
    expect(after.applied).toBe(after.available);
  });

  it('then reports that seed data is missing', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);

    expect(res.body.data.status).toBe('degraded');
    expect(dependency(res.body, 'migrations').status).toBe('ok');
    expect(dependency(res.body, 'settings').status).toBe('degraded');
    expect(dependency(res.body, 'settings').detail).toMatch(/db:seed/);
    expect(dependency(res.body, 'accounts').status).toBe('degraded');
  });

  it('seeds idempotently', async () => {
    const first = await seedDatabase(db);
    expect(first.find((r) => r.name === 'institute_settings')?.inserted).toBe(1);
    expect(first.find((r) => r.name === 'owner_account')?.inserted).toBe(1);
    expect(first.find((r) => r.name === 'lead_sources')?.inserted).toBe(15);

    const second = await seedDatabase(db);
    expect(second.every((r) => r.inserted === 0)).toBe(true);
  });

  it('reports fully healthy once migrated and seeded', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);

    expect(res.body.data.status).toBe('ok');
    for (const dep of res.body.data.dependencies) {
      expect(dep.status, `${dep.name}: ${dep.detail}`).toBe('ok');
    }
    expect(res.body.data.timezone).toBe('Asia/Kolkata');
    expect(res.body.data.environment).toBe('test');
  });

  it('matches the shared contract the client parses', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);
    const parsed = healthResponseSchema.safeParse(res.body.data);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('is never cached', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('liveness', () => {
  it('answers without touching dependencies', async () => {
    const res = await request(app).get('/api/v1/health/live').expect(200);
    expect(livenessResponseSchema.safeParse(res.body.data).success).toBe(true);
  });
});

describe('database integrity guarantees', () => {
  it('enforces foreign keys', () => {
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('rejects a second institute settings row', () => {
    expect(() =>
      sqlite
        .prepare(
          "insert into institute_settings (id, name, timezone, currency, locale, created_at, updated_at) values ('other', 'X', 'UTC', 'INR', 'en-IN', 0, 0)",
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('rejects a role outside the shared vocabulary', () => {
    expect(() =>
      sqlite
        .prepare(
          "insert into users (id, email, name, password_hash, role, permissions, created_at, updated_at) values ('0190a0a0-0000-7000-8000-000000000001', 'a@b.com', 'A', 'h', 'superuser', '[]', 0, 0)",
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('maps a real unique-constraint violation to a 409, not a 500', () => {
    const insert = sqlite.prepare(
      "insert into users (id, email, name, password_hash, role, permissions, created_at, updated_at) values (?, 'dup@example.com', 'A', 'h', 'staff', '[]', 0, 0)",
    );
    insert.run('0190a0a0-0000-7000-8000-0000000000a1');

    let thrown: unknown;
    try {
      insert.run('0190a0a0-0000-7000-8000-0000000000a2');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    const mapped = toApiError(thrown);
    expect(mapped?.status).toBe(409);
    expect(mapped?.code).toBe('CONFLICT');
    // The driver's message names the table and column; it must not reach clients.
    expect(mapped?.message).not.toMatch(/users\.email/);
  });

  it('treats an unknown error as a bug, not a client mistake', () => {
    expect(toApiError(new Error('boom'))).toBeNull();
  });

  it('rejects an email that is not normalised to lowercase', () => {
    expect(() =>
      sqlite
        .prepare(
          "insert into users (id, email, name, password_hash, role, permissions, created_at, updated_at) values ('0190a0a0-0000-7000-8000-000000000002', 'Mixed@Case.com', 'A', 'h', 'staff', '[]', 0, 0)",
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });
});

describe('error responses', () => {
  it('does not reveal unknown routes to anonymous callers', async () => {
    const res = await request(app).get('/api/v1/does-not-exist').expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns a structured 404 for unknown routes once signed in', async () => {
    const client = await clientWith(app);
    const res = await client.get('/api/v1/does-not-exist').expect(404);

    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'ROUTE_NOT_FOUND', message: 'No route for GET /api/v1/does-not-exist' },
    });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('returns 400 for malformed JSON instead of a 500', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken": ')
      .expect(400);

    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects oversized bodies', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(1_100_000) }))
      .expect(413);

    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('security headers and CORS', () => {
  it('sets hardening headers and hides the framework', async () => {
    const res = await request(app).get('/api/v1/health/live');

    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('allows the configured client origin with credentials', async () => {
    const res = await request(app).get('/api/v1/health/live').set('Origin', 'http://localhost:5173');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('gives an unknown origin no CORS grant', async () => {
    const res = await request(app).get('/api/v1/health/live').set('Origin', 'https://evil.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('honours a safe incoming request id', async () => {
    const res = await request(app).get('/api/v1/health/live').set('X-Request-Id', 'trace-abc-12345');
    expect(res.headers['x-request-id']).toBe('trace-abc-12345');
  });

  it('replaces an unsafe request id rather than logging it', async () => {
    // Legal in an HTTP header, but not in our id whitelist.
    const res = await request(app)
      .get('/api/v1/health/live')
      .set('X-Request-Id', '<script>INJECTED</script> fake=entry');

    expect(res.headers['x-request-id']).not.toContain('INJECTED');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
