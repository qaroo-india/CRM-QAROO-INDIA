/**
 * Milestone 8: PDF and Excel exports (generation, column accuracy, filter
 * consistency, formula-injection safety), emailed reports (success,
 * failure, retry), schedules, notifications, documents, bulk import and the
 * leads export.
 */

import ExcelJS from 'exceljs';
import type { ReportDataset, ReportJobDto } from '@ims/shared';
import type { Response } from 'superagent';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setMailTransport, type MailMessage } from '../src/server/services/mailer';
import { computeNextRun, runDueSchedules } from '../src/server/modules/reports/delivery.service';
import { runNotificationSweep } from '../src/server/modules/notifications/notifications.service';
import { bootstrap, clientWith, ownerClient, type Client } from './support';

let app: Awaited<ReturnType<typeof bootstrap>>;
let owner: Client;
let courseA: string;
let courseB: string;
let sourceId: string;
let studentId: string;
let admissionId: string;
let phone = 9_400_000_000;
const nextPhone = () => String((phone += 1));

/** Collect a binary response body into a Buffer. */
function binary(res: Response, done: (error: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => done(null, Buffer.concat(chunks)));
}

async function download(client: Client, url: string, status = 200): Promise<{ body: Buffer; headers: Record<string, string> }> {
  const res = await client.agent.get(url).buffer(true).parse(binary).expect(status);
  return { body: res.body as Buffer, headers: res.headers as Record<string, string> };
}

