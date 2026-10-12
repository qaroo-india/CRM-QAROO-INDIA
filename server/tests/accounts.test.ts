/**
 * Accounts: forgot password by email, student self-activation, staff-granted
 * student and faculty logins, the back-office wall for student logins, staff
 * profiles and photos.
 */

import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { passwordTokens, users } from '../src/db/schema';
import { setMailTransport, type MailMessage } from '../src/services/mailer';
import { bootstrap, clientWith, csrfFor, ownerClient, signIn, TEST_PASSWORD, type Client } from './support';

let app: Awaited<ReturnType<typeof bootstrap>>;
let owner: Client;
let courseId: string;
let n = 0;
const sent: MailMessage[] = [];

const tokenFrom = (m: MailMessage) => /token=([A-Za-z0-9_-]+)/.exec(m.text)![1]!;

async function publicPost(path: string, body: object) {
  const agent = request.agent(app);
  const csrf = await csrfFor(agent);
  return agent.post(`/api/v1${path}`).set('X-CSRF-Token', csrf).send(body);
}

async function login(email: string, password: string) {
  const agent = request.agent(app);
  const csrf = await csrfFor(agent);
  const res = await agent.post('/api/v1/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { res, agent, csrf };
}

async function admittedStudent(email: string | null) {
  n += 1;
  return (
    await owner
      .post('/api/v1/admissions', { courseId, admissionDate: '2026-09-01', listFeeMinor: 1_000_000, newStudent: { fullName: `Portal Student ${n}`, phone: `95000000${String(n).padStart(2, '0')}`, ...(email && { email }) } })
      .expect(201)
  ).body.data as { id: string; studentId: string };
}

beforeAll(async () => {
  app = await bootstrap();
  owner = await ownerClient(app);
  courseId = (await owner.post('/api/v1/courses', { code: 'ACC-1', name: 'Accounts Course', standardFeeMinor: 1_000_000 }).expect(201)).body.data.id;
  setMailTransport(async (m) => {
    sent.push(m);
    return { messageId: `t-${sent.length}`, transport: 'test' };
  });
});

afterEach(() => {
  sent.length = 0;
});

describe('forgot password', () => {
  it('answers the same for unknown emails and sends nothing', async () => {
    const res = await publicPost('/auth/forgot-password', { email: 'nobody@example.com' }).then((r) => r.body);
    expect(res.data).toEqual({ sent: true });
    expect(sent).toHaveLength(0);
  });

  it('emails a single-use link that sets a new password and ends old sessions', async () => {
    const staff = await clientWith(app, { permissions: ['leads:read'] });
    await publicPost('/auth/forgot-password', { email: staff.user.email }).then((r) => expect(r.status).toBe(200));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual([staff.user.email]);
    const token = tokenFrom(sent[0]!);

    // Only a hash is stored.
    const stored = db.select().from(passwordTokens).where(eq(passwordTokens.userId, staff.user.id)).all();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).not.toContain(token);

    const done = await publicPost('/auth/reset-password', { token, newPassword: 'Brand-New-Pass-77' });
    expect(done.status).toBe(200);
    expect(done.body.data.email).toBe(staff.user.email);

    // The old session is over, the old password fails, the new one works.
    await staff.get('/api/v1/auth/me').expect(401);
    expect((await login(staff.user.email, TEST_PASSWORD)).res.status).toBe(401);
    expect((await login(staff.user.email, 'Brand-New-Pass-77')).res.status).toBe(200);

    // Single use.
    const again = await publicPost('/auth/reset-password', { token, newPassword: 'Another-Pass-88' });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('INVALID_TOKEN');
  });

  it('refuses expired links and deactivated accounts', async () => {
    const staff = await clientWith(app, { permissions: ['leads:read'] });
    await publicPost('/auth/forgot-password', { email: staff.user.email });
    const token = tokenFrom(sent[0]!);
    db.update(passwordTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(passwordTokens.userId, staff.user.id)).run();
    expect((await publicPost('/auth/reset-password', { token, newPassword: 'Brand-New-Pass-77' })).status).toBe(422);

    sent.length = 0;
    await owner.post(`/api/v1/users/${staff.user.id}/deactivate`).expect(200);
    await publicPost('/auth/forgot-password', { email: staff.user.email });
    expect(sent).toHaveLength(0);
  });
});

