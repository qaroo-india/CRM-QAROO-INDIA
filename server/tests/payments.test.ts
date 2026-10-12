/**
 * Fees, payments, instalments, refunds, reversals and loans -- the brief's
 * payment tests: full payment, partial payment, correct allocation,
 * outstanding fees, refunds and reversals, duplicate receipt prevention,
 * unauthorised modification -- plus schedule exactness, plan restructuring
 * and the loan rules (approval is never cash).
 */

import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { payments } from '../src/db/schema';
import { bootstrap, clientWith, ownerClient, type Client } from './support';

let app: Awaited<ReturnType<typeof bootstrap>>;
let owner: Client;
let courseId: string;
let counter = 0;

const DAY = '2026-10-01';

/** A fresh admission: ₹50,000 agreed, ₹10,000 admission fee, optional plan. */
async function admission(feePlan?: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  counter += 1;
  const res = await owner
    .post('/api/v1/admissions', {
      courseId,
      admissionDate: DAY,
      listFeeMinor: 5_000_000,
      discountMinor: 0,
      admissionFeeRequiredMinor: 1_000_000,
      newStudent: { fullName: `Payer ${counter}`, phone: `90000${String(counter).padStart(5, '0')}` },
      ...(feePlan && { feePlan }),
      ...overrides,
    })
    .expect(201);
  return res.body.data as { id: string; studentId: string; status: string };
}

const monthly = { planType: 'admission_plus_monthly', startDate: DAY, instalmentCount: 3, firstDueDate: '2026-11-01' };

async function finance(admissionId: string) {
  return (await owner.get(`/api/v1/admissions/${admissionId}/finance`).expect(200)).body.data;
}

function pay(admissionId: string, amountMinor: number, extra: Record<string, unknown> = {}) {
  return owner.post('/api/v1/payments', { admissionId, paymentDate: '2026-10-02', amountMinor, method: 'upi', ...extra });
}

beforeAll(async () => {
  app = await bootstrap();
  owner = await ownerClient(app);
  courseId = (await owner.post('/api/v1/courses', { code: 'DA-01', name: 'Data Analytics', standardFeeMinor: 5_000_000 }).expect(201)).body.data.id;
});

describe('fee plans', () => {
  it('builds a schedule that sums exactly, remainder on the first instalment', async () => {
    const a = await admission(monthly);
    const f = await finance(a.id);
    const rows = f.activePlan.instalments;
    expect(rows.map((r: { kind: string }) => r.kind)).toEqual(['admission_fee', 'instalment', 'instalment', 'instalment']);
    expect(rows.map((r: { amountMinor: number }) => r.amountMinor)).toEqual([1_000_000, 1_333_334, 1_333_333, 1_333_333]);
    expect(rows.map((r: { dueDate: string }) => r.dueDate)).toEqual([DAY, '2026-11-01', '2026-12-01', '2027-01-01']);
    expect(rows.reduce((s: number, r: { amountMinor: number }) => s + r.amountMinor, 0)).toBe(5_000_000);
  });

  it('rejects a flexible schedule that does not add up', async () => {
    const res = await owner
      .post('/api/v1/admissions', {
        courseId,
        admissionDate: DAY,
        listFeeMinor: 5_000_000,
        admissionFeeRequiredMinor: 1_000_000,
        newStudent: { fullName: 'Flexible', phone: '9100000001' },
        feePlan: { planType: 'admission_plus_flexible', startDate: DAY, schedule: [{ dueDate: '2026-11-01', amountMinor: 3_000_000 }] },
      })
      .expect(422);
    expect(res.body.error.fields[0].message).toMatch(/add up/);
  });

  it('refuses a second plan, but restructures the outstanding balance with history kept', async () => {
    const a = await admission(monthly);
    await pay(a.id, 1_500_000).expect(201); // admission fee + ₹5,000 of instalment 1
    await owner.post(`/api/v1/admissions/${a.id}/fee-plan`, monthly).expect(409);

    const restructured = await owner
      .post(`/api/v1/admissions/${a.id}/fee-plan/restructure`, { planType: 'admission_plus_monthly', startDate: '2026-10-05', instalmentCount: 2, firstDueDate: '2026-11-15' })
      .expect(200);
    expect(restructured.body.data.totalMinor).toBe(3_500_000);
    expect(restructured.body.data.instalments.map((r: { amountMinor: number }) => r.amountMinor)).toEqual([1_750_000, 1_750_000]);

    const f = await finance(a.id);
    expect(f.previousPlans).toHaveLength(1);
    expect(f.previousPlans[0].status).toBe('superseded');
    const old = f.previousPlans[0].instalments;
    expect(old[0]).toMatchObject({ status: 'paid' });
    expect(old.slice(1).every((r: { state: string }) => r.state === 'cancelled')).toBe(true);
    expect(f.admission.outstandingMinor).toBe(3_500_000);
  });
});

