/**
 * Courses, leads, students and admissions -- the brief's admission tests:
 * create a valid admission, reject invalid fees, preserve linked lead
 * information, handle duplicate submissions safely -- plus duplicate identity
 * protection, lifecycle rules and permissions.
 */

import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/server/db';
import { admissions, feeAdjustments, leadActivities, leads, students } from '../src/server/db/schema';
import { bootstrap, clientWith, ownerClient, type Client } from './support';

let app: Awaited<ReturnType<typeof bootstrap>>;
let owner: Client;
let courseId: string;
let sourceId: string;

const TODAY = '2026-10-10';

function newStudent(overrides: Record<string, unknown> = {}) {
  const n = Math.floor(Math.random() * 9_000_000) + 1_000_000;
  return { fullName: `Student ${n}`, phone: `98${n}0`.slice(0, 10), email: `s${n}@test.local`, ...overrides };
}

function createAdmission(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const req = owner.post('/api/v1/admissions', {
    courseId,
    admissionDate: TODAY,
    listFeeMinor: 5_000_000,
    discountMinor: 500_000,
    admissionFeeRequiredMinor: 1_000_000,
    ...body,
  });
  for (const [k, v] of Object.entries(headers)) req.set(k, v);
  return req;
}

beforeAll(async () => {
  app = await bootstrap();
  owner = await ownerClient(app);
  const course = await owner
    .post('/api/v1/courses', { code: 'FSD-01', name: 'Full-Stack Development', standardFeeMinor: 5_000_000, placementTrack: 'technical', modules: ['HTML', 'React'] })
    .expect(201);
  courseId = course.body.data.id;
  const sources = await owner.get('/api/v1/settings/lead-sources').expect(200);
  sourceId = sources.body.data.find((s: { name: string }) => s.name === 'Google Ads').id;
});

describe('courses', () => {
  it('rejects a duplicate course code regardless of case', async () => {
    const res = await owner.post('/api/v1/courses', { code: 'fsd-01', name: 'Copy', standardFeeMinor: 100 }).expect(409);
    expect(res.body.error.message).toMatch(/FSD-01/);
  });

  it('rejects an admission fee above the course fee', async () => {
    const res = await owner
      .post('/api/v1/courses', { code: 'BAD-01', name: 'Bad', standardFeeMinor: 1000, defaultAdmissionFeeMinor: 5000 })
      .expect(422);
    expect(res.body.error.fields[0].path).toBe('defaultAdmissionFeeMinor');
  });
});

describe('admission creation', () => {
  it('creates a valid admission with a new student', async () => {
    const res = await createAdmission({ newStudent: newStudent() }).expect(201);
    const a = res.body.data;
    expect(a.admissionNumber).toMatch(/^ADM-2026-\d{5}$/);
    expect(a.studentCode).toMatch(/^STU-2026-\d{5}$/);
    expect(a.agreedFeeMinor).toBe(4_500_000);
    expect(a.status).toBe('pending_payment');
    expect(a.outstandingMinor).toBe(4_500_000);
    expect(a.paidMinor).toBe(0);
    // No source without a traceable lead.
    expect(a.attributedSourceId).toBeNull();
  });

  it('starts active when nothing is required up front, but still owes the full fee', async () => {
    const res = await createAdmission({ newStudent: newStudent(), admissionFeeRequiredMinor: 0 }).expect(201);
    expect(res.body.data.status).toBe('active');
    expect(res.body.data.outstandingMinor).toBe(4_500_000);
  });

  it('rejects invalid fees', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ discountMinor: 6_000_000 }, 'discountMinor'],
      [{ admissionFeeRequiredMinor: 4_600_000 }, 'admissionFeeRequiredMinor'],
      [{ listFeeMinor: -100 }, 'listFeeMinor'],
      [{ listFeeMinor: 100.5 }, 'listFeeMinor'],
    ];
    for (const [body, path] of cases) {
      const res = await createAdmission({ newStudent: newStudent(), ...body }).expect(422);
      expect(res.body.error.fields.map((f: { path: string }) => f.path), JSON.stringify(body)).toContain(path);
    }
  });

  it('refuses a course that is no longer active', async () => {
    const course = await owner.post('/api/v1/courses', { code: 'OLD-01', name: 'Retired course', standardFeeMinor: 100, isActive: false }).expect(201);
    const res = await createAdmission({ newStudent: newStudent(), courseId: course.body.data.id, listFeeMinor: 100, discountMinor: 0, admissionFeeRequiredMinor: 0 }).expect(422);
    expect(res.body.error.code).toBe('COURSE_INACTIVE');
  });

  it('requires exactly one of an existing or a new student', async () => {
    const res = await createAdmission({}).expect(422);
    expect(res.body.error.fields[0].path).toBe('studentId');
  });
});

