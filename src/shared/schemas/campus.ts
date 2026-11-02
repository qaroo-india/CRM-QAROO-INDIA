/**
 * Inputs for the campus modules: class schedule, attendance, exams, study
 * material, certificates, placement drives, leave, tasks and inventory.
 */

import { z } from 'zod';
import {
  ATTENDANCE_STATUSES,
  CERTIFICATE_STATUSES,
  CLASS_SESSION_KINDS,
  DRIVE_STATUSES,
  EXAM_KINDS,
  EXAM_STATUSES,
  INVENTORY_CATEGORIES,
  INVENTORY_ITEM_STATUSES,
  INVENTORY_REQUEST_STATUSES,
  LEAVE_STATUSES,
  LEAVE_TYPES,
  MATERIAL_KINDS,
  PROFILE_TRACKS,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from '../constants/domain';
import { optionalDate, optionalId } from './academics';
import { csvEnum, dateOnlySchema, idSchema, moneyMinorSchema, nonEmptyString, optionalString, paginationSchema, timestampSchema } from './common';

/** http(s) only: a "javascript:" link must never become a clickable meeting link. */
export const webLinkSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^https?:\/\/[^\s]+$/i.test(v), 'Use a full http:// or https:// link');

const optionalLink = z
  .union([z.literal(''), z.null(), z.undefined(), webLinkSchema])
  .optional()
  .transform((v) => (v ? v : undefined));

const optionalInstant = z
  .union([z.literal(''), z.null(), z.undefined(), timestampSchema])
  .optional()
  .transform((v) => (v ? v : undefined));

/* ------------------------------------------------------------------ *
 * Class schedule
 * ------------------------------------------------------------------ */

export const classSessionSchema = z.object({
  batchId: idSchema,
  title: nonEmptyString(160, 'Title'),
  kind: z.enum(CLASS_SESSION_KINDS).default('lecture'),
  /** ISO instant with offset, e.g. 2026-10-14T10:00:00+05:30. */
  startsAt: timestampSchema,
  durationMinutes: z.coerce.number().int().min(5).max(720).default(60),
  location: optionalString(120),
  meetingLink: optionalLink,
  description: optionalString(2000),
  /** Defaults to the batch's trainer. */
  trainerId: optionalId,
  examId: optionalId,
  /** Create the same class every chosen weekday until this date (inclusive). */
  repeat: z
    .object({
      weekdays: z.array(z.number().int().min(0).max(6)).min(1, 'Choose at least one day').max(7),
      until: dateOnlySchema,
    })
    .optional(),
});
export type ClassSessionInput = z.input<typeof classSessionSchema>;

export const classSessionUpdateSchema = classSessionSchema.omit({ batchId: true, repeat: true });

export const classSessionStatusSchema = z
  .object({ status: z.enum(['scheduled', 'completed', 'cancelled']), cancelReason: optionalString(300) })
  .superRefine((v, ctx) => {
    if (v.status === 'cancelled' && !v.cancelReason) ctx.addIssue({ code: 'custom', path: ['cancelReason'], message: 'Say why the class is cancelled' });
  });

export const scheduleQuerySchema = z.object({
  from: dateOnlySchema,
  to: dateOnlySchema,
  batchId: idSchema.optional(),
  courseId: idSchema.optional(),
  trainerId: idSchema.optional(),
  status: csvEnum(['scheduled', 'completed', 'cancelled'] as const),
});

/* ------------------------------------------------------------------ *
 * Attendance
 * ------------------------------------------------------------------ */

export const attendanceSaveSchema = z.object({
  batchId: idSchema,
  date: dateOnlySchema,
  topic: optionalString(200),
  classSessionId: optionalId,
  records: z
    .array(
      z.object({
        admissionId: idSchema,
        status: z.enum(ATTENDANCE_STATUSES),
        minutesLate: z.coerce.number().int().min(0).max(720).default(0),
        remark: optionalString(200),
      }),
    )
    .min(1, 'Mark at least one student')
    .max(1000),
});
export type AttendanceSaveInput = z.input<typeof attendanceSaveSchema>;

export const attendanceQuerySchema = z.object({
  batchId: idSchema,
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});

/* ------------------------------------------------------------------ *
 * Exams
 * ------------------------------------------------------------------ */