describe('student portal logins', () => {
  it('lets an admitted student activate a login with their registered email', async () => {
    const { studentId } = await admittedStudent('meera.activate@example.com');
    await publicPost('/auth/activate', { email: 'Meera.Activate@example.com' }).then((r) => expect(r.body.data).toEqual({ sent: true }));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('activate=1');

    // Not usable until activated.
    const pending = db.select().from(users).where(eq(users.email, 'meera.activate@example.com')).get()!;
    expect(pending).toMatchObject({ accountType: 'student', isActive: false, permissions: [] });
    expect((await login('meera.activate@example.com', 'Student-Pass-2026')).res.status).toBe(401);

    await publicPost('/auth/reset-password', { token: tokenFrom(sent[0]!), newPassword: 'Student-Pass-2026' }).then((r) => expect(r.status).toBe(200));
    const { res, agent } = await login('meera.activate@example.com', 'Student-Pass-2026');
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ accountType: 'student', studentId, permissions: [] });

    // The back office is closed to student logins, even routes without a permission check.
    for (const path of ['/api/v1/students', '/api/v1/settings', '/api/v1/users/options', '/api/v1/search?q=ab', '/api/v1/reports/dashboard']) {
      const r = await agent.get(path);
      expect(r.status, path).toBe(403);
    }
    // Their own notifications still work.
    await agent.get('/api/v1/notifications').expect(200);

    const profile = (await owner.get(`/api/v1/students/${studentId}`).expect(200)).body.data;
    expect(profile.student.portal).toMatchObject({ isActive: true });
  });

  it('ignores activation for unknown emails and students without an admission', async () => {
    await owner.post('/api/v1/students', { fullName: 'No Admission', phone: '9500009999', email: 'no.admission@example.com' }).expect(201);
    await publicPost('/auth/activate', { email: 'no.admission@example.com' });
    await publicPost('/auth/activate', { email: 'ghost@example.com' });
    expect(sent).toHaveLength(0);
  });

  it('lets staff give and switch off a student login', async () => {
    const { studentId } = await admittedStudent('ravi.portal@example.com');
    const noAccess = await clientWith(app, { permissions: ['students:read'] });
    await noAccess.post(`/api/v1/portal-access/students/${studentId}`, { temporaryPassword: 'Temp-Pass-2026' }).expect(403);

    const granted = (await owner.post(`/api/v1/portal-access/students/${studentId}`, { temporaryPassword: 'Temp-Pass-2026' }).expect(201)).body.data;
    await owner.post(`/api/v1/portal-access/students/${studentId}`, { temporaryPassword: 'Temp-Pass-2026' }).expect(409);

    const first = await login('ravi.portal@example.com', 'Temp-Pass-2026');
    expect(first.res.body.data.user.mustChangePassword).toBe(true);

    await owner.post(`/api/v1/portal-access/${granted.userId}/revoke`).expect(200);
    const blocked = await login('ravi.portal@example.com', 'Temp-Pass-2026');
    expect(blocked.res.status).toBe(403);
    expect(blocked.res.body.error.code).toBe('ACCOUNT_DISABLED');
    // Team accounts are not "portal logins".
    await owner.post(`/api/v1/portal-access/${owner.user.id}/revoke`).expect(404);
  });

  it('shuts inactive and suspended students out of the portal until they are active again', async () => {
    const { studentId } = await admittedStudent('suspended.portal@example.com');
    await owner.post(`/api/v1/portal-access/students/${studentId}`, { temporaryPassword: 'Temp-Pass-2026' }).expect(201);
    const session = await login('suspended.portal@example.com', 'Temp-Pass-2026');
    expect(session.res.status).toBe(200);
    await session.agent.get('/api/v1/auth/me').expect(200);

    const setStatus = (status: string) => owner.put(`/api/v1/students/${studentId}`, { fullName: 'Suspended Portal', phone: '9500000999', email: 'suspended.portal@example.com', status }).expect(200);
    await setStatus('suspended');
    // The open session ends on its next request, and signing in again is refused.
    const ended = await session.agent.get('/api/v1/auth/me');
    expect(ended.status).toBe(401);
    expect(ended.body.error.code).toBe('SESSION_REVOKED');
    const refused = await login('suspended.portal@example.com', 'Temp-Pass-2026');
    expect(refused.res.status).toBe(403);
    expect(refused.res.body.error.code).toBe('ACCOUNT_DISABLED');

    // Staff cannot hand out a new login meanwhile; self-activation sends nothing.
    const other = await admittedStudent('inactive.portal@example.com');
    await owner.put(`/api/v1/students/${other.studentId}`, { fullName: 'Inactive Portal', phone: '9500000998', email: 'inactive.portal@example.com', status: 'inactive' }).expect(200);
    const grant = await owner.post(`/api/v1/portal-access/students/${other.studentId}`, { temporaryPassword: 'Temp-Pass-2026' }).expect(422);
    expect(grant.body.error.code).toBe('STUDENT_NOT_ACTIVE');
    expect((await publicPost('/auth/activate', { email: 'inactive.portal@example.com' })).status).toBe(200);
    expect(sent).toHaveLength(0);

    // Graduated students keep the portal (certificates, receipts).
    await setStatus('graduated');
    expect((await login('suspended.portal@example.com', 'Temp-Pass-2026')).res.status).toBe(200);
  });

  it('needs an email on the student record', async () => {
    const { studentId } = await admittedStudent(null);
    const res = await owner.post(`/api/v1/portal-access/students/${studentId}`, { temporaryPassword: 'Temp-Pass-2026' }).expect(422);
    expect(res.body.error.code).toBe('EMAIL_REQUIRED');
  });
});