describe('lead conversion', () => {
  let leadId: string;

  it('preserves the linked lead and its source attribution', async () => {
    const counsellor = await clientWith(app, { permissions: ['leads:read'] });
    const lead = await owner
      .post('/api/v1/leads', { name: 'Rahul Verma', phone: '+91 98111-22334', enquiryDate: '2026-10-01', leadSourceId: sourceId, counsellorId: counsellor.user.id, interestedCourseId: courseId })
      .expect(201);
    leadId = lead.body.data.id;

    const res = await createAdmission({ leadId, newStudent: newStudent({ fullName: 'Rahul Verma', phone: '9811122334' }) }).expect(201);
    const admission = res.body.data;
    expect(admission.leadId).toBe(leadId);
    expect(admission.attributedSourceId).toBe(sourceId);
    expect(admission.sourceName).toBe('Google Ads');
    // The lead's counsellor carries over when none is given.
    expect(admission.counsellorId).toBe(counsellor.user.id);

    const stored = (await db.select().from(leads).where(eq(leads.id, leadId)).get())!;
    expect(stored.status).toBe('converted');
    expect(stored.convertedOn).toBe(TODAY);
    expect(stored.studentId).toBe(admission.studentId);

    const activity = await db.select().from(leadActivities).where(eq(leadActivities.leadId, leadId)).all();
    expect(activity.some((a) => a.type === 'conversion' && a.note?.includes(admission.admissionNumber))).toBe(true);
  });

  it('freezes the source of a converted lead', async () => {
    const other = (await owner.get('/api/v1/settings/lead-sources').expect(200)).body.data.find((s: { name: string }) => s.name === 'Walk-in').id;
    const detail = (await owner.get(`/api/v1/leads/${leadId}`).expect(200)).body.data;
    const res = await owner
      .put(`/api/v1/leads/${leadId}`, { name: detail.name, phone: detail.phone, enquiryDate: detail.enquiryDate, leadSourceId: other, priority: 'medium' })
      .expect(409);
    expect(res.body.error.message).toMatch(/source/i);
  });

  it('never converts the same lead twice', async () => {
    const res = await createAdmission({ leadId, newStudent: newStudent() }).expect(409);
    expect(res.body.error.code).toBe('LEAD_ALREADY_CONVERTED');
  });
});

describe('duplicate submissions and identities', () => {
  it('returns the original admission when a submission is replayed', async () => {
    const key = 'admission-key-0001-abcdef';
    const student = newStudent();
    const first = await createAdmission({ newStudent: student }, { 'Idempotency-Key': key }).expect(201);
    const second = await createAdmission({ newStudent: student }, { 'Idempotency-Key': key }).expect(200);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await db.select().from(admissions).where(eq(admissions.idempotencyKey, key)).all()).toHaveLength(1);
    expect(await db.select().from(students).where(eq(students.phone, student.phone)).all()).toHaveLength(1);
  });

  it('stops a second identity for the same person unless confirmed', async () => {
    const student = newStudent();
    await createAdmission({ newStudent: student }).expect(201);

    const reformatted = { ...student, fullName: 'Same Person', phone: `+91 ${student.phone.slice(0, 5)} ${student.phone.slice(5)}`, email: undefined };
    const blocked = await createAdmission({ newStudent: reformatted }).expect(409);
    expect(blocked.body.error.code).toBe('DUPLICATE_STUDENT');
    expect(blocked.body.error.details.matches[0]).toMatchObject({ kind: 'student', matchedOn: ['phone'] });

    await createAdmission({ newStudent: reformatted, allowDuplicate: true }).expect(201);
  });

  it('gives a returning student a second admission, not a second identity', async () => {
    const first = await createAdmission({ newStudent: newStudent() }).expect(201);
    const studentId = first.body.data.studentId;
    await createAdmission({ studentId, admissionDate: '2026-10-11' }).expect(201);

    const profile = await owner.get(`/api/v1/students/${studentId}`).expect(200);
    expect(profile.body.data.admissions).toHaveLength(2);
    expect(profile.body.data.student.admissionCount).toBe(2);
    expect(profile.body.data.student.outstandingMinor).toBe(9_000_000);
  });
});