async function workbook(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

/** Row values of a sheet as plain arrays (1-based cells -> 0-based array). */
function sheetRows(ws: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  ws.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return rows;
}

const REPORT = 'type=monthly&reference=2026-05-10';

beforeAll(async () => {
  app = await bootstrap();
  owner = await ownerClient(app);
  courseA = (await owner.post('/api/v1/courses', { code: 'EXP-A', name: 'Export Course A', standardFeeMinor: 5_000_000 }).expect(201)).body.data.id;
  courseB = (await owner.post('/api/v1/courses', { code: 'EXP-B', name: 'Export Course B', standardFeeMinor: 2_000_000 }).expect(201)).body.data.id;
  sourceId = (await owner.get('/api/v1/settings/lead-sources').expect(200)).body.data[0].id;

  // A student whose name is a spreadsheet formula: it must arrive as inert text.
  const a = (
    await owner
      .post('/api/v1/admissions', {
        courseId: courseA,
        admissionDate: '2026-05-04',
        listFeeMinor: 5_000_000,
        newStudent: { fullName: '=HYPERLINK("http://evil.example","click")', phone: nextPhone() },
        feePlan: { planType: 'admission_plus_monthly', startDate: '2026-05-04', instalmentCount: 2, firstDueDate: '2026-06-04' },
        admissionFeeRequiredMinor: 1_000_000,
      })
      .expect(201)
  ).body.data;
  admissionId = a.id;
  studentId = a.studentId;
  await owner.post('/api/v1/payments', { admissionId, paymentDate: '2026-05-04', amountMinor: 1_500_000, method: 'upi' }).expect(201);
  const b = (await owner.post('/api/v1/admissions', { courseId: courseB, admissionDate: '2026-05-20', listFeeMinor: 2_000_000, newStudent: { fullName: 'Ravi Kumar', phone: nextPhone() } }).expect(201)).body.data;
  await owner.post('/api/v1/payments', { admissionId: b.id, paymentDate: '2026-05-21', amountMinor: 700_000, method: 'cash' }).expect(201);
  await owner.post(`/api/v1/admissions/${b.id}/refunds`, { amountMinor: 200_000, paymentDate: '2026-05-25', method: 'cash', reason: 'Overpaid' }).expect(201);
  await owner.post('/api/v1/leads', { name: '+SUM(A1:A9)', phone: nextPhone(), enquiryDate: '2026-05-02', leadSourceId: sourceId, interestedCourseId: courseA }).expect(201);
});

afterEach(() => setMailTransport(null));

describe('PDF export', () => {
  it('generates a real PDF, records the job and allows re-download', async () => {
    const { body, headers } = await download(owner, `/api/v1/reports/export?format=pdf&${REPORT}`);
    expect(headers['content-type']).toBe('application/pdf');
    expect(headers['content-disposition']).toContain('monthly-report_2026-05-01_2026-05-31.pdf');
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(body.length).toBeGreaterThan(5_000);

    const jobs = (await owner.get('/api/v1/reports/jobs').expect(200)).body.data.items as ReportJobDto[];
    const job = jobs.find((j) => j.format === 'pdf')!;
    expect(job.status).toBe('succeeded');
    expect(job.sizeBytes).toBe(body.length);
    const again = await download(owner, `/api/v1/reports/jobs/${job.id}/download`);
    expect(again.body.equals(body)).toBe(true);
  });
});

describe('Excel export', () => {
  it('matches the on-screen dataset, column by column, with live totals', async () => {
    const screen = (await owner.get(`/api/v1/reports/summary?${REPORT}`).expect(200)).body.data as ReportDataset;
    const { body, headers } = await download(owner, `/api/v1/reports/export?format=excel&${REPORT}`);
    expect(headers['content-type']).toContain('spreadsheetml');
    const wb = await workbook(body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Trend', 'Lead sources', 'Courses', 'Counsellors', 'Placement', 'Receivables ageing', 'Payment methods', 'Expense categories', 'Admissions', 'Payments', 'Expenses']);

    const summary = sheetRows(wb.getWorksheet('Summary')!);
    const find = (label: string) => summary.find((r) => r[0] === label)!;
    expect(find('Admissions (excl. cancelled)')[1]).toBe(screen.summary.admissions.current);
    expect(find('Collected (receipts)')[1]).toBe(screen.summary.finance!.collectedMinor.current / 100);
    expect(find('Net collections')[1]).toBe(20_000); // ₹15,000 + ₹7,000 − ₹2,000 refund, in rupees
    expect(screen.summary.finance!.netCollectedMinor.current).toBe(2_000_000);

    const payments = wb.getWorksheet('Payments')!;
    const rows = sheetRows(payments);
    const header = rows.findIndex((r) => r[0] === 'Receipt no.');
    expect(rows[header]).toEqual(['Receipt no.', 'Date', 'Student', 'Admission no.', 'Course', 'Type', 'For', 'Method', 'Amount']);
    const data = rows.slice(header + 1, header + 1 + screen.paymentRows!.length);
    expect(data.map((r) => r[8])).toEqual(screen.paymentRows!.map((p) => p.amountMinor / 100));
    expect(data[0]![1]).toBeInstanceOf(Date);
    const total = rows[header + 1 + screen.paymentRows!.length]!;
    expect(total[0]).toBe('Total');
    expect(total[8]).toMatchObject({ formula: expect.stringMatching(/^SUM\(I\d+:I\d+\)$/), result: 20_000 });
  });

  it('writes formula-like names as inert text', async () => {
    const { body } = await download(owner, `/api/v1/reports/export?format=excel&${REPORT}`);
    const wb = await workbook(body);
    const students = sheetRows(wb.getWorksheet('Admissions')!).map((r) => r[2]);
    expect(students).toContain(`'=HYPERLINK("http://evil.example","click")`);
    expect(students.some((s) => typeof s === 'object' && s !== null && 'formula' in (s as object))).toBe(false);
  });

  it('applies the same filters as the screen', async () => {
    const screen = (await owner.get(`/api/v1/reports/summary?${REPORT}&courseId=${courseB}`).expect(200)).body.data as ReportDataset;
    const { body } = await download(owner, `/api/v1/reports/export?format=excel&${REPORT}&courseId=${courseB}`);
    const wb = await workbook(body);
    // Expenses are withheld under a course filter, exactly as on screen.
    expect(wb.getWorksheet('Expenses')).toBeUndefined();
    const rows = sheetRows(wb.getWorksheet('Admissions')!);
    const header = rows.findIndex((r) => r[0] === 'Admission no.');
    const listed = rows.slice(header + 1).filter((r) => r[0] !== 'Total');
    expect(listed).toHaveLength(screen.summary.admissions.current);
    expect(listed.every((r) => r[4] === 'Export Course B')).toBe(true);
    expect(String(sheetRows(wb.getWorksheet('Summary')!)[3]![0])).toContain('Course: Export Course B');
  });

  it('leaves money out for exporters without financial access, and enforces export permission', async () => {
    const exporter = await clientWith(app, { permissions: ['reports:read', 'reports:export'] });
    const { body } = await download(exporter, `/api/v1/reports/export?format=excel&${REPORT}`);
    const wb = await workbook(body);
    expect(wb.getWorksheet('Payments')).toBeUndefined();
    expect(sheetRows(wb.getWorksheet('Summary')!).some((r) => r[0] === 'Net collections')).toBe(false);

    const reader = await clientWith(app, { permissions: ['reports:read'] });
    await reader.get(`/api/v1/reports/export?format=pdf&${REPORT}`).expect(403);
    await owner.get(`/api/v1/reports/export?format=docx&${REPORT}`).expect(422);
  });
});

describe('emailed reports', () => {
  it('sends the file as an attachment and records the delivery', async () => {
    const sent: MailMessage[] = [];
    setMailTransport(async (m) => {
      sent.push(m);
      return { messageId: 'm-1', transport: 'test' };
    });
    const res = await owner.post('/api/v1/reports/email', { type: 'monthly', reference: '2026-05-10', format: 'excel', recipients: ['Director@Example.com', 'director@example.com'], message: 'For the board meeting' }).expect(201);
    const job = res.body.data as ReportJobDto;
    expect(job.deliveries).toHaveLength(1);
    expect(job.deliveries[0]).toMatchObject({ status: 'sent', attempts: 1, transport: 'test', recipients: ['director@example.com'] });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.attachments![0]!.filename).toBe('monthly-report_2026-05-01_2026-05-31.xlsx');
    expect(sent[0]!.text).toContain('For the board meeting');
    expect(sent[0]!.text).toContain('Admissions: 2');
  });

  it('records a failure, notifies the sender, and succeeds on retry', async () => {
    setMailTransport(async () => {
      throw new Error('Connection refused by smtp.example.com:587');
    });
    const res = await owner.post('/api/v1/reports/email', { type: 'monthly', reference: '2026-05-10', format: 'pdf', recipients: ['ops@example.com'] }).expect(201);
    const delivery = (res.body.data as ReportJobDto).deliveries[0]!;
    expect(delivery).toMatchObject({ status: 'failed', attempts: 1 });
    expect(delivery.lastError).toContain('Connection refused');

    const inbox = (await owner.get('/api/v1/notifications?unread=true').expect(200)).body.data.items as { type: string; entityId: string }[];
    expect(inbox.some((n) => n.type === 'email_failed' && n.entityId === delivery.id)).toBe(true);

    setMailTransport(async () => ({ messageId: 'm-2', transport: 'test' }));
    const retried = (await owner.post(`/api/v1/reports/deliveries/${delivery.id}/retry`).expect(200)).body.data as ReportJobDto;
    expect(retried.deliveries.find((d) => d.id === delivery.id)).toMatchObject({ status: 'sent', attempts: 2, lastError: null });
    await owner.post(`/api/v1/reports/deliveries/${delivery.id}/retry`).expect(409);
  });

  it('validates recipients and requires reports:email', async () => {
    await owner.post('/api/v1/reports/email', { type: 'monthly', format: 'pdf', recipients: ['not-an-email'] }).expect(422);
    await owner.post('/api/v1/reports/email', { type: 'monthly', format: 'pdf', recipients: [] }).expect(422);
    const exporter = await clientWith(app, { permissions: ['reports:read', 'reports:export'] });
    await exporter.post('/api/v1/reports/email', { type: 'monthly', format: 'pdf', recipients: ['a@example.com'] }).expect(403);
  });
});

describe('schedules', () => {
  it('computes the next run in the institute time zone', () => {
    // Monday 12 Oct 2026, 05:30 IST.
    const now = new Date('2026-10-12T00:00:00Z');
    expect(computeNextRun({ cadence: 'daily', timeOfDay: '08:30', dayOfWeek: null, dayOfMonth: null }, now, 'Asia/Kolkata').toISOString()).toBe('2026-10-12T03:00:00.000Z');
    expect(computeNextRun({ cadence: 'daily', timeOfDay: '04:00', dayOfWeek: null, dayOfMonth: null }, now, 'Asia/Kolkata').toISOString()).toBe('2026-10-12T22:30:00.000Z');
    expect(computeNextRun({ cadence: 'weekly', timeOfDay: '09:00', dayOfWeek: 5, dayOfMonth: null }, now, 'Asia/Kolkata').toISOString()).toBe('2026-10-16T03:30:00.000Z');
    expect(computeNextRun({ cadence: 'monthly', timeOfDay: '07:00', dayOfWeek: null, dayOfMonth: 1 }, now, 'Asia/Kolkata').toISOString()).toBe('2026-11-01T01:30:00.000Z');
  });

  it('runs due schedules for the previous complete period and advances them', async () => {
    const sent: MailMessage[] = [];
    setMailTransport(async (m) => {
      sent.push(m);
      return { messageId: `s-${sent.length}`, transport: 'test' };
    });
    const schedule = (await owner.post('/api/v1/reports/schedules', { name: 'Monthly board pack', format: 'pdf', cadence: 'monthly', timeOfDay: '07:00', dayOfMonth: 1, recipients: ['board@example.com'] }).expect(201)).body.data;
    const paused = (await owner.post('/api/v1/reports/schedules', { name: 'Paused', format: 'excel', cadence: 'daily', timeOfDay: '07:00', recipients: ['x@example.com'], isActive: false }).expect(201)).body.data;
    await owner.post('/api/v1/reports/schedules', { name: 'Bad', format: 'pdf', cadence: 'weekly', timeOfDay: '07:00', recipients: ['x@example.com'] }).expect(422);

    const runAt = new Date(new Date(schedule.nextRunAt).getTime() + 60_000);
    const ran = await runDueSchedules(runAt);
    expect(ran).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(['board@example.com']);

    const jobs = (await owner.get('/api/v1/reports/jobs').expect(200)).body.data.items as ReportJobDto[];
    const job = jobs.find((j) => j.scheduleId === schedule.id)!;
    expect(job.reportType).toBe('monthly');
    expect(job.scheduleName).toBe('Monthly board pack');
    // Run on the 1st: the report covers the whole previous month.
    const runDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(runAt);
    expect(runDay.endsWith('-01')).toBe(true);
    expect(String(job.params.reference).slice(0, 7)).not.toBe(runDay.slice(0, 7));

    const after = (await owner.get('/api/v1/reports/schedules').expect(200)).body.data as { id: string; nextRunAt: string; lastRunAt: string | null }[];
    const updated = after.find((s) => s.id === schedule.id)!;
    expect(new Date(updated.nextRunAt).getTime()).toBeGreaterThan(runAt.getTime());
    expect(after.find((s) => s.id === paused.id)!.lastRunAt).toBeNull();
    expect(await runDueSchedules(runAt)).toBe(0);
  });
});

describe('notifications', () => {
  it('sweeps reminders once per day and keeps them private', async () => {
    const first = await runNotificationSweep(new Date('2026-07-01T04:00:00Z'));
    expect(first.created).toBeGreaterThan(0);
    expect((await runNotificationSweep(new Date('2026-07-01T06:00:00Z'))).created).toBe(0);

    const list = (await owner.get('/api/v1/notifications?unread=true&limit=100').expect(200)).body.data.items as { id: string; type: string; title: string }[];
    const overdue = list.find((n) => n.type === 'instalment_overdue')!;
    expect(overdue.title).toMatch(/overdue instalment/);
    const before = (await owner.get('/api/v1/notifications/unread-count').expect(200)).body.data.unread as number;
    await owner.post(`/api/v1/notifications/${overdue.id}/read`).expect(200);
    expect((await owner.get('/api/v1/notifications/unread-count').expect(200)).body.data.unread).toBe(before - 1);

    const stranger = await clientWith(app, { permissions: ['leads:read'] });
    await stranger.post(`/api/v1/notifications/${overdue.id}/read`).expect(404);
    expect((await stranger.get('/api/v1/notifications').expect(200)).body.data.items.some((n: { type: string }) => n.type === 'instalment_overdue')).toBe(false);
    await stranger.post('/api/v1/notifications/sweep').expect(403);

    await owner.post('/api/v1/notifications/read-all').expect(200);
    expect((await owner.get('/api/v1/notifications/unread-count').expect(200)).body.data.unread).toBe(0);
  });
});

describe('documents', () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const upload = (client: Client, fields: Record<string, string>, file: Buffer, name: string) => {
    const req = client.agent.post('/api/v1/documents').set('X-CSRF-Token', client.csrf);
    for (const [k, v] of Object.entries(fields)) req.field(k, v);
    return req.attach('file', file, name);
  };

  it('stores an allowed file and serves the same bytes back', async () => {
    const res = await upload(owner, { ownerType: 'student', ownerId: studentId, kind: 'Admission form', title: 'Signed form' }, pdf, 'form.pdf').expect(201);
    expect(res.body.data).toMatchObject({ mimeType: 'application/pdf', accessLevel: 'general', sizeBytes: pdf.length });
    const { body, headers } = await download(owner, `/api/v1/documents/${res.body.data.id}/download`);
    expect(body.equals(pdf)).toBe(true);
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['content-disposition']).toContain('attachment');
  });

  it('refuses disallowed types and spoofed contents', async () => {
    const fields = { ownerType: 'student', ownerId: studentId, kind: 'Other', title: 'x' };
    await upload(owner, fields, Buffer.from('MZ\x90\x00'), 'tool.exe').expect(422);
    const spoofed = await upload(owner, fields, Buffer.from('MZ\x90\x00 not a pdf'), 'fake.pdf').expect(422);
    expect(spoofed.body.error.fields[0].message).toMatch(/do not match/);
    await upload(owner, { ...fields, ownerId: '01890000-0000-7000-8000-000000000000' }, pdf, 'a.pdf').expect(422);
  });

  it('hides restricted documents from staff without access, and soft-deletes with a reason', async () => {
    const id = (await upload(owner, { ownerType: 'student', ownerId: studentId, kind: 'Identity proof', title: 'Aadhaar' }, pdf, 'id.pdf').expect(201)).body.data;
    expect(id.accessLevel).toBe('restricted');

    const staff = await clientWith(app, { permissions: ['documents:read', 'documents:write', 'students:read'] });
    const visible = (await staff.get(`/api/v1/documents?ownerType=student&ownerId=${studentId}`).expect(200)).body.data.items as { id: string }[];
    expect(visible.some((d) => d.id === id.id)).toBe(false);
    await staff.get(`/api/v1/documents/${id.id}/download`).expect(404);
    await upload(staff, { ownerType: 'student', ownerId: studentId, kind: 'Identity proof', title: 'PAN' }, pdf, 'pan.pdf').expect(403);

    await owner.post(`/api/v1/documents/${id.id}/delete`, {}).expect(422);
    await owner.post(`/api/v1/documents/${id.id}/delete`, { reason: 'Uploaded to the wrong student' }).expect(200);
    const after = (await owner.get(`/api/v1/documents/student/${studentId}`).expect(200)).body.data as { id: string }[];
    expect(after.some((d) => d.id === id.id)).toBe(false);
    const audit = (await owner.get('/api/v1/audit?entityType=document').expect(200)).body.data.items as { summary: string }[];
    expect(audit.some((a) => a.summary.includes('Uploaded to the wrong student'))).toBe(true);
  });

  it("shows a record's documents only to people who may see that record", async () => {
    const categoryId = (await owner.get('/api/v1/settings/expense-categories').expect(200)).body.data[0].id;
    const expense = (await owner.post('/api/v1/expenses', { expenseDate: '2026-05-03', categoryId, description: 'Printer', amountMinor: 900_000, paymentMethod: 'cash' }).expect(201)).body.data;
    const receipt = (await upload(owner, { ownerType: 'expense', ownerId: expense.id, kind: 'Expense receipt', title: 'Printer bill' }, pdf, 'bill.pdf').expect(201)).body.data;
    const linked = (await owner.get(`/api/v1/expenses/${expense.id}`).expect(200)).body.data;
    expect(linked.receiptDocumentId).toBe(receipt.id);

    const noExpenses = await clientWith(app, { permissions: ['documents:read', 'documents:write', 'students:read'] });
    await noExpenses.get(`/api/v1/documents/${receipt.id}/download`).expect(404);
    const listed = (await noExpenses.get('/api/v1/documents?limit=100').expect(200)).body.data.items as { ownerType: string }[];
    expect(listed.some((d) => d.ownerType === 'expense')).toBe(false);
    await upload(noExpenses, { ownerType: 'expense', ownerId: expense.id, kind: 'Expense receipt', title: 'x' }, pdf, 'x.pdf').expect(403);

    const accounts = await clientWith(app, { permissions: ['documents:read', 'expenses:read'] });
    await download(accounts, `/api/v1/documents/${receipt.id}/download`);
  });
});