const examFields = {
  title: nonEmptyString(160, 'Title'),
  kind: z.enum(EXAM_KINDS).default('unit_test'),
  batchId: optionalId,
  courseId: optionalId,
  instructions: optionalString(4000),
  durationMinutes: z.coerce.number().int().min(1).max(600).default(30),
  passPercent: z.coerce.number().int().min(0).max(100).default(40),
  maxAttempts: z.coerce.number().int().min(1).max(20).default(1),
  availableFrom: optionalInstant,
  availableUntil: optionalInstant,
  shuffleQuestions: z.boolean().default(true),
};

export const examSchema = z.object(examFields).superRefine((v, ctx) => {
  if (!v.batchId === !v.courseId) ctx.addIssue({ code: 'custom', path: ['batchId'], message: 'Choose either a batch or a whole course' });
  if (v.availableFrom && v.availableUntil && v.availableUntil <= v.availableFrom) {
    ctx.addIssue({ code: 'custom', path: ['availableUntil'], message: 'Must be after the opening time' });
  }
});
export type ExamInput = z.input<typeof examSchema>;

export const examQuestionSchema = z
  .object({
    text: nonEmptyString(4000, 'Question'),
    marks: z.coerce.number().int().min(1).max(100).default(1),
    options: z
      .array(z.object({ text: nonEmptyString(500, 'Option'), isCorrect: z.boolean().default(false) }))
      .min(2, 'Give at least two options')
      .max(8, 'At most eight options'),
  })
  .superRefine((v, ctx) => {
    const correct = v.options.filter((o) => o.isCorrect).length;
    if (correct !== 1) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Mark exactly one option as correct' });
  });
export type ExamQuestionInput = z.input<typeof examQuestionSchema>;

export const examStatusSchema = z.object({ status: z.enum(EXAM_STATUSES) });

export const examListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  batchId: idSchema.optional(),
  courseId: idSchema.optional(),
  kind: z.enum(EXAM_KINDS).optional(),
  status: csvEnum(EXAM_STATUSES),
});

/** A student's saved choice for one question during an attempt. */
export const examAnswerSchema = z.object({ questionId: idSchema, optionId: idSchema.nullable() });

/* ------------------------------------------------------------------ *
 * Study material (multipart fields; the file is optional when a link is given)
 * ------------------------------------------------------------------ */

export const materialSchema = z.object({
  title: nonEmptyString(160, 'Title'),
  description: optionalString(2000),
  kind: z.enum(MATERIAL_KINDS).default('notes'),
  courseId: idSchema,
  batchId: optionalId,
  externalUrl: optionalLink,
  isPublished: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .default(true)
    .transform((v) => v === true || v === 'true'),
});

export const materialListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  courseId: idSchema.optional(),
  batchId: idSchema.optional(),
  kind: z.enum(MATERIAL_KINDS).optional(),
});

/* ------------------------------------------------------------------ *
 * Certificates
 * ------------------------------------------------------------------ */

export const certificateRequestSchema = z.object({ admissionId: idSchema, requestNote: optionalString(1000) });

export const certificateDecisionSchema = z
  .object({
    status: z.enum(['under_review', 'approved', 'issued', 'rejected']),
    reviewNote: optionalString(1000),
    issuedOn: optionalDate,
  })
  .superRefine((v, ctx) => {
    if (v.status === 'rejected' && !v.reviewNote) ctx.addIssue({ code: 'custom', path: ['reviewNote'], message: 'Tell the student why' });
  });

export const certificateListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  status: csvEnum(CERTIFICATE_STATUSES),
  courseId: idSchema.optional(),
});

/* ------------------------------------------------------------------ *
 * Placement drives
 * ------------------------------------------------------------------ */

export const driveSchema = z
  .object({
    companyId: optionalId,
    companyName: optionalString(160),
    roleTitle: nonEmptyString(160, 'Role'),
    description: optionalString(4000),
    track: z.enum(PROFILE_TRACKS),
    status: z.enum(DRIVE_STATUSES).default('planned'),
    driveDate: dateOnlySchema,
    applyBy: optionalDate,
    packageMinor: moneyMinorSchema.nullable().optional(),
    openings: z.coerce.number().int().min(1).max(10_000).default(1),
    location: optionalString(120),
    isRemote: z.boolean().default(false),
    eligibilityNote: optionalString(2000),
    coordinatorId: optionalId,
    batchIds: z.array(idSchema).max(200).default([]),
  })
  .superRefine((v, ctx) => {
    if (!v.companyId && !v.companyName) ctx.addIssue({ code: 'custom', path: ['companyName'], message: 'Choose or enter a company' });
    if (v.applyBy && v.applyBy > v.driveDate) ctx.addIssue({ code: 'custom', path: ['applyBy'], message: 'Applications must close on or before the drive' });
  });
