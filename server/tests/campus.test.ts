/**
 * Campus modules end to end: class schedule, attendance, exams with server
 * grading, study material, certificates, placement drives, leave, tasks and
 * inventory -- plus the faculty scope and the student portal.
 */

import { addDays } from '@ims/shared';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { runNotificationSweep } from '../src/modules/notifications/notifications.service';
import { instituteToday } from '../src/services/clock';
import { bootstrap, clientWith, csrfFor, ownerClient, type Client } from './support';

let app: Awaited<ReturnType<typeof bootstrap>>;
let owner: Client;
let courseId: string;
let otherCourseId: string;
let batchId: string;
let otherBatchId: string;
let trainerId: string;
let faculty: Client;
let student: Client;
let studentId: string;
let admissionId: string;
let classmateAdmissionId: string;
let phone = 9_600_000_000;
// Set once the test database exists (the institute time zone lives in its settings).
let today: string;
let start: string;

/** Sign in, then complete the forced password change, like the browser does. */
async function loginWithTemp(email: string, temp: string): Promise<Client> {
  const agent = request.agent(app);
  const csrf = await csrfFor(agent);
  const login = await agent.post('/api/v1/auth/login').set('X-CSRF-Token', csrf).send({ email, password: temp });
  expect(login.status).toBe(200);
  await agent.post('/api/v1/auth/password').set('X-CSRF-Token', csrf).send({ currentPassword: temp, newPassword: 'Final-Pass-2026' }).expect(200);
  const withCsrf = (t: request.Test) => t.set('X-CSRF-Token', csrf);
  return {
    agent,
    csrf,
    user: login.body.data.user,
    get: (url) => agent.get(url),
    post: (url, body) => withCsrf(agent.post(url)).send((body ?? {}) as object),
    patch: (url, body) => withCsrf(agent.patch(url)).send((body ?? {}) as object),
    put: (url, body) => withCsrf(agent.put(url)).send((body ?? {}) as object),
    del: (url) => withCsrf(agent.delete(url)),
  };
}

async function admit(course: string, email?: string) {
  phone += 1;
  return (await owner.post('/api/v1/admissions', { courseId: course, admissionDate: start, listFeeMinor: 1_000_000, newStudent: { fullName: `Campus Student ${phone}`, phone: String(phone), ...(email && { email }) } }).expect(201)).body.data as { id: string; studentId: string };
}

beforeAll(async () => {
  app = await bootstrap();
  today = instituteToday();
  start = addDays(today, -30);
  owner = await ownerClient(app);
  courseId = (await owner.post('/api/v1/courses', { code: 'CMP-1', name: 'Campus Course', standardFeeMinor: 1_000_000, placementTrack: 'technical' }).expect(201)).body.data.id;
  otherCourseId = (await owner.post('/api/v1/courses', { code: 'CMP-2', name: 'Other Course', standardFeeMinor: 1_000_000 }).expect(201)).body.data.id;
  const trainers = (await owner.post('/api/v1/trainers', { name: 'Trainer Tara', email: 'tara@example.com' }).expect(201)).body.data as { id: string; name: string }[];
  trainerId = trainers.find((t) => t.name === 'Trainer Tara')!.id;
  batchId = (await owner.post('/api/v1/batches', { batchCode: 'CMP-B1', name: 'Campus Batch', courseId, trainerId, startDate: start, capacity: 10, status: 'running' }).expect(201)).body.data.id;
  otherBatchId = (await owner.post('/api/v1/batches', { batchCode: 'CMP-B2', name: 'Not Tara', courseId: otherCourseId, startDate: start, capacity: 10, status: 'running' }).expect(201)).body.data.id;

  const a = await admit(courseId, 'campus.student@example.com');
  admissionId = a.id;
  studentId = a.studentId;
  classmateAdmissionId = (await admit(courseId)).id;
  await owner.post('/api/v1/batch-assignments', { batchId, admissionIds: [admissionId, classmateAdmissionId], assignedOn: start }).expect(201);

  await owner.post(`/api/v1/portal-access/trainers/${trainerId}`, { temporaryPassword: 'Temp-Pass-2026' }).expect(201);
  faculty = await loginWithTemp('tara@example.com', 'Temp-Pass-2026');
  await owner.post(`/api/v1/portal-access/students/${studentId}`, { temporaryPassword: 'Temp-Pass-2026' }).expect(201);
  student = await loginWithTemp('campus.student@example.com', 'Temp-Pass-2026');
});