describe('faculty logins', () => {
  it('creates a faculty login linked to the trainer, with faculty permissions only', async () => {
    const trainers = (await owner.post('/api/v1/trainers', { name: 'Faculty Fiona', email: 'fiona@example.com' }).expect(201)).body.data as { id: string; name: string }[];
    const trainer = trainers.find((t) => t.name === 'Faculty Fiona')!;
    await owner.post(`/api/v1/portal-access/trainers/${trainer.id}`, { temporaryPassword: 'Temp-Pass-2026' }).expect(201);

    const { res } = await login('fiona@example.com', 'Temp-Pass-2026');
    expect(res.body.data.user).toMatchObject({ accountType: 'faculty', trainerId: trainer.id });
    expect(res.body.data.user.permissions).toContain('attendance:write');
    expect(res.body.data.user.permissions).not.toContain('payments:read');

    const listed = (await owner.get('/api/v1/trainers').expect(200)).body.data.find((t: { id: string }) => t.id === trainer.id);
    expect(listed.portal).toMatchObject({ isActive: true });
    // Faculty appear in the staff list; owners cannot be made from faculty.
    const fiona = (await owner.get('/api/v1/users?accountType=faculty').expect(200)).body.data.find((u: { email: string }) => u.email === 'fiona@example.com');
    await owner.patch(`/api/v1/users/${fiona.id}`, { role: 'owner' }).expect(403);
  });
});

describe('staff profiles and photos', () => {
  it('stores HR profile fields', async () => {
    const created = (
      await owner
        .post('/api/v1/users', { name: 'Kiran HR', email: 'kiran.hr@example.com', role: 'staff', temporaryPassword: 'Temp-Pass-2026', staffCode: 'emp-007', designation: 'Counsellor', department: 'Admissions', employmentType: 'full_time', joinedOn: '2025-06-01' })
        .expect(201)
    ).body.data;
    expect(created).toMatchObject({ staffCode: 'EMP-007', designation: 'Counsellor', employmentType: 'full_time', joinedOn: '2025-06-01', accountType: 'team' });
    const updated = (await owner.patch(`/api/v1/users/${created.id}`, { designation: 'Senior counsellor' }).expect(200)).body.data;
    expect(updated).toMatchObject({ designation: 'Senior counsellor', department: 'Admissions' });
    await owner.post('/api/v1/users', { name: 'Dup Code', email: 'dup.code@example.com', role: 'staff', temporaryPassword: 'Temp-Pass-2026', staffCode: 'EMP-007' }).expect(409);
  });

  it('lets people set their own photo, images only', async () => {
    const staff = await clientWith(app, { permissions: ['leads:read'] });
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201', 'hex');
    const upload = (client: Client, userId: string, file: Buffer, name: string) => client.agent.post(`/api/v1/users/${userId}/photo`).set('X-CSRF-Token', client.csrf).attach('file', file, name);
    await upload(staff, staff.user.id, png, 'me.png').expect(200);
    await upload(staff, owner.user.id, png, 'not-mine.png').expect(403);
    await upload(staff, staff.user.id, Buffer.from('%PDF-1.4 x'), 'cv.pdf').expect(422);
    const res = await owner.agent.get(`/api/v1/users/${staff.user.id}/photo`).expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect((await signIn(app, staff.user)).user.id).toBe(staff.user.id);
  });
});
