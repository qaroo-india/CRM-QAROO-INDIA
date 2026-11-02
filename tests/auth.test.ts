/**
 * Authentication and authorisation: valid and invalid login, expired
 * sessions, unauthorised access, role restrictions, CSRF, refresh-token
 * rotation and theft detection, lockout, deactivation, privilege escalation.
 */

import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/server/config/env';
import { db } from '../src/server/db';
import { auditLogs, refreshTokens, users } from '../src/server/db/schema';
import { MAX_FAILED_LOGINS } from '../src/server/modules/auth/auth.service';
import {
  bootstrap,
  clientWith,
  createTestUser,
  csrfFor,
  ownerClient,
  signIn,
  TEST_PASSWORD,
} from './support';

let app: Awaited<ReturnType<typeof bootstrap>>;

beforeAll(async () => {
  app = await bootstrap();
});

function cookieHeader(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith(`${name}=`));
}

describe('login', () => {
  it('rejects a login without the CSRF header', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('signs in with valid credentials and sets hardened cookies', async () => {
    const user = await createTestUser({ name: 'Valid Login' });
    const agent = request.agent(app);
    const csrf = await csrfFor(agent);
    const res = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: user.email.toUpperCase(), password: TEST_PASSWORD })
      .expect(200);

    expect(res.body.data.user).toMatchObject({ email: user.email, name: 'Valid Login', role: 'staff' });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash|tokenVersion/);

    const access = cookieHeader(res, 'ims_at');
    const refresh = cookieHeader(res, 'ims_rt');
    expect(access).toMatch(/HttpOnly/i);
    expect(access).toMatch(/SameSite=Strict/i);
    expect(access).toMatch(/Path=\/api/);
    expect(refresh).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const user = await createTestUser();
    const agent = request.agent(app);
    const csrf = await csrfFor(agent);

    const wrong = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: user.email, password: 'Wrong-Password-1' })
      .expect(401);
    const unknown = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: 'nobody@nowhere.test', password: 'Wrong-Password-1' })
      .expect(401);

    expect(wrong.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    const user = await createTestUser();
    const agent = request.agent(app);
    const csrf = await csrfFor(agent);
    const attempt = (password: string) =>
      agent.post('/api/v1/auth/login').set('X-CSRF-Token', csrf).send({ email: user.email, password });

    for (let i = 0; i < MAX_FAILED_LOGINS; i += 1) {
      await attempt('Wrong-Password-1').expect(401);
    }
    const locked = await attempt(TEST_PASSWORD).expect(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('records the sign-in in the audit trail', async () => {
    const user = await createTestUser();
    await signIn(app, user);
    const entry = await db.select().from(auditLogs).where(eq(auditLogs.entityId, user.id)).get();
    expect(entry).toMatchObject({ action: 'login', actorId: user.id });
  });
});