describe('class schedule', () => {
  it('creates a weekly repeat, refuses clashes, and limits faculty to their batches', async () => {
    const monday = (() => {
      let d = addDays(today, 1);
      while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
      return d;
    })();
    const created = (
      await faculty.post('/api/v1/schedule', { batchId, title: 'SQL basics', startsAt: `${monday}T10:00:00+05:30`, durationMinutes: 90, repeat: { weekdays: [1, 3], until: addDays(monday, 13) } }).expect(201)
    ).body.data as { id: string; startsAt: string; date: string }[];
    expect(created).toHaveLength(4); // Mon, Wed, Mon, Wed
    expect(created[0]!.startsAt).toBe(new Date(`${monday}T10:00:00+05:30`).toISOString());
    expect(created.every((c) => new Date(c.startsAt).toISOString().endsWith('04:30:00.000Z'))).toBe(true);

    const clash = await owner.post('/api/v1/schedule', { batchId, title: 'Overlap', startsAt: `${monday}T11:00:00+05:30`, durationMinutes: 30 }).expect(409);
    expect(clash.body.error.code).toBe('SCHEDULE_CLASH');

    // Not Tara's batch: invisible and unschedulable.
    await faculty.post('/api/v1/schedule', { batchId: otherBatchId, title: 'Nope', startsAt: `${monday}T15:00:00+05:30` }).expect(404);
    const list = (await faculty.get(`/api/v1/schedule?from=${today}&to=${addDays(today, 30)}`).expect(200)).body.data as { batchId: string }[];
    expect(list.every((c) => c.batchId === batchId)).toBe(true);

    const cancelled = (await faculty.post(`/api/v1/schedule/${created[0]!.id}/status`, { status: 'cancelled', cancelReason: 'Trainer unwell' }).expect(200)).body.data;
    expect(cancelled.status).toBe('cancelled');
    const inbox = (await student.get('/api/v1/notifications').expect(200)).body.data.items as { type: string }[];
    expect(inbox.some((n) => n.type === 'class_scheduled')).toBe(true);

    const mine = (await student.get('/api/v1/portal/classes').expect(200)).body.data as { batchId: string }[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((c) => c.batchId === batchId)).toBe(true);
  });
});

describe('attendance', () => {
  it('takes the register from the assignment history and computes percentages', async () => {
    const day1 = addDays(today, -2);
    const day2 = addDays(today, -1);
    const roster = (await faculty.get(`/api/v1/attendance/roster?batchId=${batchId}&date=${day1}`).expect(200)).body.data;
    expect(roster.rows.map((r: { admissionId: string }) => r.admissionId).sort()).toEqual([admissionId, classmateAdmissionId].sort());

    await faculty.post('/api/v1/attendance', { batchId, date: day1, topic: 'Joins', records: [{ admissionId, status: 'present' }, { admissionId: classmateAdmissionId, status: 'absent' }] }).expect(200);
    await faculty.post('/api/v1/attendance', { batchId, date: day2, records: [{ admissionId, status: 'late', minutesLate: 10 }, { admissionId: classmateAdmissionId, status: 'holiday' }] }).expect(200);
    // Re-saving a day updates it rather than duplicating it.
    await faculty.post('/api/v1/attendance', { batchId, date: day2, records: [{ admissionId, status: 'absent' }, { admissionId: classmateAdmissionId, status: 'holiday' }] }).expect(200);

    const summary = (await owner.get(`/api/v1/attendance/summary?batchId=${batchId}`).expect(200)).body.data as { admissionId: string; sessions: number; percent: number | null }[];
    const mine = summary.find((s) => s.admissionId === admissionId)!;
    expect(mine).toMatchObject({ sessions: 2, percent: 0.5 });
    // Holidays leave the denominator: 0 attended of 1 counted day.
    expect(summary.find((s) => s.admissionId === classmateAdmissionId)!.percent).toBe(0);

    await faculty.post('/api/v1/attendance', { batchId, date: addDays(today, 1), records: [{ admissionId, status: 'present' }] }).expect(422);
    const outsider = (await admit(courseId)).id;
    await faculty.post('/api/v1/attendance', { batchId, date: day1, records: [{ admissionId: outsider, status: 'present' }] }).expect(422);
    await faculty.get(`/api/v1/attendance/roster?batchId=${otherBatchId}&date=${day1}`).expect(404);

    const portal = (await student.get('/api/v1/portal/attendance').expect(200)).body.data as { summary: { percent: number | null }; days: unknown[] }[];
    expect(portal[0]!.summary.percent).toBe(0.5);
    expect(portal[0]!.days).toHaveLength(2);
  });
});

