/**
 * Courses, leads, students and admissions.
 *
 * Each API schema takes money as integer minor units. Its *Form twin swaps
 * the money fields for moneyFieldSchema, so a form accepts "1,25,000.50" and
 * submits exact paise -- the same object the API then validates.
 */

import { z } from 'zod';
import {
  ADMISSION_STATUSES,
  ASSIGNMENT_QUEUE_STATUSES,
  LEAD_PRIORITIES,
  LEAD_STATUSES,
  MANUAL_LEAD_ACTIVITY_TYPES,
  PLACEMENT_TRACKS,
  GENDERS,
  STUDENT_STATUSES,
} from '../constants/domain';
import {
  csvEnum,
  dateOnlySchema,
  emailSchema,
  idSchema,
  moneyFieldSchema,
  moneyMinorSchema,
  nonEmptyString,
  optionalMoneyFieldSchema,
  optionalString,
  paginationSchema,
  phoneSchema,
} from './common';
import { feePlanSchema } from './finance';

export const optionalEmail = z
  .union([z.literal(''), z.null(), z.undefined(), emailSchema])
  .optional()
  .transform((value) => (value ? value : undefined));

export const optionalId = z
  .union([z.literal(''), z.null(), z.undefined(), idSchema])
  .optional()
  .transform((value) => (value ? value : undefined));

export const optionalDate = z
  .union([z.literal(''), z.null(), z.undefined(), dateOnlySchema])
  .optional()
  .transform((value) => (value ? value : undefined));

export const optionalPhone = z
  .union([z.literal(''), z.null(), z.undefined(), phoneSchema])
  .optional()
  .transform((value) => (value ? value : undefined));

/* ------------------------------------------------------------------ *
 * Courses
 * ------------------------------------------------------------------ */

const courseBase = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, 'Use 2-20 letters, digits or dashes'),
  name: nonEmptyString(160, 'Course name'),
  description: optionalString(2000),
  durationWeeks: z
    .union([z.literal(''), z.null(), z.undefined(), z.coerce.number().int().min(1).max(520)])
    .optional()
    .transform((v) => (v === '' || v === null ? undefined : v)),
  modules: z.array(z.string().trim().min(1).max(120)).max(60).default([]),
  placementTrack: z
    .union([z.enum(PLACEMENT_TRACKS), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v ? v : null)),
  defaultInstalmentCount: z
    .union([z.literal(''), z.null(), z.undefined(), z.coerce.number().int().min(0).max(60)])
    .optional()
    .transform((v) => (v === '' || v === null ? undefined : v)),
  isActive: z.boolean().default(true),
});

function courseFeeRule<T extends { standardFeeMinor: number; defaultAdmissionFeeMinor?: number }>(value: T, ctx: z.RefinementCtx) {
  if (value.defaultAdmissionFeeMinor !== undefined && value.defaultAdmissionFeeMinor > value.standardFeeMinor) {
    ctx.addIssue({ code: 'custom', path: ['defaultAdmissionFeeMinor'], message: 'Admission fee cannot exceed the course fee' });
  }
}

export const courseSchema = courseBase
  .extend({
    standardFeeMinor: moneyMinorSchema,
    defaultAdmissionFeeMinor: moneyMinorSchema.optional(),
  })
  .superRefine(courseFeeRule);
export type CourseInput = z.input<typeof courseSchema>;

export const courseFormSchema = courseBase
  .extend({
    standardFeeMinor: moneyFieldSchema,
    defaultAdmissionFeeMinor: optionalMoneyFieldSchema,
  })
  .superRefine(courseFeeRule);

export const courseListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  active: z.enum(['true', 'false']).optional(),
  track: z.enum(PLACEMENT_TRACKS).optional(),
});

/* ------------------------------------------------------------------ *
 * Leads
 * ------------------------------------------------------------------ */

export const leadSchema = z.object({
  name: nonEmptyString(120, 'Name'),
  phone: phoneSchema,
  email: optionalEmail,
  enquiryDate: dateOnlySchema,
  leadSourceId: idSchema,
  campaignName: optionalString(160),
  adReference: optionalString(160),
  utmSource: optionalString(120),
  utmMedium: optionalString(120),
  utmCampaign: optionalString(160),
  utmTerm: optionalString(160),
  utmContent: optionalString(160),
  interestedCourseId: optionalId,
  counsellorId: optionalId,
  followUpDate: optionalDate,
  priority: z.enum(LEAD_PRIORITIES).default('medium'),
  notes: optionalString(4000),
});
export type LeadInput = z.input<typeof leadSchema>;

/** Full replace (PUT): the form always sends the complete lead, so a cleared field clears. */
export const leadUpdateSchema = leadSchema;

/** Statuses a person may set directly. 'converted' happens only by registering an admission. */
export const MANUAL_LEAD_STATUSES = LEAD_STATUSES.filter((s) => s !== 'converted') as Exclude<
  (typeof LEAD_STATUSES)[number],
  'converted'
>[];

export const leadStatusChangeSchema = z
  .object({
    status: z.enum(MANUAL_LEAD_STATUSES as [string, ...string[]]),
    lostReason: optionalString(500),
    note: optionalString(2000),
    followUpDate: optionalDate,
  })
  .superRefine((value, ctx) => {
    if (['lost', 'not_interested'].includes(value.status) && !value.lostReason) {
      ctx.addIssue({ code: 'custom', path: ['lostReason'], message: 'Give a reason so the lead can be analysed later' });
    }
  });

export const leadActivitySchema = z.object({
  type: z.enum(MANUAL_LEAD_ACTIVITY_TYPES),
  note: nonEmptyString(4000, 'Note'),
  followUpDate: optionalDate,
});