describe('recording payments', () => {
  it('records a full payment in one receipt', async () => {
    const a = await admission({ planType: 'full_payment', startDate: DAY });
    const res = await pay(a.id, 5_000_000, { method: 'bank_transfer', referenceNumber: 'NEFT-001' }).expect(201);
    expect(res.body.data).toMatchObject({ paymentType: 'full_payment', status: 'succeeded', direction: 'in' });
    expect(res.body.data.receiptNumber).toMatch(/^RCT-2026-\d{5}$/);
    const f = await finance(a.id);
    expect(f.admission).toMatchObject({ outstandingMinor: 0, paidMinor: 5_000_000, status: 'active' });
  });

  it('records a partial payment, allocated to the oldest unpaid instalments first', async () => {
    const a = await admission(monthly);
    const res = await pay(a.id, 1_500_000).expect(201);
    expect(res.body.data.allocations.map((x: { amountMinor: number }) => x.amountMinor)).toEqual([1_000_000, 500_000]);
    const rows = (await finance(a.id)).activePlan.instalments;
    expect(rows[0]).toMatchObject({ status: 'paid', remainingMinor: 0 });
    expect(rows[1]).toMatchObject({ status: 'partially_paid', paidMinor: 500_000, remainingMinor: 833_334 });
    expect(rows[2]).toMatchObject({ status: 'scheduled', paidMinor: 0 });
  });

  it('keeps an admission pending until the admission fee is fully covered', async () => {
    const a = await admission(monthly);
    await pay(a.id, 400_000).expect(201);
    expect((await finance(a.id)).admission.status).toBe('pending_payment');
    await pay(a.id, 600_000).expect(201);
    expect((await finance(a.id)).admission.status).toBe('active');
  });

  it('allocates manually when told to, and validates the split', async () => {
    const a = await admission(monthly);
    const rows = (await finance(a.id)).activePlan.instalments;
    const bad = await pay(a.id, 500_000, { allocations: [{ instalmentId: rows[1].id, amountMinor: 400_000 }] }).expect(422);
    expect(bad.body.error.fields[0].path).toBe('allocations');

    const early = await pay(a.id, 500_000, { allocations: [{ instalmentId: rows[3].id, amountMinor: 500_000 }] }).expect(201);
    expect(early.body.data.allocations[0].instalmentId).toBe(rows[3].id);
  });

  it('calculates outstanding fees from the ledger', async () => {
    const a = await admission(monthly);
    await pay(a.id, 1_000_000).expect(201);
    await pay(a.id, 250_050).expect(201);
    const f = await finance(a.id);
    expect(f.admission).toMatchObject({ agreedFeeMinor: 5_000_000, paidMinor: 1_250_050, outstandingMinor: 3_749_950 });
  });

  it('refuses an overpayment', async () => {
    const a = await admission(monthly);
    const res = await pay(a.id, 5_000_001).expect(422);
    expect(res.body.error.code).toBe('OVERPAYMENT');
  });

  it('requires a reference for cheques and transfers', async () => {
    const a = await admission(monthly);
    const res = await pay(a.id, 100, { method: 'cheque' }).expect(422);
    expect(res.body.error.fields[0].path).toBe('referenceNumber');
  });

  it('prevents duplicate receipts for a replayed request', async () => {
    const a = await admission(monthly);
    const key = 'receipt-key-0001-xyz';
    const first = await pay(a.id, 300_000).set('Idempotency-Key', key).expect(201);
    const replay = await pay(a.id, 300_000).set('Idempotency-Key', key).expect(200);
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(db.select().from(payments).where(eq(payments.idempotencyKey, key)).all()).toHaveLength(1);

    const reused = await pay(a.id, 999).set('Idempotency-Key', key).expect(409);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('refunds and reversals', () => {
  it('reverses a receipt with a reason, removing it from every total', async () => {
    const a = await admission(monthly);
    const receipt = (await pay(a.id, 1_000_000).expect(201)).body.data;
    await owner.post(`/api/v1/payments/${receipt.id}/reverse`, {}).expect(422);
    const reversed = await owner.post(`/api/v1/payments/${receipt.id}/reverse`, { reason: 'Wrong student selected' }).expect(200);
    expect(reversed.body.data).toMatchObject({ status: 'reversed', reversalReason: 'Wrong student selected' });

    const f = await finance(a.id);
    expect(f.admission.paidMinor).toBe(0);
    expect(f.admission.outstandingMinor).toBe(5_000_000);
    expect(f.activePlan.instalments[0].status).not.toBe('paid');
    // The record itself is kept for the audit trail.
    expect(f.payments.find((p: { id: string }) => p.id === receipt.id).status).toBe('reversed');

    await owner.post(`/api/v1/payments/${receipt.id}/reverse`, { reason: 'again' }).expect(409);
  });

  it('records refunds separately and never beyond what was received', async () => {
    const a = await admission(monthly);
    const receipt = (await pay(a.id, 1_000_000).expect(201)).body.data;

    const tooMuch = await owner
      .post(`/api/v1/admissions/${a.id}/refunds`, { amountMinor: 1_000_001, paymentDate: '2026-10-05', method: 'upi', reason: 'Overcharged' })
      .expect(422);
    expect(tooMuch.body.error.code).toBe('REFUND_EXCEEDS_RECEIVED');

    const refund = await owner
      .post(`/api/v1/admissions/${a.id}/refunds`, { amountMinor: 200_000, paymentDate: '2026-10-05', method: 'upi', reason: 'Fee concession after review', refundOfId: receipt.id })
      .expect(201);
    expect(refund.body.data).toMatchObject({ direction: 'refund', paymentType: 'refund' });
    expect(refund.body.data.receiptNumber).toMatch(/^RFD-2026-\d{5}$/);

    const f = await finance(a.id);
    expect(f.admission).toMatchObject({ paidMinor: 1_000_000, refundedMinor: 200_000, netPaidMinor: 800_000, outstandingMinor: 4_200_000 });

    const list = await owner.get(`/api/v1/payments?admissionId=${a.id}`).expect(200);
    expect(list.body.data.summary).toMatchObject({ grossMinor: 1_000_000, refundsMinor: 200_000, netMinor: 800_000 });

    // Reversing the receipt would leave a refund with nothing behind it.
    const blocked = await owner.post(`/api/v1/payments/${receipt.id}/reverse`, { reason: 'Mistake' }).expect(409);
    expect(blocked.body.error.code).toBe('REFUND_EXISTS');
  });

  it('blocks reversing a receipt whose money was refunded beyond what remains', async () => {
    const a = await admission(monthly);
    const receipt = (await pay(a.id, 500_000).expect(201)).body.data;
    await owner.post(`/api/v1/admissions/${a.id}/refunds`, { amountMinor: 500_000, paymentDate: '2026-10-06', method: 'cash', reason: 'Withdrew' }).expect(201);
    const res = await owner.post(`/api/v1/payments/${receipt.id}/reverse`, { reason: 'Entered twice' }).expect(409);
    expect(res.body.error.code).toBe('REFUND_EXISTS');
  });
});

describe('payment permissions', () => {
  it('lets a cashier record but not reverse or refund', async () => {
    const a = await admission(monthly);
    const cashier = await clientWith(app, { permissions: ['payments:read', 'payments:write'] });
    const receipt = await cashier.post('/api/v1/payments', { admissionId: a.id, paymentDate: '2026-10-02', amountMinor: 100_000, method: 'cash' }).expect(201);
    await cashier.post(`/api/v1/payments/${receipt.body.data.id}/reverse`, { reason: 'Trying' }).expect(403);
    await cashier.post(`/api/v1/admissions/${a.id}/refunds`, { amountMinor: 1, paymentDate: '2026-10-02', method: 'cash', reason: 'Trying' }).expect(403);
  });

  it('hides payments from staff without payments:read', async () => {
    const staff = await clientWith(app, { permissions: ['leads:read'] });
    await staff.get('/api/v1/payments').expect(403);
  });
});

describe('receipts', () => {
  it('renders a PDF receipt with the balance after payment', async () => {
    const a = await admission(monthly);
    const receipt = (await pay(a.id, 1_250_000).expect(201)).body.data;
    const json = await owner.get(`/api/v1/payments/${receipt.id}/receipt`).expect(200);
    expect(json.body.data).toMatchObject({ agreedFeeMinor: 5_000_000, totalReceivedMinor: 1_250_000, balanceAfterMinor: 3_750_000 });
    expect(json.body.data.amountInWords).toBe('Rupees Twelve Thousand Five Hundred Only');

    const pdf = await owner.get(`/api/v1/payments/${receipt.id}/receipt.pdf`).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const body = pdf.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(body.length).toBeGreaterThan(5_000);
  });
});

describe('instalment book', () => {
  it('lists overdue instalments with their remaining balance', async () => {
    const a = await admission({ planType: 'admission_plus_monthly', startDate: DAY, instalmentCount: 2, firstDueDate: '2026-10-05' });
    await pay(a.id, 1_000_000).expect(201);
    const res = await owner.get(`/api/v1/instalments?view=overdue&admissionId=${a.id}`).expect(200);
    // Admission fee is paid; both instalments (Oct and Nov 2026) are past due relative to the real clock only if today is later --
    // assert consistency rather than a calendar-dependent count.
    for (const row of res.body.data.items) {
      expect(row.status).toBe('overdue');
      expect(row.remainingMinor).toBeGreaterThan(0);
    }
    const open = await owner.get(`/api/v1/instalments?view=all_open&admissionId=${a.id}`).expect(200);
    expect(open.body.data.summary.remainingMinor).toBe(4_000_000);
  });
});

describe('loans', () => {
  it('never counts an approved loan as cash, and counts a received disbursement exactly once', async () => {
    const a = await admission({ planType: 'external_financing', startDate: DAY, expectedDisbursementDate: '2026-10-20' });
    await pay(a.id, 1_000_000).expect(201);
    const loan = (await owner.post('/api/v1/loans', { admissionId: a.id, financeType: 'external_loan', providerName: 'EduFin Bank', requestedMinor: 4_000_000 }).expect(201)).body.data;

    await owner.post(`/api/v1/loans/${loan.id}/status`, { status: 'applied', date: '2026-10-03' }).expect(200);
    const approved = await owner.post(`/api/v1/loans/${loan.id}/status`, { status: 'approved', date: '2026-10-10', approvedMinor: 4_000_000 }).expect(200);
    expect(approved.body.data).toMatchObject({ status: 'approved', receivedMinor: 0, disbursementStatus: 'awaiting_disbursement' });
    expect((await finance(a.id)).admission.paidMinor).toBe(1_000_000);

    // Reported but not yet in the bank: still not cash.
    const reported = await owner.post(`/api/v1/loans/${loan.id}/disbursements`, { disbursedOn: '2026-10-20', amountMinor: 2_000_000, receivedByInstitute: false }).expect(201);
    expect(reported.body.data).toMatchObject({ disbursedMinor: 2_000_000, receivedMinor: 0, disbursementStatus: 'partially_disbursed' });
    expect((await finance(a.id)).admission.paidMinor).toBe(1_000_000);

    // Arrives: becomes a receipt, allocated to the lender's instalment.
    const pending = reported.body.data.disbursements[0];
    const received = await owner.post(`/api/v1/loans/${loan.id}/disbursements/${pending.id}/received`, { receivedOn: '2026-10-22' }).expect(200);
    expect(received.body.data.receivedMinor).toBe(2_000_000);
    const f = await finance(a.id);
    expect(f.admission.paidMinor).toBe(3_000_000);
    expect(f.payments.find((p: { method: string }) => p.method === 'finance_disbursement')).toMatchObject({ paymentType: 'loan_disbursement' });

    const over = await owner.post(`/api/v1/loans/${loan.id}/disbursements`, { disbursedOn: '2026-10-25', amountMinor: 2_000_001, receivedByInstitute: true }).expect(422);
    expect(over.body.error.code).toBe('DISBURSEMENT_EXCEEDS_APPROVAL');
  });

  it('refuses to disburse an internal facility or an unapproved loan', async () => {
    const a = await admission(monthly);
    const internal = (await owner.post('/api/v1/loans', { admissionId: a.id, financeType: 'internal_instalment', providerName: 'Institute', requestedMinor: 4_000_000 }).expect(201)).body.data;
    await owner.post(`/api/v1/loans/${internal.id}/status`, { status: 'approved', date: '2026-10-02', approvedMinor: 4_000_000 }).expect(200);
    const res = await owner.post(`/api/v1/loans/${internal.id}/disbursements`, { disbursedOn: '2026-10-03', amountMinor: 1, receivedByInstitute: true }).expect(422);
    expect(res.body.error.code).toBe('NOT_DISBURSABLE');

    const external = (await owner.post('/api/v1/loans', { admissionId: a.id, financeType: 'external_loan', providerName: 'Bank', requestedMinor: 1_000 }).expect(201)).body.data;
    const res2 = await owner.post(`/api/v1/loans/${external.id}/disbursements`, { disbursedOn: '2026-10-03', amountMinor: 1, receivedByInstitute: false }).expect(422);
    expect(res2.body.error.code).toBe('NOT_APPROVED');
  });

  it('needs loans:approve to record a decision', async () => {
    const a = await admission(monthly);
    const officer = await clientWith(app, { permissions: ['loans:read', 'loans:write'] });
    const loan = (await officer.post('/api/v1/loans', { admissionId: a.id, financeType: 'external_loan', providerName: 'Bank', requestedMinor: 1_000 }).expect(201)).body.data;
    await officer.post(`/api/v1/loans/${loan.id}/status`, { status: 'applied', date: '2026-10-03' }).expect(200);
    await officer.post(`/api/v1/loans/${loan.id}/status`, { status: 'approved', date: '2026-10-04', approvedMinor: 1_000 }).expect(403);
  });

  it('summarises requested, approved, disbursed and received separately', async () => {
    const summary = (await owner.get('/api/v1/loans/summary').expect(200)).body.data;
    // From the tests above: EduFin approved 40,000, disbursed 20,000, all of it received.
    const edufin = summary.byProvider.find((p: { providerName: string }) => p.providerName === 'EduFin Bank');
    expect(edufin).toMatchObject({ approvedMinor: 4_000_000, receivedMinor: 2_000_000 });
    expect(summary.receivedMinor).toBeLessThanOrEqual(summary.disbursedMinor);
    expect(summary.approvedMinor).toBeGreaterThanOrEqual(4_000_000);
  });
});

describe('adjustments', () => {
  it('applies an approved discount and can void it', async () => {
    const a = await admission(monthly);
    const added = await owner.post(`/api/v1/admissions/${a.id}/adjustments`, { type: 'discount', amountMinor: 500_000, effectiveDate: '2026-10-03', reason: 'Merit scholarship' }).expect(201);
    expect((await finance(a.id)).admission.outstandingMinor).toBe(4_500_000);
    await owner.post(`/api/v1/adjustments/${added.body.data[0].id}/void`, { reason: 'Entered on wrong admission' }).expect(200);
    expect((await finance(a.id)).admission.outstandingMinor).toBe(5_000_000);
  });

  it('needs discounts:approve', async () => {
    const a = await admission(monthly);
    const staff = await clientWith(app, { permissions: ['payments:read', 'payments:write'] });
    await staff.post(`/api/v1/admissions/${a.id}/adjustments`, { type: 'discount', amountMinor: 1, effectiveDate: '2026-10-03', reason: 'x y z' }).expect(403);
  });
});
