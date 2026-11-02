/**
 * Lead CRM: capture, duplicate warnings, pipeline rules, activity timeline,
 * follow-ups, bulk assignment permissions, Kanban board and global search.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { instituteToday } from '../src/server/services/clock';
import { addDays } from '@ims/shared';
import { bootstrap, clientWith, ownerClient, type Client } from './support';

let app: Awaited<ReturnType<typeof bootstrap>>;
let owner: Client;
let sourceId: string;

beforeAll(async () => {
  app = await bootstrap();
  owner = await ownerClient(app);
  sourceId = (await owner.get('/api/v1/settings/lead-sources').expect(200)).body.data[0].id;
});

async function newLead(overrides: Record<string, unknown> = {}) {
  const n = Math.floor(Math.random() * 9_000_000) + 1_000_000;
  const res = await owner
    .post('/api/v1/leads', { name: `Lead ${n}`, phone: `97${n}1`.slice(0, 10), enquiryDate: '2026-10-05', leadSourceId: sourceId, ...overrides })
    .expect(201);
  return res.body.data;
}

describe('capture', () => {
  it('assigns a lead code and normalises the phone', async () => {
    const lead = await newLead({ phone: '+91 99887 66554' });
    expect(lead.leadCode).toMatch(/^LEAD-2026-\d{5}$/);
    expect(lead.status).toBe('new');
    expect(lead.sourceName).toBeTruthy();
  });

  it('requires a traceable source', async () => {
    const res = await owner.post('/api/v1/leads', { name: 'No Source', phone: '9000000001', enquiryDate: '2026-10-05' }).expect(422);
    expect(res.body.error.fields.map((f: { path: string }) => f.path)).toContain('leadSourceId');
  });

  it('warns about duplicates across formatting differences', async () => {
    await newLead({ phone: '+91 98765-43210', email: 'Asha@Example.com' });
    const byPhone = await owner.get('/api/v1/leads/duplicates?phone=9876543210').expect(200);
    expect(byPhone.body.data[0]).toMatchObject({ kind: 'lead', matchedOn: ['phone'] });
    const byEmail = await owner.get('/api/v1/leads/duplicates?email=asha@example.com').expect(200);
    expect(byEmail.body.data[0].matchedOn).toContain('email');
  });
});

describe('pipeline', () => {
  it('requires a reason to mark a lead lost, and records the move', async () => {
    const lead = await newLead();
    await owner.post(`/api/v1/leads/${lead.id}/status`, { status: 'lost' }).expect(422);
    const res = await owner.post(`/api/v1/leads/${lead.id}/status`, { status: 'lost', lostReason: 'Chose another institute' }).expect(200);
    expect(res.body.data).toMatchObject({ status: 'lost', lostReason: 'Chose another institute' });
    expect(res.body.data.activities[0]).toMatchObject({ type: 'status_change', fromStatus: 'new', toStatus: 'lost' });
  });

  it('does not allow "converted" to be set by hand', async () => {
    const lead = await newLead();
    await owner.post(`/api/v1/leads/${lead.id}/status`, { status: 'converted' }).expect(422);
  });

  it('moves a new lead to contacted when a call is logged', async () => {
    const lead = await newLead();
    const res = await owner.post(`/api/v1/leads/${lead.id}/activities`, { type: 'call', note: 'Discussed batch timings', followUpDate: '2026-10-12' }).expect(200);
    expect(res.body.data.status).toBe('contacted');
    expect(res.body.data.followUpDate).toBe('2026-10-12');
    expect(res.body.data.activities.map((a: { type: string }) => a.type)).toEqual(expect.arrayContaining(['call', 'status_change', 'follow_up_set']));
  });

  it('lists overdue follow-ups for open leads only', async () => {
    const yesterday = addDays(instituteToday(), -1);
    const overdue = await newLead({ followUpDate: yesterday });
    const closed = await newLead({ followUpDate: yesterday });
    await owner.post(`/api/v1/leads/${closed.id}/status`, { status: 'unreachable' }).expect(200);

    const res = await owner.get('/api/v1/leads?followUp=overdue&limit=100').expect(200);
    const ids = res.body.data.items.map((l: { id: string }) => l.id);
    expect(ids).toContain(overdue.id);
    expect(ids).not.toContain(closed.id);
  });

  it('builds a Kanban board covering every status', async () => {
    const res = await owner.get('/api/v1/leads/board').expect(200);
    expect(res.body.data.map((c: { status: string }) => c.status)).toContain('new');
    expect(res.body.data).toHaveLength(9);
    const total = res.body.data.reduce((sum: number, c: { total: number }) => sum + c.total, 0);
    const list = await owner.get('/api/v1/leads?limit=1').expect(200);
    expect(total).toBe(list.body.data.total);
  });
});

describe('assignment', () => {
  it('needs leads:assign for bulk assignment', async () => {
    const staff = await clientWith(app, { permissions: ['leads:read', 'leads:write'] });
    const lead = await newLead();
    await staff.post('/api/v1/leads/assign', { leadIds: [lead.id], counsellorId: staff.user.id }).expect(403);
  });

  it('assigns many leads and logs each on its timeline', async () => {
    const counsellor = await clientWith(app, { permissions: ['leads:read'] });
    const a = await newLead();
    const b = await newLead();
    await owner.post('/api/v1/leads/assign', { leadIds: [a.id, b.id], counsellorId: counsellor.user.id }).expect(200);
    const mine = await owner.get(`/api/v1/leads?counsellorId=${counsellor.user.id}`).expect(200);
    expect(mine.body.data.total).toBe(2);
    const detail = await owner.get(`/api/v1/leads/${a.id}`).expect(200);
    expect(detail.body.data.activities[0].type).toBe('assignment');
  });
});

describe('global search', () => {
  it('finds leads by phone digits and hides types the caller cannot read', async () => {
    const lead = await newLead({ name: 'Searchable Person', phone: '+91 91234 56789' });
    const res = await owner.get('/api/v1/search?q=91234').expect(200);
    expect(res.body.data.some((h: { id: string }) => h.id === lead.id)).toBe(true);

    const coursesOnly = await clientWith(app, { permissions: ['courses:read'] });
    const limited = await coursesOnly.get('/api/v1/search?q=Searchable').expect(200);
    expect(limited.body.data).toEqual([]);
  });
});