describe('exams', () => {
  let examId: string;

  it('builds a paper, refuses an invalid publish, and never shows students the answers', async () => {
    examId = (await faculty.post('/api/v1/exams', { title: 'Unit test 1', batchId, durationMinutes: 20, passPercent: 50, maxAttempts: 2, shuffleQuestions: false }).expect(201)).body.data.id;
    await faculty.post(`/api/v1/exams/${examId}/status`, { status: 'published' }).expect(422); // no questions
    await faculty.post(`/api/v1/exams/${examId}/questions`, { text: '2 + 2 = ?', marks: 2, options: [{ text: '3' }, { text: '4', isCorrect: true }] }).expect(201);
    await faculty.post(`/api/v1/exams/${examId}/questions`, { text: 'Capital of India?', marks: 3, options: [{ text: 'Delhi', isCorrect: true }, { text: 'Mumbai' }, { text: 'Chennai' }] }).expect(201);
    await faculty.post(`/api/v1/exams/${examId}/questions`, { text: 'Two answers', options: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: true }] }).expect(422);

    const published = (await faculty.post(`/api/v1/exams/${examId}/status`, { status: 'published' }).expect(200)).body.data;
    expect(published).toMatchObject({ status: 'published', totalMarks: 5, questionCount: 2 });
    await faculty.post(`/api/v1/exams/${examId}/questions`, { text: 'Late', options: [{ text: 'a', isCorrect: true }, { text: 'b' }] }).expect(409);

    const list = (await student.get('/api/v1/portal/exams').expect(200)).body.data as { id: string; blockedReason: string | null }[];
    expect(list.find((e) => e.id === examId)!.blockedReason).toBeNull();

    const paper = (await student.post(`/api/v1/portal/exams/${examId}/start`).expect(201)).body.data;
    expect(JSON.stringify(paper)).not.toContain('isCorrect');
    expect(paper.questions).toHaveLength(2);
  });

  it('grades on the server from saved answers and refuses tampering', async () => {
    const paper = (await student.post(`/api/v1/portal/exams/${examId}/start`).expect(201)).body.data; // resumes the open attempt
    const [q1, q2] = paper.questions as { id: string; text: string; options: { id: string; text: string }[] }[];
    const four = q1!.options.find((o) => o.text === '4')!;
    const mumbai = q2!.options.find((o) => o.text === 'Mumbai')!;
    // An option from another question is tampering.
    const tamper = await student.put(`/api/v1/portal/attempts/${paper.attemptId}/answers`, { questionId: q1!.id, optionId: mumbai.id }).expect(422);
    expect(tamper.body.error.code).toBe('INVALID_OPTION');
    await student.put(`/api/v1/portal/attempts/${paper.attemptId}/answers`, { questionId: q1!.id, optionId: four.id }).expect(200);
    await student.put(`/api/v1/portal/attempts/${paper.attemptId}/answers`, { questionId: q2!.id, optionId: mumbai.id }).expect(200);

    const result = (await student.post(`/api/v1/portal/attempts/${paper.attemptId}/submit`).expect(200)).body.data;
    expect(result).toMatchObject({ score: 2, totalMarks: 5, percentBps: 4000, passed: false, correct: 1, answered: 2 });
    await student.put(`/api/v1/portal/attempts/${paper.attemptId}/answers`, { questionId: q1!.id, optionId: four.id }).expect(409);

    // Second (last) attempt, then no more.
    const second = (await student.post(`/api/v1/portal/exams/${examId}/start`).expect(201)).body.data;
    expect(second.attemptId).not.toBe(paper.attemptId);
    await student.post(`/api/v1/portal/attempts/${second.attemptId}/submit`).expect(200);
    const blocked = await student.post(`/api/v1/portal/exams/${examId}/start`).expect(422);
    expect(blocked.body.error.code).toBe('NO_ATTEMPTS_LEFT');

    const results = (await faculty.get(`/api/v1/exams/${examId}/results`).expect(200)).body.data;
    expect(results).toHaveLength(2);
    await faculty.post(`/api/v1/exams/${examId}/status`, { status: 'draft' }).expect(409);
  });
});

