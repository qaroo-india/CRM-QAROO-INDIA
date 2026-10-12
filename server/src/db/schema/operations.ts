/**
 * Documents, notifications and the reporting pipeline.
 */

import {
  DOCUMENT_ACCESS_LEVELS,
  DOCUMENT_OWNER_TYPES,
  JOB_STATUSES,
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_TYPES,
  REPORT_DELIVERY_STATUSES,
  REPORT_FORMATS,
  REPORT_TYPES,
  SCHEDULE_CADENCES,
  type DocumentAccessLevel,
  type DocumentOwnerType,
  type JobStatus,
  type NotificationSeverity,
  type NotificationType,
  type ReportDeliveryStatus,
  type ReportFormat,
  type ReportType,
  type ScheduleCadence,
} from '@ims/shared';
import {
  bool,
  check,
  enumStr,
  id,
  index,
  inList,
  instant,
  int,
  json,
  ref,
  sql,
  str,
  table,
  timestamps,
  uniqueIndex,
} from '../dialect';
import { users } from './users';

/**
 * File metadata. Bytes live in storage (local disk in development, a
 * persistent disk or object store in production) under an unguessable key.
 */
export const documents = table(
  'documents',
  {
    id: id(),
    ownerType: enumStr('owner_type', DOCUMENT_OWNER_TYPES).$type<DocumentOwnerType>().notNull(),
    ownerId: str('owner_id').notNull(),
    kind: str('kind').notNull(),
    title: str('title').notNull(),
    fileName: str('file_name').notNull(),
    mimeType: str('mime_type').notNull(),
    sizeBytes: int('size_bytes').notNull(),
    storageKey: str('storage_key').notNull(),
    accessLevel: enumStr('access_level', DOCUMENT_ACCESS_LEVELS).$type<DocumentAccessLevel>().notNull().default('general'),
    uploadedById: ref('uploaded_by_id').references(() => users.id),
    deletedAt: instant('deleted_at'),
    deletedById: ref('deleted_by_id').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('documents_storage_key_unique').on(t.storageKey),
    index('documents_owner_idx').on(t.ownerType, t.ownerId),
    check('documents_owner_type_check', inList(t.ownerType, DOCUMENT_OWNER_TYPES)),
    check('documents_access_check', inList(t.accessLevel, DOCUMENT_ACCESS_LEVELS)),
    check('documents_size_positive', sql`${t.sizeBytes} > 0`),
  ],
);

/**
 * In-app notifications. `dedupeKey` (unique per user) lets the reminder sweep
 * run every hour without ever creating the same reminder twice.
 */
export const notifications = table(
  'notifications',
  {
    id: id(),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id),
    type: enumStr('type', NOTIFICATION_TYPES).$type<NotificationType>().notNull(),
    severity: enumStr('severity', NOTIFICATION_SEVERITIES).$type<NotificationSeverity>().notNull().default('info'),
    title: str('title').notNull(),
    body: str('body'),
    entityType: str('entity_type'),
    entityId: str('entity_id'),
    /** Client route to open, e.g. /students/<id>?tab=payments. */
    link: str('link'),
    dedupeKey: str('dedupe_key').notNull(),
    readAt: instant('read_at'),
    createdAt: instant('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('notifications_user_dedupe_unique').on(t.userId, t.dedupeKey),
    index('notifications_user_unread_idx').on(t.userId, t.readAt, t.createdAt),
    check('notifications_type_check', inList(t.type, NOTIFICATION_TYPES)),
    check('notifications_severity_check', inList(t.severity, NOTIFICATION_SEVERITIES)),
  ],
);

export const reportSchedules = table(
  'report_schedules',
  {
    id: id(),
    name: str('name').notNull(),
    reportType: enumStr('report_type', REPORT_TYPES).$type<ReportType>().notNull(),
    format: enumStr('format', REPORT_FORMATS).$type<ReportFormat>().notNull(),
    cadence: enumStr('cadence', SCHEDULE_CADENCES).$type<ScheduleCadence>().notNull(),
    /** 'HH:MM' in the institute time zone. */
    timeOfDay: str('time_of_day').notNull(),
    dayOfWeek: int('day_of_week'),
    dayOfMonth: int('day_of_month'),
    recipients: json<string[]>('recipients').notNull(),
    filters: json<Record<string, unknown>>('filters')
      .notNull()
      .$defaultFn(() => ({})),
    isActive: bool('is_active').notNull().default(true),
    lastRunAt: instant('last_run_at'),
    nextRunAt: instant('next_run_at').notNull(),
    createdById: ref('created_by_id').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    index('report_schedules_due_idx').on(t.isActive, t.nextRunAt),
    check('report_schedules_cadence_check', inList(t.cadence, SCHEDULE_CADENCES)),
    check('report_schedules_time_format', sql`${t.timeOfDay} glob '[0-2][0-9]:[0-5][0-9]'`),
    check('report_schedules_dow_range', sql`${t.dayOfWeek} is null or ${t.dayOfWeek} between 0 and 6`),
    check('report_schedules_dom_range', sql`${t.dayOfMonth} is null or ${t.dayOfMonth} between 1 and 28`),
  ],
);

/** One generated report. The file itself is not kept: it is regenerated on retry. */
export const reportJobs = table(
  'report_jobs',
  {
    id: id(),
    reportType: enumStr('report_type', REPORT_TYPES).$type<ReportType>().notNull(),
    format: enumStr('format', REPORT_FORMATS).$type<ReportFormat>().notNull(),
    params: json<Record<string, unknown>>('params').notNull(),
    status: enumStr('status', JOB_STATUSES).$type<JobStatus>().notNull().default('queued'),
    fileName: str('file_name'),
    sizeBytes: int('size_bytes'),
    error: str('error'),
    requestedById: ref('requested_by_id').references(() => users.id),
    scheduleId: ref('schedule_id').references(() => reportSchedules.id),
    startedAt: instant('started_at'),
    finishedAt: instant('finished_at'),
    createdAt: instant('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('report_jobs_created_idx').on(t.createdAt),
    check('report_jobs_status_check', inList(t.status, JOB_STATUSES)),
  ],
);

/** Delivery metadata only -- never a copy of the report contents. */
export const reportDeliveries = table(
  'report_deliveries',
  {
    id: id(),
    reportJobId: ref('report_job_id')
      .notNull()
      .references(() => reportJobs.id),
    recipients: json<string[]>('recipients').notNull(),
    subject: str('subject').notNull(),
    message: str('message'),
    status: enumStr('status', REPORT_DELIVERY_STATUSES).$type<ReportDeliveryStatus>().notNull().default('pending'),
    attempts: int('attempts').notNull().default(0),
    lastError: str('last_error'),
    providerMessageId: str('provider_message_id'),
    sentAt: instant('sent_at'),
    createdById: ref('created_by_id').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    index('report_deliveries_status_idx').on(t.status, t.createdAt),
    check('report_deliveries_status_check', inList(t.status, REPORT_DELIVERY_STATUSES)),
  ],
);

export type DocumentRow = typeof documents.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type ReportJob = typeof reportJobs.$inferSelect;
export type ReportDelivery = typeof reportDeliveries.$inferSelect;
export type ReportSchedule = typeof reportSchedules.$inferSelect;
