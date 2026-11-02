/**
 * Report files, email delivery, history and schedules.
 *
 * Every export or email creates a report_jobs row (what was asked for, by
 * whom, the outcome); the generated file is kept under STORAGE_DIR so it can
 * be downloaded again or re-sent without regenerating different numbers.
 * Each email attempt is a report_deliveries row with its status, attempt
 * count and the provider's error -- a failure is recorded, surfaced to the
 * requester as a notification, and can be retried.
 */

import {
  addDays,
  addMonths,
  dateInZone,
  formatMoney,
  hasPermission,
  reportEmailSchema,
  reportExportQuerySchema,
  reportScheduleSchema,
  zonedDayStart,
  type ReportDataset,
  type ReportDeliveryDto,
  type ReportFormat,
  type ReportJobDto,
  type ReportQuery,
  type ReportScheduleDto,
  type ReportType,
} from '@ims/shared';
import { and, count, desc, eq, inArray, lte } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { db } from '../../db';
import { reportDeliveries, reportJobs, reportSchedules, users, type ReportJob, type ReportSchedule } from '../../db/schema';
import { recordAudit } from '../../services/audit';
import { mailTransportName, sendMail } from '../../services/mailer';
import { getSettings } from '../../services/settings';
import { readStoredFile, saveFile } from '../../services/storage';
import { ApiError } from '../../utils/ApiError';
import { systemContext, type RequestContext } from '../../utils/context';
import { pageWindow, paginated } from '../../utils/pagination';
import { toInstituteInfo } from '../users/serialize';
import { notifyUsers, ownerIds, safely } from '../notifications/notifications.service';
import { renderReportExcel } from './render/excel';
import { renderReportPdf } from './render/pdf';
import { formatters, reportBaseName } from './render/shared';
import { buildReport } from './reports.service';

export const MAX_DELIVERY_ATTEMPTS = 5;

const MIME: Record<ReportFormat, string> = {
  pdf: 'application/pdf',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const EXT: Record<ReportFormat, string> = { pdf: 'pdf', excel: 'xlsx' };

const storageKeyFor = (job: Pick<ReportJob, 'id' | 'format'>) => `reports/${job.id}.${EXT[job.format]}`;

export interface GeneratedFile {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

/** Keep provider errors useful but short, and never echo credentials. */
function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(pass(word)?|auth|user)=\S+/gi, '$1=***').slice(0, 500);
}

export async function renderReport(data: ReportDataset, format: ReportFormat, generatedAt: Date): Promise<GeneratedFile> {
  const institute = toInstituteInfo(getSettings());
  const buffer = format === 'pdf' ? await renderReportPdf(data, institute, generatedAt) : await renderReportExcel(data, institute, generatedAt);
  return { buffer, fileName: `${reportBaseName(data)}.${EXT[format]}`, mimeType: MIME[format] };
}

interface JobRequest {
  query: ReportQuery;
  format: ReportFormat;
  includeFinance: boolean;
  requestedById: string | null;
  scheduleId?: string | null;
  now?: Date;
}

/**
 * Generate, store and record one report. On failure the job is marked
 * failed (with the reason) and the error is rethrown.
 */
