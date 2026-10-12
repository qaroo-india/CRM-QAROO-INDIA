/**
 * Expenses, trainers, batches and batch assignment.
 */

import { z } from 'zod';
import { BATCH_STATUSES, EXPENSE_APPROVAL_STATUSES, PAYMENT_METHODS } from '../constants/domain';
import {
  csvEnum,
  dateOnlySchema,
  emailSchema,
  idSchema,
  moneyMinorSchema,
  nonEmptyString,
  optionalString,
  paginationSchema,
  positiveMoneyFieldSchema,
} from './common';

/* ------------------------------------------------------------------ *
 * Expenses
 * ------------------------------------------------------------------ */

const expenseBase = z.object({
  expenseDate: dateOnlySchema,
  categoryId: idSchema,
  description: nonEmptyString(500, 'Description'),
  paymentMethod: z.enum(PAYMENT_METHODS),
  payee: optionalString(160),
  referenceNumber: optionalString(120),
});

export const expenseSchema = expenseBase.extend({ amountMinor: moneyMinorSchema.refine((v) => v > 0, 'amount must be greater than zero') });
export type ExpenseInput = z.input<typeof expenseSchema>;
export const expenseFormSchema = expenseBase.extend({ amountMinor: positiveMoneyFieldSchema });

export const expenseDecisionSchema = z
  .object({ decision: z.enum(['approve', 'reject']), reason: optionalString(500) })
  .superRefine((v, ctx) => {
    if (v.decision === 'reject' && !v.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Give a reason for rejecting' });
  });

export const expenseListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  categoryId: idSchema.optional(),
  status: csvEnum(EXPENSE_APPROVAL_STATUSES),
  method: z.enum(PAYMENT_METHODS).optional(),
  recordedById: idSchema.optional(),
  includeVoided: z.enum(['true', 'false']).optional(),
});

/* ------------------------------------------------------------------ *
 * Trainers and batches
 * ------------------------------------------------------------------ */

const optionalEmail = z
  .union([z.literal(''), z.null(), z.undefined(), emailSchema])
  .optional()
  .transform((v) => (v ? v : undefined));

export const trainerSchema = z.object({
  name: nonEmptyString(120, 'Name'),
  email: optionalEmail,
  phone: optionalString(30),
  expertise: optionalString(300),
  isActive: z.boolean().default(true),
});

export const batchSchema = z
  .object({
    batchCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,23}$/, 'Use 2-24 letters, digits or dashes'),
    name: nonEmptyString(160, 'Name'),
    courseId: idSchema,
    trainerId: z
      .union([z.literal(''), z.null(), idSchema])
      .optional()
      .transform((v) => (v ? v : null)),
    startDate: dateOnlySchema,
    endDate: z
      .union([z.literal(''), z.null(), dateOnlySchema])
      .optional()
      .transform((v) => (v ? v : null)),
    capacity: z.coerce.number().int().min(1, 'At least one seat').max(1000),
    schedule: optionalString(200),
    status: z.enum(BATCH_STATUSES).default('planned'),
    notes: optionalString(2000),
  })
  .superRefine((v, ctx) => {
    if (v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Cannot end before it starts' });
  });
export type BatchInput = z.input<typeof batchSchema>;

export const batchListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  courseId: idSchema.optional(),
  trainerId: idSchema.optional(),
  status: csvEnum(BATCH_STATUSES),
});

export const assignSchema = z.object({
  batchId: idSchema,
  admissionIds: z.array(idSchema).min(1, 'Choose at least one student').max(200),
  assignedOn: dateOnlySchema,
  /** Owner-only override of the capacity limit, recorded in the audit trail. */
  allowOverCapacity: z.boolean().default(false),
});

export const transferSchema = z.object({
  toBatchId: idSchema,
  date: dateOnlySchema,
  reason: nonEmptyString(500, 'Reason'),
});

export const queueStatusSchema = z.object({
  batchStatus: z.enum(['not_assigned', 'waiting_for_next_batch', 'eligible']),
});

export const queueQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  courseId: idSchema.optional(),
  batchStatus: z.enum(['not_assigned', 'waiting_for_next_batch', 'eligible']).optional(),
});
