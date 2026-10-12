/**
 * Expenses (void-not-delete, approval workflow, totals) and batches
 * (capacity, override, course matching, transfers, queue, lifecycle).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { bootstrap, clientWith, ownerClient, type Client } from './support';

let app: Awaited<ReturnType<typeof bootstrap>>;
let owner: Client;
let courseId: string;
let otherCourseId: string;
let categoryId: string;
let n = 0;

async function admission(course = courseId) {
  n += 1;
  return (
    await owner
      .post('/api/v1/admissions', {
        courseId: course,
        admissionDate: '2026-10-01',
        listFeeMinor: 100_000,
        admissionFeeRequiredMinor: 0,
        newStudent: { fullName: `Learner ${n}`, phone: `93000${String(n).padStart(5, '0')}` },
      })
      .expect(201)
  ).body.data as { id: string; admissionNumber: string };
}

async function batch(capacity: number, course = courseId, code = `B-${Math.random().toString(36).slice(2, 7).toUpperCase()}`) {
  return (await owner.post('/api/v1/batches', { batchCode: code, name: `Batch ${code}`, courseId: course, startDate: '2026-11-01', capacity, status: 'enrolling' }).expect(201)).body.data as {
    id: string;
    batchCode: string;
  };
}

beforeAll(async () => {
  app = await bootstrap();
  owner = await ownerClient(app);
  courseId = (await owner.post('/api/v1/courses', { code: 'WEB-01', name: 'Web Development', standardFeeMinor: 100_000 }).expect(201)).body.data.id;
  otherCourseId = (await owner.post('/api/v1/courses', { code: 'HR-01', name: 'HR Generalist', standardFeeMinor: 100_000 }).expect(201)).body.data.id;
  categoryId = (await owner.get('/api/v1/settings/expense-categories').expect(200)).body.data.find((c: { name: string }) => c.name === 'Rent').id;
});

describe('expenses', () => {
  it('records, edits with an audit trail, and voids instead of deleting', async () => {
    const created = await owner
      .post('/api/v1/expenses', { expenseDate: '2026-10-05', categoryId, description: 'October rent', amountMinor: 2_500_000, paymentMethod: 'bank_transfer', payee: 'Landlord' })
      .expect(201);
    expect(created.body.data).toMatchObject({ approvalStatus: 'recorded', categoryName: 'Rent' });
    expect(created.body.data.expenseCode).toMatch(/^EXP-2026-\d{5}$/);

    const id = created.body.data.id;
    await owner.put(`/api/v1/expenses/${id}`, { expenseDate: '2026-10-05', categoryId, description: 'October rent', amountMinor: 2_600_000, paymentMethod: 'bank_transfer' }).expect(200);
    const audit = await owner.get(`/api/v1/audit?entityId=${id}`).expect(200);
    expect(audit.body.data.items.some((e: { action: string; after: { amountMinor?: number } }) => e.action === 'update' && e.after?.amountMinor === 2_600_000)).toBe(true);

    await owner.post(`/api/v1/expenses/${id}/void`, { reason: 'Duplicate entry' }).expect(200);
    const visible = await owner.get('/api/v1/expenses').expect(200);
    expect(visible.body.data.items.some((e: { id: string }) => e.id === id)).toBe(false);
    const all = await owner.get('/api/v1/expenses?includeVoided=true').expect(200);
    expect(all.body.data.items.find((e: { id: string }) => e.id === id).voidReason).toBe('Duplicate entry');
    await owner.put(`/api/v1/expenses/${id}`, { expenseDate: '2026-10-05', categoryId, description: 'x', amountMinor: 1, paymentMethod: 'cash' }).expect(409);
  });

  it('excludes pending and rejected expenses from totals until approved', async () => {
    await owner.patch('/api/v1/settings', { expenseApprovalRequired: true }).expect(200);
    const pending = (await owner.post('/api/v1/expenses', { expenseDate: '2026-10-06', categoryId, description: 'Projector', amountMinor: 4_000_000, paymentMethod: 'upi' }).expect(201)).body.data;
    expect(pending.approvalStatus).toBe('pending');

    const before = (await owner.get('/api/v1/expenses?from=2026-10-06&to=2026-10-06').expect(200)).body.data.summary;
    expect(before).toMatchObject({ totalMinor: 0, pendingCount: 1, pendingMinor: 4_000_000 });

    const clerk = await clientWith(app, { permissions: ['expenses:read', 'expenses:write'] });
    await clerk.post(`/api/v1/expenses/${pending.id}/decision`, { decision: 'approve' }).expect(403);
    await owner.post(`/api/v1/expenses/${pending.id}/decision`, { decision: 'reject' }).expect(422);
    await owner.post(`/api/v1/expenses/${pending.id}/decision`, { decision: 'approve' }).expect(200);

    const after = (await owner.get('/api/v1/expenses?from=2026-10-06&to=2026-10-06').expect(200)).body.data.summary;
    expect(after.totalMinor).toBe(4_000_000);
    expect(after.byCategory[0]).toMatchObject({ categoryName: 'Rent', totalMinor: 4_000_000 });
    await owner.patch('/api/v1/settings', { expenseApprovalRequired: false }).expect(200);
  });
});

describe('batches', () => {
  it('refuses a full batch, and lets only the owner override it', async () => {
    const b = await batch(2);
    const [a1, a2, a3] = [await admission(), await admission(), await admission()];
    await owner.post('/api/v1/batch-assignments', { batchId: b.id, admissionIds: [a1.id, a2.id], assignedOn: '2026-10-10' }).expect(201);

    const full = await owner.post('/api/v1/batch-assignments', { batchId: b.id, admissionIds: [a3.id], assignedOn: '2026-10-10' }).expect(409);
    expect(full.body.error.code).toBe('BATCH_FULL');

    const staff = await clientWith(app, { permissions: ['batches:read', 'batches:assign'] });
    await staff.post('/api/v1/batch-assignments', { batchId: b.id, admissionIds: [a3.id], assignedOn: '2026-10-10', allowOverCapacity: true }).expect(409);

    const overridden = await owner.post('/api/v1/batch-assignments', { batchId: b.id, admissionIds: [a3.id], assignedOn: '2026-10-10', allowOverCapacity: true }).expect(201);
    expect(overridden.body.data.enrolled).toBe(3);
  });

  it('only accepts students of the batch course, and only once', async () => {
    const b = await batch(10);
    const other = await admission(otherCourseId);
    const res = await owner.post('/api/v1/batch-assignments', { batchId: b.id, admissionIds: [other.id], assignedOn: '2026-10-10' }).expect(422);
    expect(res.body.error.code).toBe('COURSE_MISMATCH');

    const a = await admission();
    await owner.post('/api/v1/batch-assignments', { batchId: b.id, admissionIds: [a.id], assignedOn: '2026-10-10' }).expect(201);
    const again = await owner.post('/api/v1/batch-assignments', { batchId: b.id, admissionIds: [a.id], assignedOn: '2026-10-10' }).expect(409);
    expect(again.body.error.code).toBe('ALREADY_ASSIGNED');
  });

  it('transfers between batches and keeps the history', async () => {
    const from = await batch(5);
    const to = await batch(5);
    const a = await admission();
    const roster = (await owner.post('/api/v1/batch-assignments', { batchId: from.id, admissionIds: [a.id], assignedOn: '2026-10-10' }).expect(201)).body.data.roster;
    const assignmentId = roster.find((r: { admissionId: string }) => r.admissionId === a.id).id;

    const moved = await owner.post(`/api/v1/batch-assignments/${assignmentId}/transfer`, { toBatchId: to.id, date: '2026-10-20', reason: 'Prefers evening slot' }).expect(200);
    expect(moved.body.data.roster.map((r: { admissionId: string }) => r.admissionId)).toContain(a.id);

    const history = (await owner.get(`/api/v1/batch-assignments?admissionIds=${a.id}`).expect(200)).body.data;
    expect(history.map((h: { status: string }) => h.status).sort()).toEqual(['active', 'transferred_out']);
    expect((await owner.get(`/api/v1/batches/${from.id}`).expect(200)).body.data.history[0]).toMatchObject({ status: 'transferred_out', endedOn: '2026-10-20' });
  });

  it('lists unassigned admissions in the queue with open batches', async () => {
    const b = await batch(4);
    const a = await admission();
    const queue = (await owner.get(`/api/v1/batches/queue?courseId=${courseId}&limit=100`).expect(200)).body.data.items;
    const item = queue.find((q: { admissionId: string }) => q.admissionId === a.id);
    expect(item.openBatches.some((ob: { id: string }) => ob.id === b.id)).toBe(true);

    await owner.post(`/api/v1/admissions/${a.id}/batch-status`, { batchStatus: 'waiting_for_next_batch' }).expect(200);
    const waiting = (await owner.get('/api/v1/batches/queue?batchStatus=waiting_for_next_batch').expect(200)).body.data.items;
    expect(waiting.some((q: { admissionId: string }) => q.admissionId === a.id)).toBe(true);

    await owner.post('/api/v1/batch-assignments', { batchId: b.id, admissionIds: [a.id], assignedOn: '2026-10-12' }).expect(201);
    const after = (await owner.get('/api/v1/batches/queue?limit=100').expect(200)).body.data.items;
    expect(after.some((q: { admissionId: string }) => q.admissionId === a.id)).toBe(false);
  });

  it('completes or drops assignments with the admission', async () => {
    const b = await batch(4);
    const done = await admission();
    const quit = await admission();
    await owner.post('/api/v1/batch-assignments', { batchId: b.id, admissionIds: [done.id, quit.id], assignedOn: '2026-10-10' }).expect(201);
    await owner.post(`/api/v1/admissions/${done.id}/status`, { action: 'complete', date: '2026-12-31' }).expect(200);
    await owner.post(`/api/v1/admissions/${quit.id}/status`, { action: 'withdraw', date: '2026-11-15', reason: 'Moved city' }).expect(200);
    const detail = (await owner.get(`/api/v1/batches/${b.id}`).expect(200)).body.data;
    expect(detail.enrolled).toBe(0);
    expect(detail.history.map((h: { status: string }) => h.status).sort()).toEqual(['completed', 'dropped']);
  });

  it('rejects a capacity below the current roster', async () => {
    const b = await batch(3);
    const [x, y] = [await admission(), await admission()];
    await owner.post('/api/v1/batch-assignments', { batchId: b.id, admissionIds: [x.id, y.id], assignedOn: '2026-10-10' }).expect(201);
    const res = await owner.put(`/api/v1/batches/${b.id}`, { batchCode: b.batchCode, name: 'Resized', courseId, startDate: '2026-11-01', capacity: 1, status: 'enrolling' }).expect(422);
    expect(res.body.error.fields[0].path).toBe('capacity');
  });
});