describe('study material', () => {
  it('shares files with the course, logs every open, and hides unpublished items', async () => {
    const upload = (client: Client, fields: Record<string, string>, file?: { buf: Buffer; name: string }) => {
      const req = client.agent.post('/api/v1/materials').set('X-CSRF-Token', client.csrf);
      for (const [k, v] of Object.entries(fields)) req.field(k, v);
      return file ? req.attach('file', file.buf, file.name) : req;
    };
    const notes = (await upload(faculty, { title: 'Week 1 notes', courseId, kind: 'notes' }, { buf: Buffer.from('%PDF-1.4 notes'), name: 'week1.pdf' }).expect(201)).body.data;
    await upload(faculty, { title: 'Recording', courseId, batchId, kind: 'video', externalUrl: 'https://videos.example.com/w1' }).expect(201);
    await upload(faculty, { title: 'Bad link', courseId, kind: 'video', externalUrl: 'javascript:alert(1)' }).expect(422);
    await upload(faculty, { title: 'Hidden', courseId, kind: 'notes', isPublished: 'false', externalUrl: 'https://example.com/hidden' }).expect(201);
    await upload(faculty, { title: 'Wrong course', courseId: otherCourseId, kind: 'notes', externalUrl: 'https://example.com/x' }).expect(403);

    const visible = (await student.get('/api/v1/portal/materials').expect(200)).body.data as { id: string; title: string }[];
    expect(visible.map((m) => m.title).sort()).toEqual(['Recording', 'Week 1 notes']);
    const file = await student.agent.get(`/api/v1/portal/materials/${notes.id}/open`).expect(200);
    expect(file.headers['content-disposition']).toContain('week1.pdf');
    const opens = (await faculty.get(`/api/v1/materials/${notes.id}/opens`).expect(200)).body.data as { accountType: string }[];
    expect(opens).toHaveLength(1);
    expect(opens[0]!.accountType).toBe('student');
  });
});

describe('certificates', () => {
  it('issues only for completed courses, with a verifiable reference and PDF', async () => {
    const early = await student.post('/api/v1/portal/certificates', { admissionId }).expect(422);
    expect(early.body.error.code).toBe('NOT_COMPLETED');

    await owner.post(`/api/v1/admissions/${admissionId}/status`, { action: 'activate', date: start }).catch(() => undefined);
    await owner.post(`/api/v1/admissions/${admissionId}/status`, { action: 'complete', date: today }).expect(200);
    const cert = (await student.post('/api/v1/portal/certificates', { admissionId, requestNote: 'For my job' }).expect(201)).body.data;
    await student.post('/api/v1/portal/certificates', { admissionId }).expect(409);

    const issued = (await owner.post(`/api/v1/certificates/${cert.id}/decision`, { status: 'issued' }).expect(200)).body.data;
    expect(issued.referenceNumber).toMatch(/^CERT-\d{4}-\d{5}$/);
    const pdf = await student.agent.get(`/api/v1/portal/certificates/${cert.id}/file`).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    await owner.post(`/api/v1/certificates/${cert.id}/decision`, { status: 'rejected', reviewNote: 'x' }).expect(409);

    const verified = (await request(app).get(`/api/v1/verify/certificates/${issued.referenceNumber}`).expect(200)).body.data;
    expect(verified).toMatchObject({ valid: true, studentName: expect.stringContaining('Campus Student'), courseName: 'Campus Course' });
    expect((await request(app).get('/api/v1/verify/certificates/CERT-1999-00001').expect(200)).body.data.valid).toBe(false);
  });
});