describe('sessions', () => {
  it('rejects an anonymous request to a protected route', async () => {
    const res = await request(app).get('/api/v1/auth/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns the current user and institute', async () => {
    const client = await clientWith(app, { permissions: ['leads:read'] });
    const res = await client.get('/api/v1/auth/me').expect(200);
    expect(res.body.data.user.permissions).toEqual(['leads:read']);
    expect(res.body.data.institute.timezone).toBe('Asia/Kolkata');
    expect(res.body.data.csrfToken).toBe(client.csrf);
  });

  it('answers TOKEN_EXPIRED for an expired access token so the client can refresh', async () => {
    const user = await createTestUser();
    const expired = await new SignJWT({ tv: user.tokenVersion })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer('institute-os')
      .setAudience('institute-os-api')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(env.JWT_ACCESS_SECRET));

    const res = await request(app).get('/api/v1/auth/me').set('Cookie', `ims_at=${expired}`).expect(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects a token signed with a different secret', async () => {
    const user = await createTestUser();
    const forged = await new SignJWT({ tv: 0 })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer('institute-os')
      .setAudience('institute-os-api')
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode('an-attacker-controlled-secret-that-is-long-enough'));
    const res = await request(app).get('/api/v1/auth/me').set('Cookie', `ims_at=${forged}`).expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rotates the refresh token and keeps the session alive', async () => {
    const client = await clientWith(app);
    const res = await client.post('/api/v1/auth/refresh').expect(200);
    expect(cookieHeader(res, 'ims_rt')).toBeDefined();
    await client.get('/api/v1/auth/me').expect(200);
  });

  it('treats replay of a used refresh token as theft and ends the whole session family', async () => {
    const user = await createTestUser();
    const agent = request.agent(app);
    const loginCsrf = await csrfFor(agent);
    const login = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', loginCsrf)
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);
    const stolen = cookieHeader(login, 'ims_rt')?.split(';')[0]?.slice('ims_rt='.length);
    expect(stolen).toBeTruthy();

    await agent.post('/api/v1/auth/refresh').set('X-CSRF-Token', loginCsrf).expect(200);
    // Age the rotation beyond the concurrent-refresh grace window.
    await db.update(refreshTokens).set({ createdAt: new Date(Date.now() - 120_000) }).where(eq(refreshTokens.userId, user.id)).run();

    // The attacker replays the stolen cookie from a different client.
    const attackerCsrf = 'attacker-csrf-token-0123456789abcdef0123';
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `ims_rt=${stolen}; ims_csrf=${attackerCsrf}`)
      .set('X-CSRF-Token', attackerCsrf)
      .expect(401);
    expect(replay.body.error.code).toBe('SESSION_REVOKED');

    // The legitimate holder's refresh token was revoked along with the family.
    const live = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, user.id)).all();
    expect(live.every((t) => t.revokedAt !== null)).toBe(true);
    await agent.post('/api/v1/auth/refresh').set('X-CSRF-Token', loginCsrf).expect(401);
  });

  it('signs out by revoking the session', async () => {
    const client = await clientWith(app);
    await client.post('/api/v1/auth/logout').expect(200);
    await client.post('/api/v1/auth/refresh').expect(401);
    const revoked = (await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, client.user.id))
      .all())
      .filter((t) => t.revokedAt === null);
    expect(revoked).toHaveLength(0);
  });

  it('ends a deactivated user\'s session immediately', async () => {
    const owner = await ownerClient(app);
    const staff = await clientWith(app, { permissions: ['leads:read'] });
    await staff.get('/api/v1/auth/me').expect(200);

    await owner.post(`/api/v1/users/${staff.user.id}/deactivate`).expect(200);

    const res = await staff.get('/api/v1/auth/me').expect(401);
    expect(res.body.error.code).toBe('SESSION_REVOKED');
    await staff.post('/api/v1/auth/refresh').expect(401);
  });
});

