/**
 * Reporting accuracy: date boundaries, the institute time zone, course /
 * source / counsellor filters, monthly totals, historical (as-of)
 * outstanding, refunds and reversals, and no double counting.
 *
 * Fixture (all 2026, money in paise):
 *   Leads  L4 28 Feb (src1) | L1 10 Mar (src1, course A, counsellor C)
 *          L2 31 Mar (src2, course B) | L3 1 Apr (src1, course A)
 *   A1  20 Mar  course A  ₹50,000  from L1, counsellor C, no plan
 *       receipts 20 Mar ₹20,000 · 31 Mar ₹10,000 · 1 Apr ₹5,000
 *       refund 5 Apr ₹2,000 · discount ₹1,000 effective 10 Apr
 *   A2   2 Apr  course B  ₹30,000  from L2, plan: ₹10,000 due 2 Apr,
 *       ₹10,000 due 15 Apr, ₹10,000 due 15 May; one ₹30,000 receipt REVERSED
 *   A3  15 Mar  course B  ₹40,000  direct, cancelled on 10 Apr
 *   Expenses 31 Mar ₹1,000 · 1 Apr ₹500
 */

import type { ReportDataset } from '@ims/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildReport } from '../src/modules/reports/reports.service';
import { bootstrap, clientWith, ownerClient, type Client } from './support';

let app: Awaited<ReturnType<typeof bootstrap>>;
let owner: Client;
let courseA: string;
let courseB: string;
let src1: string;
let src2: string;
let counsellorId: string;
let phone = 9_300_000_000;

const nextPhone = () => String((phone += 1));

async function lead(enquiryDate: string, leadSourceId: string, extra: Record<string, unknown> = {}) {
  return (await owner.post('/api/v1/leads', { name: `Lead ${enquiryDate}`, phone: nextPhone(), enquiryDate, leadSourceId, ...extra }).expect(201)).body.data as { id: string };
}

async function admit(body: Record<string, unknown>) {
  return (await owner.post('/api/v1/admissions', { newStudent: { fullName: `Student ${phone}`, phone: nextPhone() }, ...body }).expect(201)).body.data as { id: string };
}

async function pay(admissionId: string, paymentDate: string, amountMinor: number) {
  return (await owner.post('/api/v1/payments', { admissionId, paymentDate, amountMinor, method: 'upi' }).expect(201)).body.data as { id: string };
}