export type DriveInput = z.input<typeof driveSchema>;

export const driveListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  status: csvEnum(DRIVE_STATUSES),
  track: z.enum(PROFILE_TRACKS).optional(),
});

/** Staff add students to a drive (students can also apply themselves). */
export const driveApplicantsSchema = z.object({ profileIds: z.array(idSchema).min(1).max(500) });

/* ------------------------------------------------------------------ *
 * Leave, tasks, inventory
 * ------------------------------------------------------------------ */

export const leaveRequestSchema = z
  .object({ type: z.enum(LEAVE_TYPES), startDate: dateOnlySchema, endDate: dateOnlySchema, reason: optionalString(1000) })
  .superRefine((v, ctx) => {
    if (v.endDate < v.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Cannot end before it starts' });
  });

export const leaveDecisionSchema = z
  .object({ decision: z.enum(['approve', 'reject']), reviewNote: optionalString(300) })
  .superRefine((v, ctx) => {
    if (v.decision === 'reject' && !v.reviewNote) ctx.addIssue({ code: 'custom', path: ['reviewNote'], message: 'Give a reason' });
  });

export const leaveListQuerySchema = paginationSchema.extend({
  scope: z.enum(['mine', 'team']).default('mine'),
  status: csvEnum(LEAVE_STATUSES),
  userId: idSchema.optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});

/** Multipart fields; the attachment is optional. */
export const taskSchema = z.object({
  title: nonEmptyString(180, 'Title'),
  details: optionalString(4000),
  batchId: optionalId,
  assignedToId: optionalId,
  priority: z.enum(TASK_PRIORITIES).default('medium'),
  dueDate: optionalDate,
});

export const taskStatusSchema = z.object({ status: z.enum(TASK_STATUSES) });

export const taskListQuerySchema = paginationSchema.extend({
  scope: z.enum(['mine', 'created', 'all']).default('mine'),
  q: z.string().trim().max(100).optional(),
  status: csvEnum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assignedToId: idSchema.optional(),
  overdue: z.enum(['true']).optional(),
});

export const inventoryItemSchema = z
  .object({
    assetTag: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,31}$/, 'Use 2-32 letters, digits or dashes'),
    name: nonEmptyString(160, 'Name'),
    category: z.enum(INVENTORY_CATEGORIES).default('other'),
    description: optionalString(2000),
    quantityTotal: z.coerce.number().int().min(0).max(100_000).default(1),
    unitValueMinor: moneyMinorSchema.default(0),
    isConsumable: z.boolean().default(false),
    status: z.enum(INVENTORY_ITEM_STATUSES).default('in_service'),
    condition: optionalString(80),
    location: optionalString(120),
    purchasedOn: optionalDate,
    notes: optionalString(2000),
  });
export type InventoryItemInput = z.input<typeof inventoryItemSchema>;

export const inventoryListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  category: z.enum(INVENTORY_CATEGORIES).optional(),
  status: z.enum(INVENTORY_ITEM_STATUSES).optional(),
  available: z.enum(['true']).optional(),
});

export const inventoryRequestSchema = z.object({
  itemId: idSchema,
  quantity: z.coerce.number().int().min(1).max(1000).default(1),
  reason: optionalString(1000),
  neededBy: optionalDate,
});

export const inventoryDecisionSchema = z
  .object({ action: z.enum(['issue', 'reject', 'return', 'cancel']), reviewNote: optionalString(300) })
  .superRefine((v, ctx) => {
    if (v.action === 'reject' && !v.reviewNote) ctx.addIssue({ code: 'custom', path: ['reviewNote'], message: 'Give a reason' });
  });

export const inventoryRequestListQuerySchema = paginationSchema.extend({
  scope: z.enum(['mine', 'all']).default('mine'),
  status: csvEnum(INVENTORY_REQUEST_STATUSES),
  itemId: idSchema.optional(),
});