describe('bulk import', () => {
  const importClient = async () => await clientWith(app, { permissions: ['data:import', 'leads:write', 'leads:read', 'students:write'] });
  const csv = (rows: string[]) => Buffer.from(['Name,Phone,Email,Enquiry date,Source,Course', ...rows].join('\r\n'));

  it('previews with validation and duplicate flags, then imports only confirmed rows once', async () => {
    const user = await importClient();
    const sourceName = (await owner.get('/api/v1/settings/lead-sources').expect(200)).body.data[0].name as string;
    const existing = (await owner.post('/api/v1/leads', { name: 'Already Here', phone: '9555512345', enquiryDate: '2026-05-01', leadSourceId: sourceId }).expect(201)).body.data;
    const file = csv([
      `Meera Iyer,98400 11111,meera@example.com,05/06/2026,${sourceName},EXP-A`,
      `Bad Phone,12,,05/06/2026,${sourceName},`,
      `Dup Of Existing,${existing.phone},,05/06/2026,${sourceName},`,
      `"Iyer, Meera (again)",9840011111,,06/06/2026,${sourceName},`,
      `Unknown Source,9840022222,,06/06/2026,Pigeon post,`,
    ]);
    const preview = (await user.agent.post('/api/v1/import/leads/preview').set('X-CSRF-Token', user.csrf).attach('file', file, 'leads.csv').expect(200)).body.data;
    expect(preview.summary).toEqual({ total: 5, valid: 3, invalid: 2, duplicates: 2 });
    expect(preview.rows[0].data).toMatchObject({ enquiryDate: '2026-06-05', interestedCourseId: courseA, courseName: 'Export Course A' });
    expect(preview.rows[1].errors[0].field).toBe('phone');
    expect(preview.rows[2].duplicates[0].kind).toBe('existing');
    expect(preview.rows[3].duplicates[0]).toMatchObject({ kind: 'in_file', label: 'Same phone as row 1' });
    expect(preview.rows[4].errors[0]).toMatchObject({ field: 'source', message: 'Unknown lead source "Pigeon post"' });

    const result = (await user.post('/api/v1/import/leads/commit', { token: preview.token, rows: [1, 2, 3] }).expect(201)).body.data;
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.codes).toHaveLength(1);
    expect(result.failures.map((f: { row: number }) => f.row)).toEqual([2, 3]);
    await user.post('/api/v1/import/leads/commit', { token: preview.token, rows: [1] }).expect(409);
  });

  it('requires data:import and the create permission for the entity', async () => {
    const noImport = await clientWith(app, { permissions: ['leads:write'] });
    await noImport.agent.post('/api/v1/import/leads/preview').set('X-CSRF-Token', noImport.csrf).attach('file', csv([]), 'x.csv').expect(403);
    const noStudents = await clientWith(app, { permissions: ['data:import', 'leads:write'] });
    await noStudents.agent.post('/api/v1/import/students/preview').set('X-CSRF-Token', noStudents.csrf).attach('file', Buffer.from('Full name,Phone\r\nA B,9876543210'), 's.csv').expect(403);
  });
});

describe('leads export', () => {
  it('exports filtered leads as CSV with formula triggers neutralised', async () => {
    const { body, headers } = await download(owner, '/api/v1/leads/export?format=csv&from=2026-05-02&to=2026-05-02');
    expect(headers['content-type']).toContain('text/csv');
    const text = body.toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain(`"'+SUM(A1:A9)"`);
    expect(text.trim().split('\r\n')).toHaveLength(2);
    const staff = await clientWith(app, { permissions: ['leads:read'] });
    await staff.get('/api/v1/leads/export').expect(403);
  });
});