export async function createReportJob(req: JobRequest): Promise<{ job: ReportJob; file: GeneratedFile; data: ReportDataset }> {
  const now = req.now ?? new Date();
  const reportType: ReportType = req.query.type ?? 'custom';
  const job = await db
    .insert(reportJobs)
    .values({
      reportType,
      format: req.format,
      params: { ...req.query, includeFinance: req.includeFinance },
      status: 'running',
      requestedById: req.requestedById,
      scheduleId: req.scheduleId ?? null,
      startedAt: now,
    })
    .returning()
    .get();
  try {
    const data = await buildReport(req.query, { includeFinance: req.includeFinance, now });
    const file = await renderReport(data, req.format, now);
    await saveFile(storageKeyFor(job), file.buffer);
    const done = await db
      .update(reportJobs)
      .set({ status: 'succeeded', fileName: file.fileName, sizeBytes: file.buffer.length, finishedAt: new Date() })
      .where(eq(reportJobs.id, job.id))
      .returning()
      .get();
    return { job: done, file, data };
  } catch (error) {
    await db.update(reportJobs).set({ status: 'failed', error: errorText(error), finishedAt: new Date() }).where(eq(reportJobs.id, job.id)).run();
    logger.error({ err: error, jobId: job.id }, 'Report generation failed');
    await safely('report_failed', async () => {
      await notifyUsers(req.requestedById ? [req.requestedById] : await ownerIds(), {
        type: 'report_failed',
        severity: 'error',
        title: 'A report could not be generated',
        body: errorText(error),
        link: '/reports?tab=history',
        entityType: 'report_job',
        entityId: job.id,
        dedupeKey: `report_failed:${job.id}`,
      });
    });
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * Export (download)
 * ------------------------------------------------------------------ */

export async function exportReport(ctx: RequestContext, raw: unknown): Promise<GeneratedFile> {
  const { format, ...query } = reportExportQuerySchema.parse(raw);
  const includeFinance = hasPermission(ctx.permissions, 'reports:financial');
  const { job, file, data } = await createReportJob({ query, format, includeFinance, requestedById: ctx.actorId || null });
  await recordAudit(db, ctx, {
    action: 'export',
    entityType: 'report',
    entityId: job.id,
    summary: `Exported ${data.label.toLowerCase()} ${formatters(toInstituteInfo(getSettings())).range(data.range)} as ${format.toUpperCase()}`,
    after: { ...query, format, includeFinance },
  });
  return file;
}

/* ------------------------------------------------------------------ *
 * Email
 * ------------------------------------------------------------------ */

function emailBody(data: ReportDataset, message: string | undefined): { text: string; html: string } {
  const settings = getSettings();
  const f = formatters(toInstituteInfo(settings));
  const s = data.summary;
  const lines = [
    `${data.label}: ${f.range(data.range)}`,
    '',
    `Enquiries: ${f.count(s.leads.current)}`,
    `Admissions: ${f.count(s.admissions.current)}`,
    `Lead conversion: ${f.ratio(s.conversionRate.current)}`,
    ...(s.finance
      ? [
          `Net collections: ${formatMoney(s.finance.netCollectedMinor.current, { currency: settings.currency, locale: settings.locale })}`,
          `Outstanding at ${f.day(data.asOf)}: ${formatMoney(s.finance.outstandingMinor, { currency: settings.currency, locale: settings.locale })}`,
        ]
      : []),
    `Students placed: ${f.count(s.placementsJoined.current)}`,
    '',
    'The full report is attached.',
  ];
  const text = [message ? `${message}\n` : null, ...lines, '', `-- ${settings.name}`].filter((l) => l !== null).join('\n');
  const escape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#0f172a">${message ? `<p>${escape(message).replace(/\n/g, '<br>')}</p>` : ''}<p><strong>${escape(lines[0]!)}</strong></p><ul>${lines
    .slice(2, -2)
    .map((l) => `<li>${escape(l)}</li>`)
    .join('')}</ul><p>The full report is attached.</p><p style="color:#64748b">${escape(settings.name)}</p></div>`;
  return { text, html };
}

/** One attempt: updates the delivery row and notifies on failure. Never throws for a send error. */
async function attemptDelivery(deliveryId: string, file: GeneratedFile, body: { text: string; html: string }, notifyIds: string[]): Promise<void> {
  const delivery = await db.select().from(reportDeliveries).where(eq(reportDeliveries.id, deliveryId)).get();
  if (!delivery) return;
  const attempt = delivery.attempts + 1;
  try {
    const result = await sendMail({
      to: delivery.recipients,
      subject: delivery.subject,
      text: body.text,
      html: body.html,
      attachments: [{ filename: file.fileName, content: file.buffer, contentType: file.mimeType }],
    });
    await db.update(reportDeliveries)
      .set({ status: 'sent', attempts: attempt, lastError: null, sentAt: new Date(), providerMessageId: `${result.transport}:${result.messageId}`.slice(0, 250) })
      .where(eq(reportDeliveries.id, deliveryId))
      .run();
  } catch (error) {
    const reason = errorText(error);
    await db.update(reportDeliveries).set({ status: 'failed', attempts: attempt, lastError: reason }).where(eq(reportDeliveries.id, deliveryId)).run();
    logger.warn({ deliveryId, attempt, reason }, 'Report email failed');
    await safely('email_failed', async () => {
      await notifyUsers(notifyIds, {
        type: 'email_failed',
        severity: 'error',
        title: `Report email to ${delivery.recipients.join(', ')} failed`,
        body: `${reason}${attempt < MAX_DELIVERY_ATTEMPTS ? ' · You can retry from report history.' : ''}`,
        link: '/reports?tab=history',
        entityType: 'report_delivery',
        entityId: deliveryId,
        dedupeKey: `email_failed:${deliveryId}:${attempt}`,
      });
    });
  }
}

function defaultSubject(data: ReportDataset): string {
  const settings = getSettings();
  return `${settings.name}: ${data.label} (${formatters(toInstituteInfo(settings)).range(data.range)})`;
}

export async function emailReport(ctx: RequestContext, raw: unknown): Promise<ReportJobDto> {
  const { format, recipients, subject, message, ...query } = reportEmailSchema.parse(raw);
  const includeFinance = hasPermission(ctx.permissions, 'reports:financial');
  const { job, file, data } = await createReportJob({ query, format, includeFinance, requestedById: ctx.actorId || null });
  const delivery = await db
    .insert(reportDeliveries)
    .values({ reportJobId: job.id, recipients, subject: subject ?? defaultSubject(data), message: message ?? null, createdById: ctx.actorId || null })
    .returning()
    .get();
  await attemptDelivery(delivery.id, file, emailBody(data, message), ctx.actorId ? [ctx.actorId] : await ownerIds());
  await recordAudit(db, ctx, {
    action: 'email',
    entityType: 'report',
    entityId: job.id,
    summary: `Emailed ${data.label.toLowerCase()} to ${recipients.join(', ')}`,
    after: { ...query, format, recipients, includeFinance },
  });
  return await getJob(job.id);
}

export async function retryDelivery(ctx: RequestContext, deliveryId: string): Promise<ReportJobDto> {
  const delivery = await db.select().from(reportDeliveries).where(eq(reportDeliveries.id, deliveryId)).get();
  if (!delivery) throw ApiError.notFound('Email delivery');
  if (delivery.status === 'sent') throw ApiError.conflict('This email was already sent.', 'ALREADY_SENT');
  if (delivery.attempts >= MAX_DELIVERY_ATTEMPTS) throw ApiError.conflict(`Gave up after ${MAX_DELIVERY_ATTEMPTS} attempts. Check the email settings, then send the report again.`, 'TOO_MANY_ATTEMPTS');
  const job = await db.select().from(reportJobs).where(eq(reportJobs.id, delivery.reportJobId)).get();
  if (!job || job.status !== 'succeeded') throw ApiError.conflict('The report file for this email is not available.', 'NO_FILE');
  const buffer = await readStoredFile(storageKeyFor(job));
  if (!buffer) throw ApiError.conflict('The stored report file is missing. Send the report again to regenerate it.', 'NO_FILE');
  const params = job.params as ReportQuery & { includeFinance?: boolean };
  // The summary in the body is rebuilt from the job's own parameters.
  const data = await buildReport(params, { includeFinance: Boolean(params.includeFinance), withRows: false, now: job.startedAt ?? job.createdAt });
  await attemptDelivery(delivery.id, { buffer, fileName: job.fileName ?? `report.${EXT[job.format]}`, mimeType: MIME[job.format] }, emailBody(data, delivery.message ?? undefined), ctx.actorId ? [ctx.actorId] : await ownerIds());
  await recordAudit(db, ctx, { action: 'email', entityType: 'report_delivery', entityId: delivery.id, summary: `Retried report email to ${delivery.recipients.join(', ')}` });
  return await getJob(job.id);
}

/* ------------------------------------------------------------------ *
 * History and download
 * ------------------------------------------------------------------ */

const requester = alias(users, 'requester');

function toDeliveryDto(d: typeof reportDeliveries.$inferSelect): ReportDeliveryDto {
  return {
    id: d.id,
    recipients: d.recipients,
    subject: d.subject,
    status: d.status,
    attempts: d.attempts,
    lastError: d.lastError,
    transport: d.providerMessageId ? d.providerMessageId.split(':')[0]! : null,
    sentAt: d.sentAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

async function jobRows(where: ReturnType<typeof eq> | undefined, limit: number, offset: number) {
  return await db
    .select({ job: reportJobs, requestedByName: requester.name, scheduleName: reportSchedules.name })
    .from(reportJobs)
    .leftJoin(requester, eq(requester.id, reportJobs.requestedById))
    .leftJoin(reportSchedules, eq(reportSchedules.id, reportJobs.scheduleId))
    .where(where)
    .orderBy(desc(reportJobs.createdAt), desc(reportJobs.id))
    .limit(limit)
    .offset(offset)
    .all();
}

async function toJobDtos(rows: Awaited<ReturnType<typeof jobRows>>): Promise<ReportJobDto[]> {
  const ids = rows.map((r) => r.job.id);
  const deliveries = ids.length ? await db.select().from(reportDeliveries).where(inArray(reportDeliveries.reportJobId, ids)).orderBy(desc(reportDeliveries.createdAt)).all() : [];
  return rows.map(({ job, requestedByName, scheduleName }) => ({
    id: job.id,
    reportType: job.reportType,
    format: job.format,
    params: job.params,
    status: job.status,
    fileName: job.fileName,
    sizeBytes: job.sizeBytes,
    error: job.error,
    requestedByName: requestedByName ?? (job.scheduleId ? 'Schedule' : null),
    scheduleId: job.scheduleId,
    scheduleName,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    downloadable: job.status === 'succeeded',
    deliveries: deliveries.filter((d) => d.reportJobId === job.id).map(toDeliveryDto),
  }));
}

export async function getJob(id: string): Promise<ReportJobDto> {
  const rows = await jobRows(eq(reportJobs.id, id), 1, 0);
  if (rows.length === 0) throw ApiError.notFound('Report');
  return (await toJobDtos(rows))[0]!;
}

export async function listJobs(page: number, limit: number) {
  const total = (await db.select({ n: count() }).from(reportJobs).get())?.n ?? 0;
  const window = pageWindow(page, limit);
  return paginated(await toJobDtos(await jobRows(undefined, window.limit, window.offset)), total, page, limit);
}

export async function jobFile(ctx: RequestContext, id: string): Promise<GeneratedFile> {
  const job = await db.select().from(reportJobs).where(eq(reportJobs.id, id)).get();
  if (!job) throw ApiError.notFound('Report');
  if (job.status !== 'succeeded') throw ApiError.conflict('This report has no file.', 'NO_FILE');
  // A file generated with money in it needs the money permission to download.
  if ((job.params as { includeFinance?: boolean }).includeFinance && !hasPermission(ctx.permissions, 'reports:financial')) {
    throw ApiError.forbidden('This report contains financial figures.');
  }
  const buffer = await readStoredFile(storageKeyFor(job));
  if (!buffer) throw ApiError.conflict('The stored report file is missing. Generate the report again.', 'NO_FILE');
  return { buffer, fileName: job.fileName ?? `report.${EXT[job.format]}`, mimeType: MIME[job.format] };
}

/* ------------------------------------------------------------------ *
 * Schedules
 * ------------------------------------------------------------------ */

/**
 * The next run strictly after `after`: the configured wall-clock time in the
 * institute's zone, on the right weekday / day of month.
 */
export function computeNextRun(s: Pick<ReportSchedule, 'cadence' | 'timeOfDay' | 'dayOfWeek' | 'dayOfMonth'>, after: Date, timeZone: string): Date {
  const [hh, mm] = s.timeOfDay.split(':').map(Number) as [number, number];
  let day = dateInZone(after, timeZone);
  for (let i = 0; i < 400; i += 1, day = addDays(day, 1)) {
    if (s.cadence === 'weekly' && new Date(`${day}T00:00:00Z`).getUTCDay() !== s.dayOfWeek) continue;
    if (s.cadence === 'monthly' && Number(day.slice(8, 10)) !== s.dayOfMonth) continue;
    const at = new Date(zonedDayStart(day, timeZone).getTime() + (hh * 60 + mm) * 60_000);
    if (at.getTime() > after.getTime()) return at;
  }
  throw new Error('Could not compute the next run for this schedule');
}

const REPORT_FOR: Record<ReportSchedule['cadence'], ReportType> = { daily: 'daily', weekly: 'weekly', monthly: 'monthly' };

/** The complete period before the run: yesterday, last week, last month. */
export function scheduledReference(cadence: ReportSchedule['cadence'], runDay: string): string {
  if (cadence === 'daily') return addDays(runDay, -1);
  if (cadence === 'weekly') return addDays(runDay, -7);
  return addMonths(runDay, -1);
}

const creator = alias(users, 'creator');

function toScheduleDto(row: { s: ReportSchedule; createdByName: string | null }): ReportScheduleDto {
  const { s } = row;
  return {
    id: s.id,
    name: s.name,
    reportType: s.reportType,
    format: s.format,
    cadence: s.cadence,
    timeOfDay: s.timeOfDay,
    dayOfWeek: s.dayOfWeek,
    dayOfMonth: s.dayOfMonth,
    recipients: s.recipients,
    filters: s.filters as ReportScheduleDto['filters'],
    isActive: s.isActive,
    lastRunAt: s.lastRunAt?.toISOString() ?? null,
    nextRunAt: s.nextRunAt.toISOString(),
    createdByName: row.createdByName,
  };
}

function scheduleQuery() {
  return db.select({ s: reportSchedules, createdByName: creator.name }).from(reportSchedules).leftJoin(creator, eq(creator.id, reportSchedules.createdById));
}

export async function listSchedules(): Promise<ReportScheduleDto[]> {
  return (await scheduleQuery().orderBy(desc(reportSchedules.isActive), reportSchedules.name).all()).map(toScheduleDto);
}

export async function getSchedule(id: string): Promise<ReportScheduleDto> {
  const row = await scheduleQuery().where(eq(reportSchedules.id, id)).get();
  if (!row) throw ApiError.notFound('Schedule');
  return toScheduleDto(row);
}

export async function createSchedule(ctx: RequestContext, raw: unknown, now: Date = new Date()): Promise<ReportScheduleDto> {
  const input = reportScheduleSchema.parse(raw);
  const shape = { cadence: input.cadence, timeOfDay: input.timeOfDay, dayOfWeek: input.cadence === 'weekly' ? (input.dayOfWeek ?? null) : null, dayOfMonth: input.cadence === 'monthly' ? (input.dayOfMonth ?? null) : null };
  const row = await db.transaction(async (tx) => {
    const created = await tx
      .insert(reportSchedules)
      .values({ name: input.name, reportType: REPORT_FOR[input.cadence], format: input.format, ...shape, recipients: input.recipients, filters: input.filters, isActive: input.isActive, nextRunAt: computeNextRun(shape, now, getSettings().timezone), createdById: ctx.actorId || null })
      .returning()
      .get();
    await recordAudit(tx, ctx, { action: 'create', entityType: 'report_schedule', entityId: created.id, summary: `Scheduled "${created.name}" (${created.cadence}) to ${created.recipients.join(', ')}`, after: input });
    return created;
  });
  return await getSchedule(row.id);
}

export async function updateSchedule(ctx: RequestContext, id: string, raw: unknown, now: Date = new Date()): Promise<ReportScheduleDto> {
  const existing = await db.select().from(reportSchedules).where(eq(reportSchedules.id, id)).get();
  if (!existing) throw ApiError.notFound('Schedule');
  const input = reportScheduleSchema.parse(raw);
  const shape = { cadence: input.cadence, timeOfDay: input.timeOfDay, dayOfWeek: input.cadence === 'weekly' ? (input.dayOfWeek ?? null) : null, dayOfMonth: input.cadence === 'monthly' ? (input.dayOfMonth ?? null) : null };
  await db.transaction(async (tx) => {
    await tx.update(reportSchedules)
      .set({ name: input.name, reportType: REPORT_FOR[input.cadence], format: input.format, ...shape, recipients: input.recipients, filters: input.filters, isActive: input.isActive, nextRunAt: computeNextRun(shape, now, getSettings().timezone) })
      .where(eq(reportSchedules.id, id))
      .run();
    await recordAudit(tx, ctx, { action: 'update', entityType: 'report_schedule', entityId: id, summary: `Updated schedule "${input.name}"`, before: { name: existing.name, cadence: existing.cadence, recipients: existing.recipients, isActive: existing.isActive }, after: input });
  });
  return await getSchedule(id);
}

/** Schedules are configuration, not financial records: removing one keeps its past jobs. */
export async function deleteSchedule(ctx: RequestContext, id: string): Promise<void> {
  const existing = await db.select().from(reportSchedules).where(eq(reportSchedules.id, id)).get();
  if (!existing) throw ApiError.notFound('Schedule');
  await db.transaction(async (tx) => {
    await tx.update(reportJobs).set({ scheduleId: null }).where(eq(reportJobs.scheduleId, id)).run();
    await tx.delete(reportSchedules).where(eq(reportSchedules.id, id)).run();
    await recordAudit(tx, ctx, { action: 'delete', entityType: 'report_schedule', entityId: id, summary: `Deleted schedule "${existing.name}"`, before: { name: existing.name, cadence: existing.cadence, recipients: existing.recipients } });
  });
}

/**
 * Claim a due schedule by advancing its next run, compare-and-set on the value
 * just read. Of two overlapping runners (a cron tick on one instance, a timer
 * on another), only one gets true, so only one sends the email.
 */
async function claimDueSchedule(scheduleId: string, now: Date): Promise<boolean> {
  const s = await db.select().from(reportSchedules).where(eq(reportSchedules.id, scheduleId)).get();
  if (!s || !s.isActive || s.nextRunAt > now) return false;
  const result = await db
    .update(reportSchedules)
    .set({ lastRunAt: now, nextRunAt: computeNextRun(s, now, getSettings().timezone) })
    .where(and(eq(reportSchedules.id, s.id), eq(reportSchedules.isActive, true), eq(reportSchedules.nextRunAt, s.nextRunAt)))
    .run();
  return result.rowsAffected === 1;
}

/** Run one schedule now: the complete previous period, emailed to its recipients. */
export async function runSchedule(scheduleId: string, now: Date = new Date(), { claimed = false } = {}): Promise<ReportJobDto | null> {
  const s = await db.select().from(reportSchedules).where(eq(reportSchedules.id, scheduleId)).get();
  if (!s) throw ApiError.notFound('Schedule');
  const tz = getSettings().timezone;
  const runDay = dateInZone(now, tz);
  // Advance first, so a crash mid-run cannot make the runner fire it in a loop.
  if (!claimed) await db.update(reportSchedules).set({ lastRunAt: now, nextRunAt: computeNextRun(s, now, tz) }).where(eq(reportSchedules.id, s.id)).run();

  const owner = s.createdById ? await db.select().from(users).where(eq(users.id, s.createdById)).get() : undefined;
  const includeFinance = Boolean(owner?.isActive && hasPermission(owner.permissions, 'reports:financial'));
  const filters = s.filters as { courseId?: string; leadSourceId?: string; counsellorId?: string };
  const query: ReportQuery = { type: REPORT_FOR[s.cadence], reference: scheduledReference(s.cadence, runDay), ...filters };
  const notifyIds = [...new Set([...(owner?.isActive ? [owner.id] : []), ...await ownerIds()])];
  try {
    const { job, file, data } = await createReportJob({ query, format: s.format, includeFinance, requestedById: null, scheduleId: s.id, now });
    const delivery = await db.insert(reportDeliveries).values({ reportJobId: job.id, recipients: s.recipients, subject: `${defaultSubject(data)} · ${s.name}`, message: null, createdById: null }).returning().get();
    await attemptDelivery(delivery.id, file, emailBody(data, undefined), notifyIds);
    await recordAudit(db, systemContext(), { action: 'email', entityType: 'report_schedule', entityId: s.id, summary: `Scheduled report "${s.name}" sent to ${s.recipients.join(', ')}` });
    return await getJob(job.id);
  } catch (error) {
    logger.error({ err: error, scheduleId: s.id }, 'Scheduled report failed');
    return null;
  }
}

let running = false;

/**
 * Run every active schedule that is due. Safe to call often: it never
 * overlaps itself in one process, and each schedule is claimed atomically, so
 * runners on several instances never send the same report twice.
 */
export async function runDueSchedules(now: Date = new Date()): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const due = await db.select({ id: reportSchedules.id }).from(reportSchedules).where(and(eq(reportSchedules.isActive, true), lte(reportSchedules.nextRunAt, now))).all();
    let ran = 0;
    for (const { id } of due) {
      if (!(await claimDueSchedule(id, now))) continue;
      await runSchedule(id, now, { claimed: true });
      ran += 1;
    }
    return ran;
  } finally {
    running = false;
  }
}

export function emailStatus() {
  const transport = mailTransportName();
  return { transport, delivers: transport === 'smtp' || transport === 'test', from: env.EMAIL_FROM };
}