async function summary(query: string): Promise<ReportDataset> {
  return (await owner.get(`/api/v1/reports/summary?${query}`).expect(200)).body.data as ReportDataset;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

beforeAll(async () => {
  app = await bootstrap();
  owner = await ownerClient(app);
  courseA = (await owner.post('/api/v1/courses', { code: 'RPT-A', name: 'Report Course A', standardFeeMinor: 5_000_000 }).expect(201)).body.data.id;
  courseB = (await owner.post('/api/v1/courses', { code: 'RPT-B', name: 'Report Course B', standardFeeMinor: 3_000_000 }).expect(201)).body.data.id;
  const sources = (await owner.get('/api/v1/settings/lead-sources').expect(200)).body.data as { id: string }[];
  src1 = sources[0]!.id;
  src2 = sources[1]!.id;
  const counsellor = await clientWith(app, { permissions: ['leads:read'], name: 'Counsellor C' });
  counsellorId = counsellor.user.id;
  const categoryId = (await owner.get('/api/v1/settings/expense-categories').expect(200)).body.data[0].id as string;

  await lead('2026-02-28', src1);
  const l1 = await lead('2026-03-10', src1, { interestedCourseId: courseA, counsellorId });
  const l2 = await lead('2026-03-31', src2, { interestedCourseId: courseB });
  await lead('2026-04-01', src1, { interestedCourseId: courseA });

  const a1 = await admit({ leadId: l1.id, courseId: courseA, admissionDate: '2026-03-20', listFeeMinor: 5_000_000, counsellorId });
  const first = await pay(a1.id, '2026-03-20', 2_000_000);
  await pay(a1.id, '2026-03-31', 1_000_000);
  await pay(a1.id, '2026-04-01', 500_000);
  await owner.post(`/api/v1/admissions/${a1.id}/refunds`, { amountMinor: 200_000, paymentDate: '2026-04-05', method: 'upi', reason: 'Partial refund', refundOfId: first.id }).expect(201);
  await owner.post(`/api/v1/admissions/${a1.id}/adjustments`, { type: 'discount', amountMinor: 100_000, effectiveDate: '2026-04-10', reason: 'Scholarship' }).expect(201);

  const a2 = await admit({
    leadId: l2.id,
    courseId: courseB,
    admissionDate: '2026-04-02',
    listFeeMinor: 3_000_000,
    admissionFeeRequiredMinor: 1_000_000,
    feePlan: { planType: 'admission_plus_monthly', startDate: '2026-04-02', instalmentCount: 2, firstDueDate: '2026-04-15' },
  });
  const bounced = await pay(a2.id, '2026-04-02', 3_000_000);
  await owner.post(`/api/v1/payments/${bounced.id}/reverse`, { reason: 'Cheque bounced' }).expect(200);

  const a3 = await admit({ courseId: courseB, admissionDate: '2026-03-15', listFeeMinor: 4_000_000 });
  await owner.post(`/api/v1/admissions/${a3.id}/status`, { action: 'cancel', date: '2026-04-10', reason: 'Changed plans' }).expect(200);

  await owner.post('/api/v1/expenses', { expenseDate: '2026-03-31', categoryId, description: 'Internet', amountMinor: 100_000, paymentMethod: 'cash' }).expect(201);
  await owner.post('/api/v1/expenses', { expenseDate: '2026-04-01', categoryId, description: 'Stationery', amountMinor: 50_000, paymentMethod: 'cash' }).expect(201);
});

describe('period boundaries', () => {
  it('monthly: March counts 31 Mar and excludes 1 Apr', async () => {
    const r = await summary('type=monthly&reference=2026-03-15');
    expect(r.range).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(r.previous).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(r.summary.leads.current).toBe(2); // L1, L2 -- not L4 (Feb) or L3 (Apr)
    expect(r.summary.leads.previous).toBe(1); // L4
    expect(r.summary.admissions.current).toBe(1); // A1; A3 is cancelled
    const f = r.summary.finance!;
    expect(f.collectedMinor.current).toBe(3_000_000);
    expect(f.refundedMinor.current).toBe(0);
    expect(f.expensesMinor!.current).toBe(100_000);
    expect(f.netCashFlowMinor!.current).toBe(2_900_000);
  });

  it('monthly: April nets the refund and ignores the reversed receipt', async () => {
    const r = await summary('type=monthly&reference=2026-04-30');
    const f = r.summary.finance!;
    expect(f.collectedMinor.current).toBe(500_000);
    expect(f.collectedMinor.previous).toBe(3_000_000);
    expect(f.refundedMinor.current).toBe(200_000);
    expect(f.netCollectedMinor.current).toBe(300_000);
    expect(f.receipts.current).toBe(1);
    expect(r.summary.admissions.current).toBe(1); // A2
    // Signed row list sums to the same net figure.
    expect(sum(r.paymentRows!.map((p) => p.amountMinor))).toBe(300_000);
    expect(r.paymentRows!.map((p) => p.direction)).toEqual(['in', 'refund']);
  });

  it('daily and weekly reports cut at calendar days', async () => {
    expect((await summary('type=daily&reference=2026-03-31')).summary.finance!.collectedMinor.current).toBe(1_000_000);
    expect((await summary('type=daily&reference=2026-04-01')).summary.finance!.collectedMinor.current).toBe(500_000);
    const week = await summary('type=weekly&reference=2026-04-01'); // Mon 30 Mar - Sun 5 Apr
    expect(week.range).toEqual({ from: '2026-03-30', to: '2026-04-05' });
    expect(week.summary.finance!.collectedMinor.current).toBe(1_500_000);
    expect(week.summary.finance!.refundedMinor.current).toBe(200_000);
    expect(week.summary.leads.current).toBe(2);
  });

  it('yearly: trend buckets add up to the summary', async () => {
    const r = await summary('type=yearly&reference=2026-06-01');
    expect(r.bucket).toBe('month');
    expect(r.trend).toHaveLength(12);
    expect(sum(r.trend.map((t) => t.leads))).toBe(r.summary.leads.current);
    expect(r.summary.leads.current).toBe(4);
    expect(sum(r.trend.map((t) => t.admissions))).toBe(2);
    expect(r.trend.find((t) => t.key === '2026-03')!.admissions).toBe(1);
    expect(sum(r.cashTrend!.map((t) => t.collectedMinor))).toBe(3_500_000);
    expect(sum(r.cashTrend!.map((t) => t.refundedMinor))).toBe(200_000);
    expect(r.cashTrend!.find((t) => t.key === '2026-03')!.collectedMinor).toBe(3_000_000);
  });

  it('rejects a reversed or incomplete custom range with 422', async () => {
    const reversed = await owner.get('/api/v1/reports/summary?period=custom&from=2026-05-01&to=2026-04-01').expect(422);
    expect(reversed.body.error.code).toBe('INVALID_DATE_RANGE');
    await owner.get('/api/v1/reports/summary?period=custom&from=2026-05-01').expect(422);
    await owner.get('/api/v1/reports/summary?type=monthly&reference=2026-02-30').expect(422);
  });
});

describe('institute time zone', () => {
  it('"this month" follows the clock in Asia/Kolkata, not UTC', async () => {
    // 18:00 UTC on 31 Mar is 23:30 IST -- still March.
    const late = await buildReport({ period: 'this_month' }, { includeFinance: true, now: new Date('2026-03-31T18:00:00Z') });
    expect(late.range).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(late.summary.finance!.collectedMinor.current).toBe(3_000_000);

    // 19:00 UTC on 31 Mar is 00:30 IST on 1 Apr -- a new month has begun.
    const early = await buildReport({ period: 'this_month' }, { includeFinance: true, now: new Date('2026-03-31T19:00:00Z') });
    expect(early.range).toEqual({ from: '2026-04-01', to: '2026-04-01' });
    expect(early.summary.finance!.collectedMinor.current).toBe(500_000);
    expect(early.asOf).toBe('2026-04-01');
  });
});

describe('historical outstanding', () => {
  it('is computed as of the period end', async () => {
    // 31 Mar: A1 owes 50,000 - 30,000; A3 was not cancelled until 10 Apr.
    const march = await summary('type=monthly&reference=2026-03-01');
    expect(march.asOf).toBe('2026-03-31');
    expect(march.summary.finance!.outstandingMinor).toBe(2_000_000 + 4_000_000);
    expect(march.summary.finance!.overdueMinor).toBe(0);

    // 30 Apr: A1 50,000 - 1,000 discount - (35,000 - 2,000) = 16,000;
    // A2 owes all 30,000 (receipt reversed); A3 cancelled.
    const april = await summary('type=monthly&reference=2026-04-01');
    expect(april.summary.finance!.outstandingMinor).toBe(1_600_000 + 3_000_000);
    // A2: ₹10,000 due 2 Apr + ₹10,000 due 15 Apr are overdue on 30 Apr.
    expect(april.summary.finance!.overdueMinor).toBe(2_000_000);
  });

  it('ages receivables and the buckets sum to outstanding', async () => {
    const april = await summary('type=monthly&reference=2026-04-01');
    const ageing = Object.fromEntries(april.ageing!.map((b) => [b.bucket, b.amountMinor]));
    expect(ageing).toEqual({ not_due: 1_600_000 + 1_000_000, d1_30: 2_000_000, d31_60: 0, d61_90: 0, d90_plus: 0 });
    expect(sum(april.ageing!.map((b) => b.amountMinor))).toBe(april.summary.finance!.outstandingMinor);

    // A month later the 2 Apr instalment has crossed 30 days.
    const may = await summary('type=monthly&reference=2026-05-01');
    const mayAgeing = Object.fromEntries(may.ageing!.map((b) => [b.bucket, b.amountMinor]));
    expect(mayAgeing.d31_60).toBe(2_000_000);
    expect(mayAgeing.d1_30).toBe(1_000_000);
  });
});

describe('filters and attribution', () => {
  it('cohort conversion counts a lead only if converted by the period end', async () => {
    const march = await summary('type=monthly&reference=2026-03-01');
    expect(march.summary.convertedLeads.current).toBe(1); // L1; L2 converted on 2 Apr
    expect(march.summary.conversionRate.current).toBe(0.5);
    const custom = await summary('period=custom&from=2026-03-01&to=2026-04-30');
    expect(custom.summary.convertedLeads.current).toBe(2);
  });

  it('filters by source', async () => {
    const r = await summary(`type=monthly&reference=2026-03-01&leadSourceId=${src1}`);
    expect(r.filters.leadSourceId).toBe(src1);
    expect(r.filters.leadSourceName).toBeTruthy();
    expect(r.summary.leads.current).toBe(1);
    expect(r.summary.admissions.current).toBe(1);
    expect(r.summary.finance!.collectedMinor.current).toBe(3_000_000);
    // Expenses are not tied to a source, so they are withheld rather than misattributed.
    expect(r.summary.finance!.expensesMinor).toBeNull();
    expect(r.summary.finance!.netCashFlowMinor).toBeNull();
    expect(r.expenseRows).toBeNull();
  });

  it('filters by course', async () => {
    const r = await summary(`type=monthly&reference=2026-04-01&courseId=${courseB}`);
    expect(r.summary.leads.current).toBe(0);
    expect(r.summary.admissions.current).toBe(1); // A2
    expect(r.summary.finance!.collectedMinor.current).toBe(0); // reversed
    expect(r.summary.finance!.outstandingMinor).toBe(3_000_000);
    expect(r.admissionRows.map((a) => a.courseName)).toEqual(['Report Course B']);
  });

  it('filters by counsellor', async () => {
    const r = await summary(`type=monthly&reference=2026-03-01&counsellorId=${counsellorId}`);
    expect(r.summary.leads.current).toBe(1);
    expect(r.summary.admissions.current).toBe(1);
    expect(r.counsellors).toEqual([expect.objectContaining({ userId: counsellorId, name: 'Counsellor C', leads: 1, converted: 1, admissions: 1, collectedMinor: 3_000_000 })]);
  });

  it('never double counts an admission with many payments, refunds and adjustments', async () => {
    const r = await summary('period=custom&from=2026-03-01&to=2026-04-30');
    const a = r.courses.find((c) => c.courseId === courseA)!;
    expect(a.admissions).toBe(1);
    expect(a.agreedFeeMinor).toBe(5_000_000);
    expect(a.collectedMinor).toBe(3_500_000 - 200_000);
    expect(a.outstandingMinor).toBe(1_600_000);
    const s1 = r.sources.find((s) => s.leadSourceId === src1)!;
    expect(s1.admissions).toBe(1);
    expect(s1.leads).toBe(2); // L1, L3
    expect(sum(r.sources.map((s) => s.collectedMinor ?? 0))).toBe(r.summary.finance!.netCollectedMinor.current);
    expect(sum(r.courses.map((c) => c.admissions))).toBe(r.summary.admissions.current);
    expect(r.admissionRows).toHaveLength(2);
    const methods = r.paymentMethods!;
    expect(sum(methods.map((m) => m.amountMinor))).toBe(r.summary.finance!.collectedMinor.current);
  });
});

describe('access', () => {
  it('withholds money from viewers without reports:financial', async () => {
    const viewer = await clientWith(app, { permissions: ['reports:read'] });
    const r = (await viewer.get('/api/v1/reports/summary?type=monthly&reference=2026-03-01').expect(200)).body.data as ReportDataset;
    expect(r.includesFinance).toBe(false);
    expect(r.summary.finance).toBeNull();
    expect(r.cashTrend).toBeNull();
    expect(r.paymentRows).toBeNull();
    expect(r.ageing).toBeNull();
    expect(r.admissionRows[0]!.agreedFeeMinor).toBeNull();
    expect(r.sources.every((s) => s.collectedMinor === null)).toBe(true);
    expect(r.summary.admissions.current).toBe(1);

    const dash = (await viewer.get('/api/v1/reports/dashboard?period=this_year').expect(200)).body.data;
    expect(dash.live.overdueInstalments).toBeNull();
  });

  it('refuses users without reports:read', async () => {
    const other = await clientWith(app, { permissions: ['leads:read'] });
    await other.get('/api/v1/reports/summary?type=monthly&reference=2026-03-01').expect(403);
    await other.get('/api/v1/reports/dashboard').expect(403);
  });

  it('dashboard adds live counts, 12 months and batches without row lists', async () => {
    const d = (await owner.get('/api/v1/reports/dashboard?period=custom&from=2026-03-01&to=2026-04-30').expect(200)).body.data;
    expect(d.monthly).toHaveLength(12);
    expect(d.monthly.at(-1).month).toBe('2026-04');
    expect(d.monthly.find((m: { month: string }) => m.month === '2026-03').netCollectedMinor).toBe(3_000_000);
    expect(d.admissionRows).toEqual([]);
    expect(d.live.pendingPaymentAdmissions + d.live.activeStudents).toBeGreaterThanOrEqual(1);
    expect(d.live.unassignedStudents).toBe(2); // A1, A2 have no batch
    expect(Array.isArray(d.batches)).toBe(true);
  });
});