describe('placement drives', () => {
  it('lets eligible students apply once, from the portal or added by staff', async () => {
    const profiles = (await owner.get(`/api/v1/placements/profiles?studentId=${studentId}`).expect(200)).body.data.items as { id: string; track: string }[];
    expect(profiles[0]?.track).toBe('technical'); // opened when the course was completed
    const drive = (await owner.post('/api/v1/drives', { companyName: 'Drive Corp', roleTitle: 'Junior Analyst', track: 'technical', status: 'open', driveDate: addDays(today, 10), applyBy: addDays(today, 5), packageMinor: 40_000_000, openings: 3, batchIds: [batchId] }).expect(201)).body.data;

    const portal = (await student.get('/api/v1/portal/placements').expect(200)).body.data;
    expect(portal.drives.find((d: { id: string }) => d.id === drive.id)).toMatchObject({ canApply: true, applied: false });
    await student.post(`/api/v1/drives/${drive.id}/apply`).expect(403); // back-office route
    await student.post(`/api/v1/portal/drives/${drive.id}/apply`).expect(201);
    await student.post(`/api/v1/portal/drives/${drive.id}/apply`).expect(409);

    const added = (await owner.post(`/api/v1/drives/${drive.id}/applicants`, { profileIds: [profiles[0]!.id] }).expect(200)).body.data;
    expect(added).toMatchObject({ added: 0, skipped: [{ reason: 'Already applied' }] });
    const applicants = (await owner.get(`/api/v1/drives/${drive.id}/applicants`).expect(200)).body.data;
    expect(applicants).toHaveLength(1);
    expect((await owner.get(`/api/v1/drives/${drive.id}`).expect(200)).body.data.applicants).toBe(1);
  });
});

describe('leave, tasks and inventory', () => {
  it('handles leave requests with overlap checks and approval by someone else', async () => {
    const leave = (await faculty.post('/api/v1/leave', { type: 'sick', startDate: addDays(today, 3), endDate: addDays(today, 4), reason: 'Fever' }).expect(201)).body.data;
    expect(leave.dayCount).toBe(2);
    await faculty.post('/api/v1/leave', { type: 'casual', startDate: addDays(today, 4), endDate: addDays(today, 6) }).expect(409);
    await faculty.get('/api/v1/leave?scope=team').expect(403);
    const approver = await clientWith(app, { permissions: ['leave:approve'] });
    await approver.post(`/api/v1/leave/${leave.id}/decision`, { decision: 'reject' }).expect(422); // reason required
    const approved = (await approver.post(`/api/v1/leave/${leave.id}/decision`, { decision: 'approve' }).expect(200)).body.data;
    expect(approved.status).toBe('approved');
    const mine = (await approver.post('/api/v1/leave', { type: 'casual', startDate: addDays(today, 9), endDate: addDays(today, 9) }).expect(201)).body.data;
    await approver.post(`/api/v1/leave/${mine.id}/decision`, { decision: 'approve' }).expect(403);
  });

  it('keeps tasks private unless assigned, and only assigners hand out work', async () => {
    const mine = (await faculty.post('/api/v1/tasks', { title: 'Prepare slides', priority: 'high', dueDate: addDays(today, -1), batchId }).expect(201)).body.data;
    expect(mine).toMatchObject({ assignedToId: faculty.user.id, isOverdue: true });
    await faculty.post('/api/v1/tasks', { title: 'For the owner', assignedToId: owner.user.id }).expect(403);
    const given = (await owner.post('/api/v1/tasks', { title: 'Grade unit test', assignedToId: faculty.user.id }).expect(201)).body.data;
    const list = (await faculty.get('/api/v1/tasks').expect(200)).body.data.items as { id: string }[];
    expect(list.map((t) => t.id)).toEqual(expect.arrayContaining([mine.id, given.id]));
    const done = (await faculty.post(`/api/v1/tasks/${given.id}/status`, { status: 'done' }).expect(200)).body.data;
    expect(done.completedAt).not.toBeNull();
    await faculty.put(`/api/v1/tasks/${given.id}`, { title: 'Changed' }).expect(403);
    const stranger = await clientWith(app, { permissions: ['leads:read'] });
    await stranger.post(`/api/v1/tasks/${given.id}/status`, { status: 'todo' }).expect(404);

    // The daily sweep reminds the assignee about the overdue task, once a day.
    const first = runNotificationSweep();
    const again = runNotificationSweep();
    expect(first.created).toBeGreaterThan(again.created);
    const inbox = (await faculty.get('/api/v1/notifications').expect(200)).body.data.items as { type: string; title: string; link: string }[];
    const reminders = inbox.filter((x) => x.type === 'task_due');
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ title: 'Tasks: 1 overdue', link: '/tasks?overdue=true' });
  });

  it('lends assets from stock, takes them back, and never goes negative', async () => {
    const keeper = await clientWith(app, { permissions: ['inventory:read', 'inventory:write', 'inventory:approve'] });
    const laptop = (await keeper.post('/api/v1/inventory/items', { assetTag: 'lt-001', name: 'Laptop', category: 'laptop', quantityTotal: 2, unitValueMinor: 5_000_000 }).expect(201)).body.data;
    const paper = (await keeper.post('/api/v1/inventory/items', { assetTag: 'PPR-1', name: 'Paper ream', category: 'consumable', quantityTotal: 10, isConsumable: true }).expect(201)).body.data;
    await keeper.post('/api/v1/inventory/items', { assetTag: 'LT-001', name: 'Dup', quantityTotal: 1 }).expect(409);

    const r1 = (await faculty.post('/api/v1/inventory/requests', { itemId: laptop.id, quantity: 2 }).expect(201)).body.data;
    const r2 = (await faculty.post('/api/v1/inventory/requests', { itemId: laptop.id, quantity: 1 }).expect(201)).body.data;
    await faculty.post(`/api/v1/inventory/requests/${r1.id}/decision`, { action: 'issue' }).expect(403);
    await keeper.post(`/api/v1/inventory/requests/${r1.id}/decision`, { action: 'issue' }).expect(200);
    const short = await keeper.post(`/api/v1/inventory/requests/${r2.id}/decision`, { action: 'issue' }).expect(422);
    expect(short.body.error.code).toBe('NOT_ENOUGH_STOCK');
    await keeper.put(`/api/v1/inventory/items/${laptop.id}`, { assetTag: 'LT-001', name: 'Laptop', quantityTotal: 1 }).expect(422); // 2 are lent out

    await keeper.post(`/api/v1/inventory/requests/${r1.id}/decision`, { action: 'return' }).expect(200);
    await keeper.post(`/api/v1/inventory/requests/${r2.id}/decision`, { action: 'issue' }).expect(200);
    const after = (await keeper.get('/api/v1/inventory/items?q=Laptop').expect(200)).body.data.items[0];
    expect(after).toMatchObject({ quantityTotal: 2, quantityAvailable: 1, quantityIssued: 1 });

    const used = (await faculty.post('/api/v1/inventory/requests', { itemId: paper.id, quantity: 3 }).expect(201)).body.data;
    const consumed = (await keeper.post(`/api/v1/inventory/requests/${used.id}/decision`, { action: 'issue' }).expect(200)).body.data;
    expect(consumed.status).toBe('returned'); // consumables are used up, not lent
    const stock = (await keeper.get('/api/v1/inventory/items?q=Paper').expect(200)).body.data.items[0];
    expect(stock).toMatchObject({ quantityTotal: 7, quantityAvailable: 7 });
    await faculty.get('/api/v1/inventory/items').expect(403);
    await faculty.get('/api/v1/inventory/items?available=true').expect(200);
  });
});