describe('admission lifecycle', () => {
  it('activates, then completes', async () => {
    const id = (await createAdmission({ newStudent: newStudent() }).expect(201)).body.data.id;
    const early = await owner.post(`/api/v1/admissions/${id}/status`, { action: 'complete', date: TODAY }).expect(409);
    expect(early.body.error.code).toBe('INVALID_TRANSITION');

    await owner.post(`/api/v1/admissions/${id}/status`, { action: 'activate', date: TODAY }).expect(200);
    const done = await owner.post(`/api/v1/admissions/${id}/status`, { action: 'complete', date: '2026-12-20' }).expect(200);
    expect(done.body.data).toMatchObject({ status: 'completed', completedOn: '2026-12-20' });
  });

  it('cancels an unpaid admission, removing it from receivables', async () => {
    const id = (await createAdmission({ newStudent: newStudent() }).expect(201)).body.data.id;
    await owner.post(`/api/v1/admissions/${id}/status`, { action: 'cancel', date: TODAY }).expect(422);
    const res = await owner.post(`/api/v1/admissions/${id}/status`, { action: 'cancel', date: TODAY, reason: 'Changed plans' }).expect(200);
    expect(res.body.data).toMatchObject({ status: 'cancelled', cancelledOn: TODAY, outstandingMinor: 0 });
  });

  it('needs admissions:cancel to cancel', async () => {
    const staff = await clientWith(app, { permissions: ['admissions:read', 'admissions:write'] });
    const id = (await createAdmission({ newStudent: newStudent() }).expect(201)).body.data.id;
    await staff.post(`/api/v1/admissions/${id}/status`, { action: 'cancel', date: TODAY, reason: 'x y z' }).expect(403);
  });

  it('writes off the balance on withdrawal when asked', async () => {
    const id = (await createAdmission({ newStudent: newStudent() }).expect(201)).body.data.id;
    const res = await owner
      .post(`/api/v1/admissions/${id}/status`, { action: 'withdraw', date: TODAY, reason: 'Relocated', writeOffBalance: true })
      .expect(200);
    expect(res.body.data).toMatchObject({ status: 'withdrawn', outstandingMinor: 0, adjustmentsMinor: 4_500_000 });
    const adjustment = (await db.select().from(feeAdjustments).where(eq(feeAdjustments.admissionId, id)).get())!;
    expect(adjustment).toMatchObject({ type: 'write_off', amountMinor: 4_500_000 });
  });

  it('keeps the balance receivable on withdrawal by default', async () => {
    const id = (await createAdmission({ newStudent: newStudent() }).expect(201)).body.data.id;
    const res = await owner.post(`/api/v1/admissions/${id}/status`, { action: 'withdraw', date: TODAY, reason: 'Paused' }).expect(200);
    expect(res.body.data.outstandingMinor).toBe(4_500_000);
  });
});

describe('admission lists and permissions', () => {
  it('filters by source, including unattributed', async () => {
    const attributed = await owner.get(`/api/v1/admissions?sourceId=${sourceId}`).expect(200);
    expect(attributed.body.data.items.every((a: { sourceName: string }) => a.sourceName === 'Google Ads')).toBe(true);
    const unattributed = await owner.get('/api/v1/admissions?sourceId=unattributed').expect(200);
    expect(unattributed.body.data.items.every((a: { attributedSourceId: string | null }) => a.attributedSourceId === null)).toBe(true);
    expect(unattributed.body.data.total).toBeGreaterThan(0);
  });

  it('filters to admissions with an unpaid balance', async () => {
    const res = await owner.get('/api/v1/admissions?outstanding=true&limit=100').expect(200);
    expect(res.body.data.items.every((a: { outstandingMinor: number }) => a.outstandingMinor > 0)).toBe(true);
  });

  it('counts live admissions per course (correlated subquery binds to the right table)', async () => {
    const course = (await owner.post('/api/v1/courses', { code: 'CNT-01', name: 'Count check', standardFeeMinor: 1000 }).expect(201)).body.data;
    expect(course.activeAdmissions).toBe(0);
    for (let i = 0; i < 2; i += 1) {
      await createAdmission({ courseId: course.id, listFeeMinor: 1000, discountMinor: 0, admissionFeeRequiredMinor: 0, newStudent: newStudent() }).expect(201);
    }
    const after = (await owner.get(`/api/v1/courses/${course.id}`).expect(200)).body.data;
    expect(after.activeAdmissions).toBe(2);

    const enrolled = await owner.get(`/api/v1/students?courseId=${course.id}`).expect(200);
    expect(enrolled.body.data.total).toBe(2);
    expect(enrolled.body.data.items.every((s: { latestCourseName: string; outstandingMinor: number }) => s.latestCourseName === 'Count check' && s.outstandingMinor === 1000)).toBe(true);
  });

  it('forbids creating admissions without admissions:write', async () => {
    const staff = await clientWith(app, { permissions: ['admissions:read'] });
    await staff.post('/api/v1/admissions', { courseId, admissionDate: TODAY, listFeeMinor: 1, newStudent: newStudent() }).expect(403);
  });
});