describe('forced password change', () => {
  it('blocks everything except /auth until the seeded owner sets a new password', async () => {
    const seeded = (await db.select().from(users).where(eq(users.email, env.OWNER_EMAIL)).get())!;
    expect(seeded.mustChangePassword).toBe(true);
    const client = await signIn(app, seeded, env.OWNER_INITIAL_PASSWORD);

    const blocked = await client.get('/api/v1/users').expect(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await client.get('/api/v1/auth/me').expect(200);

    const weak = await client
      .post('/api/v1/auth/password', { currentPassword: env.OWNER_INITIAL_PASSWORD, newPassword: 'short' })
      .expect(422);
    expect(weak.body.error.fields[0].path).toBe('newPassword');

    await client
      .post('/api/v1/auth/password', {
        currentPassword: env.OWNER_INITIAL_PASSWORD,
        newPassword: 'A-New-Owner-Password-9',
      })
      .expect(200);
    await client.get('/api/v1/users').expect(200);
  });

  it('rejects a wrong current password', async () => {
    const client = await clientWith(app);
    const res = await client
      .post('/api/v1/auth/password', { currentPassword: 'Not-The-Password-1', newPassword: 'Another-Password-22' })
      .expect(422);
    expect(res.body.error.fields[0].path).toBe('currentPassword');
  });
});

describe('role and permission restrictions', () => {
  it('forbids staff without users:read from listing users', async () => {
    const staff = await clientWith(app, { permissions: ['leads:read'] });
    const res = await staff.get('/api/v1/users').expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('lets the owner manage users', async () => {
    const owner = await ownerClient(app);
    const res = await owner
      .post('/api/v1/users', {
        name: 'New Counsellor',
        email: 'counsellor@test.local',
        role: 'staff',
        permissions: ['leads:read', 'leads:write'],
        temporaryPassword: 'Temporary-Pass-1',
      })
      .expect(201);
    expect(res.body.data).toMatchObject({ role: 'staff', mustChangePassword: true });
  });

  it('blocks privilege escalation through user management', async () => {
    const manager = await clientWith(app, { permissions: ['users:read', 'users:write', 'leads:read'] });

    const res = await manager
      .post('/api/v1/users', {
        name: 'Sneaky',
        email: 'sneaky@test.local',
        role: 'staff',
        permissions: ['leads:read', 'payments:reverse'],
        temporaryPassword: 'Temporary-Pass-1',
      })
      .expect(403);
    expect(res.body.error.message).toMatch(/payments:reverse/);

    await manager
      .post('/api/v1/users', {
        name: 'Promoted',
        email: 'promoted@test.local',
        role: 'owner',
        temporaryPassword: 'Temporary-Pass-1',
      })
      .expect(403);
  });

  it('applies a permission change on the very next request', async () => {
    const owner = await ownerClient(app);
    const staff = await clientWith(app, { permissions: ['leads:read'] });
    await staff.get('/api/v1/users').expect(403);

    await owner.patch(`/api/v1/users/${staff.user.id}`, { permissions: ['leads:read', 'users:read'] }).expect(200);
    await staff.get('/api/v1/users').expect(200);
  });

  it('stops an owner from removing their own access', async () => {
    // Only owners can modify owners, so self-removal is the path by which an
    // institute could lose its last owner.
    const owner = await ownerClient(app);
    const deactivate = await owner.post(`/api/v1/users/${owner.user.id}/deactivate`).expect(403);
    expect(deactivate.body.error.message).toMatch(/your own account/);
    const demote = await owner.patch(`/api/v1/users/${owner.user.id}`, { role: 'staff' }).expect(403);
    expect(demote.body.error.message).toMatch(/your own role/);
  });

  it('lets an owner deactivate another owner, ending that session', async () => {
    const owner = await ownerClient(app);
    const peer = await createTestUser({ role: 'owner' });
    const peerClient = await signIn(app, peer);
    await owner.post(`/api/v1/users/${peer.id}/deactivate`).expect(200);
    await peerClient.get('/api/v1/auth/me').expect(401);
  });

  it('issues a temporary password that must be changed', async () => {
    const owner = await ownerClient(app);
    const staff = await createTestUser();
    await owner.post(`/api/v1/users/${staff.id}/reset-password`, { temporaryPassword: 'Temp-Reset-Pass-7' }).expect(200);
    const client = await signIn(app, staff, 'Temp-Reset-Pass-7');
    const res = await client.get('/api/v1/users/options').expect(403);
    expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const entries = await db.select().from(auditLogs).where(eq(auditLogs.entityId, staff.id)).all();
    expect(entries.some((a) => a.action === 'password_change')).toBe(true);
  });
});

describe('settings and lookups', () => {
  it('serves seeded lookups to any signed-in user', async () => {
    const staff = await clientWith(app);
    const sources = await staff.get('/api/v1/settings/lead-sources').expect(200);
    expect(sources.body.data.map((s: { name: string }) => s.name)).toContain('Justdial');
    const jobs = await staff.get('/api/v1/settings/job-categories').expect(200);
    expect(jobs.body.data.some((j: { track: string }) => j.track === 'non_technical')).toBe(true);
  });

  it('lets only settings:write manage lookups, and rejects duplicates', async () => {
    const staff = await clientWith(app);
    await staff.post('/api/v1/settings/lead-sources', { name: 'Billboard' }).expect(403);

    const owner = await ownerClient(app);
    const created = await owner.post('/api/v1/settings/lead-sources', { name: 'Billboard' }).expect(201);
    const dup = await owner.post('/api/v1/settings/lead-sources', { name: 'BILLBOARD' }).expect(409);
    expect(dup.body.error.code).toBe('CONFLICT');

    await owner.patch(`/api/v1/settings/lead-sources/${created.body.data.id}`, { isActive: false }).expect(200);
    const active = await owner.get('/api/v1/settings/lead-sources').expect(200);
    expect(active.body.data.some((s: { name: string }) => s.name === 'Billboard')).toBe(false);
    const all = await owner.get('/api/v1/settings/lead-sources?includeInactive=true').expect(200);
    expect(all.body.data.some((s: { name: string }) => s.name === 'Billboard')).toBe(true);
  });

  it('updates institute settings and writes an audit entry', async () => {
    const owner = await ownerClient(app);
    const res = await owner.patch('/api/v1/settings', { name: 'Apex Skills Academy', dueReminderDays: 5 }).expect(200);
    expect(res.body.data).toMatchObject({ name: 'Apex Skills Academy', dueReminderDays: 5 });

    const audit = await owner.get('/api/v1/audit?entityType=settings').expect(200);
    expect(audit.body.data.items[0].after).toMatchObject({ name: 'Apex Skills Academy' });
  });
});