export const bulkAssignSchema = z.object({
  leadIds: z.array(idSchema).min(1, 'Select at least one lead').max(500),
  counsellorId: idSchema,
});

export const FOLLOW_UP_FILTERS = ['overdue', 'today', 'upcoming', 'none'] as const;

export const leadListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  status: csvEnum(LEAD_STATUSES),
  sourceId: idSchema.optional(),
  courseId: idSchema.optional(),
  counsellorId: z.union([idSchema, z.literal('unassigned')]).optional(),
  priority: z.enum(LEAD_PRIORITIES).optional(),
  followUp: z.enum(FOLLOW_UP_FILTERS).optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  /** Follow-up calendar window. */
  followUpFrom: dateOnlySchema.optional(),
  followUpTo: dateOnlySchema.optional(),
});

export const duplicateQuerySchema = z.object({
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().max(200).optional(),
  excludeId: idSchema.optional(),
});

/* ------------------------------------------------------------------ *
 * Students
 * ------------------------------------------------------------------ */

export const studentSchema = z.object({
  fullName: nonEmptyString(160, 'Full name'),
  phone: phoneSchema,
  email: optionalEmail,
  address: optionalString(500),
  city: optionalString(120),
  dateOfBirth: optionalDate,
  emergencyContactName: optionalString(120),
  emergencyContactPhone: optionalPhone,
  notes: optionalString(4000),
  gender: z
    .union([z.literal(''), z.null(), z.undefined(), z.enum(GENDERS)])
    .optional()
    .transform((v) => (v ? v : undefined)),
  qualification: optionalString(120),
  yearOfPassing: z
    .union([z.literal(''), z.null(), z.undefined(), z.coerce.number().int().min(1950, 'Enter a year from 1950').max(2100)])
    .optional()
    .transform((v) => (v === '' || v === null ? undefined : v)),
  state: optionalString(80),
  pincode: z
    .union([z.literal(''), z.null(), z.undefined(), z.string().trim().regex(/^[0-9A-Za-z -]{3,10}$/, 'Enter a valid PIN / postal code')])
    .optional()
    .transform((v) => (v ? v : undefined)),
  guardianName: optionalString(120),
  guardianPhone: optionalPhone,
  status: z.enum(STUDENT_STATUSES).default('active'),
});
export type StudentInput = z.input<typeof studentSchema>;

/** Full replace (PUT), for the same reason as leads. */
export const studentUpdateSchema = studentSchema;

export const studentListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  courseId: idSchema.optional(),
  admissionStatus: z.enum(ADMISSION_STATUSES).optional(),
});

/* ------------------------------------------------------------------ *
 * Admissions
 * ------------------------------------------------------------------ */

const admissionBase = z.object({
  leadId: optionalId,
  studentId: optionalId,
  newStudent: studentSchema.optional(),
  /** Confirms a new student despite a phone/email match. */
  allowDuplicate: z.boolean().default(false),
  courseId: idSchema,
  admissionDate: dateOnlySchema,
  counsellorId: optionalId,
  notes: optionalString(4000),
  /** Optional payment plan, created in the same transaction as the admission. */
  feePlan: feePlanSchema.optional(),
});

function admissionFeeRules<
  T extends { studentId?: string; newStudent?: unknown; listFeeMinor: number; discountMinor: number; admissionFeeRequiredMinor: number },
>(value: T, ctx: z.RefinementCtx) {
  if (!value.studentId === !value.newStudent) {
    ctx.addIssue({ code: 'custom', path: ['studentId'], message: 'Choose an existing student or enter a new one' });
  }
  if (value.discountMinor > value.listFeeMinor) {
    ctx.addIssue({ code: 'custom', path: ['discountMinor'], message: 'Discount cannot exceed the course fee' });
  }
  if (value.admissionFeeRequiredMinor > value.listFeeMinor - value.discountMinor) {
    ctx.addIssue({ code: 'custom', path: ['admissionFeeRequiredMinor'], message: 'Admission fee cannot exceed the agreed fee' });
  }
}

export const admissionCreateSchema = admissionBase
  .extend({
    listFeeMinor: moneyMinorSchema,
    discountMinor: moneyMinorSchema.default(0),
    admissionFeeRequiredMinor: moneyMinorSchema.default(0),
  })
  .superRefine(admissionFeeRules);
export type AdmissionCreateInput = z.input<typeof admissionCreateSchema>;

export const admissionCreateFormSchema = admissionBase
  .extend({
    listFeeMinor: moneyFieldSchema,
    discountMinor: moneyFieldSchema,
    admissionFeeRequiredMinor: moneyFieldSchema,
  })
  .superRefine(admissionFeeRules);

export const admissionUpdateSchema = z.object({
  counsellorId: optionalId.nullable(),
  notes: optionalString(4000).nullable(),
});

export const ADMISSION_ACTIONS = ['activate', 'complete', 'withdraw', 'cancel'] as const;

export const admissionStatusChangeSchema = z
  .object({
    action: z.enum(ADMISSION_ACTIONS),
    date: dateOnlySchema,
    reason: optionalString(1000),
    /** On withdrawal: write the unpaid balance off instead of leaving it receivable. */
    writeOffBalance: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if ((value.action === 'withdraw' || value.action === 'cancel') && !value.reason) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'A reason is required' });
    }
  });

export const admissionListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  status: csvEnum(ADMISSION_STATUSES),
  courseId: idSchema.optional(),
  counsellorId: idSchema.optional(),
  sourceId: z.union([idSchema, z.literal('unattributed')]).optional(),
  batchStatus: z.enum(ASSIGNMENT_QUEUE_STATUSES).optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  studentId: idSchema.optional(),
  /** Only admissions with an unpaid balance. */
  outstanding: z.enum(['true']).optional(),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
});
