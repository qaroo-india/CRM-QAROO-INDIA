/**
 * Fee plans, payments, refunds, reversals, adjustments and loans.
 *
 * Every amount crossing the API is integer minor units. Form twins accept
 * human input ("12,500.50") through moneyFieldSchema.
 */

import { z } from 'zod';
import {
  FEE_ADJUSTMENT_TYPES,
  FEE_PLAN_TYPES,
  FINANCE_TYPES,
  LOAN_STATUSES,
  PAYMENT_DIRECTIONS,
  PAYMENT_METHODS,
  PAYMENT_TYPES,
  TRANSACTION_STATUSES,
} from '../constants/domain';
import {
  csvEnum,
  dateOnlySchema,
  idSchema,
  moneyMinorSchema,
  nonEmptyString,
  optionalString,
  paginationSchema,
  positiveMoneyFieldSchema,
} from './common';

const positiveMinor = moneyMinorSchema.refine((v) => v > 0, 'amount must be greater than zero');

/* ------------------------------------------------------------------ *
 * Fee plans
 * ------------------------------------------------------------------ */

export const scheduleRowSchema = z.object({
  dueDate: dateOnlySchema,
  amountMinor: positiveMinor,
});

export const feePlanSchema = z
  .object({
    planType: z.enum(FEE_PLAN_TYPES),
    /** When the admission fee (or the single full payment) is due. */
    startDate: dateOnlySchema,
    /** Monthly plans: number of equal instalments after the admission fee. */
    instalmentCount: z.number().int().min(1).max(60).optional(),
    /** Monthly plans: due date of the first instalment; the rest follow monthly. */
    firstDueDate: dateOnlySchema.optional(),
    /** Flexible plans: explicit rows summing to the balance after the admission fee. */
    schedule: z.array(scheduleRowSchema).max(60).optional(),
    /** External financing: when the lender is expected to pay. */
    expectedDisbursementDate: dateOnlySchema.optional(),
    notes: optionalString(1000),
  })
  .superRefine((plan, ctx) => {
    const monthly = plan.planType === 'admission_plus_monthly' || plan.planType === 'internal_financing';
    if (monthly) {
      if (!plan.instalmentCount) ctx.addIssue({ code: 'custom', path: ['instalmentCount'], message: 'How many monthly instalments?' });
      if (!plan.firstDueDate) ctx.addIssue({ code: 'custom', path: ['firstDueDate'], message: 'When is the first instalment due?' });
      else if (plan.firstDueDate < plan.startDate) {
        ctx.addIssue({ code: 'custom', path: ['firstDueDate'], message: 'The first instalment cannot fall before the start date' });
      }
    }
    if (plan.planType === 'admission_plus_flexible') {
      if (!plan.schedule?.length) ctx.addIssue({ code: 'custom', path: ['schedule'], message: 'Add at least one instalment' });
      plan.schedule?.forEach((row, index) => {
        if (row.dueDate < plan.startDate) {
          ctx.addIssue({ code: 'custom', path: ['schedule', index, 'dueDate'], message: 'Due date cannot fall before the start date' });
        }
      });
    }
    if (plan.planType === 'external_financing') {
      if (!plan.expectedDisbursementDate) {
        ctx.addIssue({ code: 'custom', path: ['expectedDisbursementDate'], message: 'When is the lender expected to pay?' });
      } else if (plan.expectedDisbursementDate < plan.startDate) {
        ctx.addIssue({ code: 'custom', path: ['expectedDisbursementDate'], message: 'Cannot fall before the start date' });
      }
    }
  });
export type FeePlanInput = z.input<typeof feePlanSchema>;

/* ------------------------------------------------------------------ *
 * Payments
 * ------------------------------------------------------------------ */

export const allocationInputSchema = z.object({
  instalmentId: idSchema,
  amountMinor: positiveMinor,
});

const paymentBase = z.object({
  admissionId: idSchema,
  paymentDate: dateOnlySchema,
  method: z.enum(PAYMENT_METHODS),
  paymentType: z.enum(PAYMENT_TYPES).optional(),
  referenceNumber: optionalString(120),
  notes: optionalString(1000),
  /** Manual allocation; omitted = oldest unpaid instalment first. */
  allocations: z.array(allocationInputSchema).max(60).optional(),
});

function referenceRule<T extends { method: string; referenceNumber?: string }>(value: T, ctx: z.RefinementCtx) {
  if (['cheque', 'bank_transfer'].includes(value.method) && !value.referenceNumber) {
    ctx.addIssue({ code: 'custom', path: ['referenceNumber'], message: 'Enter the cheque or transfer reference' });
  }
}

export const paymentCreateSchema = paymentBase.extend({ amountMinor: positiveMinor }).superRefine(referenceRule);
export type PaymentCreateInput = z.input<typeof paymentCreateSchema>;