describe('walls', () => {
  it('keeps faculty out of office data and students out of the back office', async () => {
    await faculty.get('/api/v1/payments').expect(403);
    await faculty.get('/api/v1/batches/queue').expect(403);
    const batches = (await faculty.get('/api/v1/batches').expect(200)).body.data.items as { id: string }[];
    expect(batches.map((b) => b.id)).toEqual([batchId]);
    await faculty.get(`/api/v1/batches/${otherBatchId}`).expect(404);
    await faculty.get('/api/v1/portal/overview').expect(403);

    for (const path of ['/api/v1/exams', '/api/v1/schedule?from=2026-01-01&to=2026-01-31', '/api/v1/materials', '/api/v1/leave', '/api/v1/tasks']) {
      expect((await student.get(path)).status, path).toBe(403);
    }
    const overview = (await student.get('/api/v1/portal/overview').expect(200)).body.data;
    expect(overview.student.id).toBe(studentId);
    expect(overview.admissions[0]).toMatchObject({ id: admissionId, outstandingMinor: 1_000_000 });
    const fees = (await student.get('/api/v1/portal/fees').expect(200)).body.data;
    expect(fees.admissions).toHaveLength(1);
  });

  it('serves a receipt only to the student it belongs to', async () => {
    const paid = (await owner.post('/api/v1/payments', { admissionId, paymentDate: today, amountMinor: 100_000, method: 'upi' }).expect(201)).body.data;
    const paymentId = paid.payment?.id ?? paid.id;
    const pdf = await student.agent.get(`/api/v1/portal/receipts/${paymentId}`).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const theirs = (await owner.post('/api/v1/payments', { admissionId: classmateAdmissionId, paymentDate: today, amountMinor: 100_000, method: 'upi' }).expect(201)).body.data;
    await student.agent.get(`/api/v1/portal/receipts/${theirs.payment?.id ?? theirs.id}`).expect(404);
  });
});