export const paymentCreateFormSchema = paymentBase.extend({ amountMinor: positiveMoneyFieldSchema }).superRefine(referenceRule);

export const reversalSchema = z.object({
  reason: nonEmptyString(500, 'Reason').refine((v) => v.length >= 3, 'Give a reason for the audit trail'),
});

export const refundSchema = z
  .object({
    amountMinor: positiveMinor,
    paymentDate: dateOnlySchema,
    method: z.enum(PAYMENT_METHODS),
    referenceNumber: optionalString(120),
    reason: nonEmptyString(500, 'Reason'),
    /** Optional: the receipt being refunded. */
    refundOfId: idSchema.optional(),
  })
  .superRefine(referenceRule);

export const refundFormSchema = z
  .object({
    amountMinor: positiveMoneyFieldSchema,
    paymentDate: dateOnlySchema,
    method: z.enum(PAYMENT_METHODS),
    referenceNumber: optionalString(120),
    reason: nonEmptyString(500, 'Reason'),
    refundOfId: idSchema.optional(),
  })
  .superRefine(referenceRule);

export const paymentListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  method: csvEnum(PAYMENT_METHODS),
  status: csvEnum(TRANSACTION_STATUSES),
  direction: z.enum(PAYMENT_DIRECTIONS).optional(),
  courseId: idSchema.optional(),
  recordedById: idSchema.optional(),
  admissionId: idSchema.optional(),
  studentId: idSchema.optional(),
});

/* ------------------------------------------------------------------ *
 * Adjustments
 * ------------------------------------------------------------------ */

export const adjustmentSchema = z.object({
  type: z.enum(FEE_ADJUSTMENT_TYPES),
  amountMinor: positiveMinor,
  effectiveDate: dateOnlySchema,
  reason: nonEmptyString(500, 'Reason'),
});

export const adjustmentFormSchema = adjustmentSchema.extend({ amountMinor: positiveMoneyFieldSchema });

/* ------------------------------------------------------------------ *
 * Instalments
 * ------------------------------------------------------------------ */

export const INSTALMENT_VIEWS = ['overdue', 'due_soon', 'upcoming', 'partially_paid', 'paid', 'all_open'] as const;

export const instalmentListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  view: z.enum(INSTALMENT_VIEWS).optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  courseId: idSchema.optional(),
  admissionId: idSchema.optional(),
});

/* ------------------------------------------------------------------ *
 * Loans
 * ------------------------------------------------------------------ */

export const loanCreateSchema = z.object({
  admissionId: idSchema,
  financeType: z.enum(FINANCE_TYPES),
  providerName: nonEmptyString(160, 'Provider'),
  applicationReference: optionalString(120),
  requestedMinor: positiveMinor,
  notes: optionalString(2000),
});

export const loanCreateFormSchema = loanCreateSchema.extend({ requestedMinor: positiveMoneyFieldSchema });

export const loanUpdateSchema = loanCreateSchema.omit({ admissionId: true });
export const loanUpdateFormSchema = loanCreateFormSchema.omit({ admissionId: true });

/** Transitions a person may make; 'draft' is only the starting state. */
export const LOAN_STATUS_ACTIONS = LOAN_STATUSES.filter((s) => s !== 'draft') as Exclude<(typeof LOAN_STATUSES)[number], 'draft'>[];

export const loanStatusSchema = z
  .object({
    status: z.enum(LOAN_STATUS_ACTIONS as [string, ...string[]]),
    date: dateOnlySchema,
    approvedMinor: moneyMinorSchema.optional(),
    rejectionReason: optionalString(500),
    note: optionalString(1000),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'approved' && value.approvedMinor === undefined) {
      ctx.addIssue({ code: 'custom', path: ['approvedMinor'], message: 'Enter the approved amount' });
    }
    if (value.status === 'rejected' && !value.rejectionReason) {
      ctx.addIssue({ code: 'custom', path: ['rejectionReason'], message: 'Record why it was rejected' });
    }
  });

export const disbursementSchema = z.object({
  disbursedOn: dateOnlySchema,
  amountMinor: positiveMinor,
  reference: optionalString(120),
  notes: optionalString(1000),
  /**
   * True only when the money has actually reached the institute's account.
   * Then a receipt is recorded and the amount counts as collected.
   */
  receivedByInstitute: z.boolean().default(false),
});

export const disbursementFormSchema = disbursementSchema.extend({ amountMinor: positiveMoneyFieldSchema });

export const loanListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  status: csvEnum(LOAN_STATUSES),
  financeType: z.enum(FINANCE_TYPES).optional(),
  provider: z.string().trim().max(160).optional(),
  admissionId: idSchema.optional(),
  studentId: idSchema.optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
