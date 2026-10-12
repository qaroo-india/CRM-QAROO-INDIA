/**
 * Admissions, their fee schedules and adjustments, and batch placement.
 *
 * Money invariants are enforced twice: in the services (with readable errors)
 * and here as CHECK constraints (as the last line of defence), so a bug in a
 * service cannot persist a fee that does not add up.
 */

import {
  ADMISSION_STATUSES,
  ASSIGNMENT_QUEUE_STATUSES,
  BATCH_ASSIGNMENT_STATUSES,
  BATCH_STATUSES,
  FEE_ADJUSTMENT_TYPES,
  FEE_PLAN_STATUSES,
  FEE_PLAN_TYPES,
  INSTALMENT_KINDS,
  INSTALMENT_STATES,
  type AdmissionStatus,
  type AssignmentQueueStatus,
  type BatchAssignmentStatus,
  type BatchStatus,
  type FeeAdjustmentType,
  type FeePlanStatus,
  type FeePlanType,
  type InstalmentKind,
  type InstalmentState,
} from '@ims/shared';
import {
  check,
  dateOnly,
  enumStr,
  id,
  index,
  inList,
  instant,
  int,
  isDateOnly,
  money,
  ref,
  sql,
  str,
  table,
  timestamps,
  uniqueIndex,
  type AnyColumn,
} from '../dialect';
import { courses, leadSources, students, trainers } from './catalog';
import { leads } from './crm';
import { users } from './users';

export const admissions = table(
  'admissions',
  {
    id: id(),
    admissionNumber: str('admission_number').notNull(),
    studentId: ref('student_id')
      .notNull()
      .references(() => students.id),
    leadId: ref('lead_id').references(() => leads.id),
    /**
     * The lead's source copied at conversion. Editing the lead later must not
     * silently re-attribute a past admission to a different campaign.
     */
    attributedSourceId: ref('attributed_source_id').references(() => leadSources.id),
    courseId: ref('course_id')
      .notNull()
      .references(() => courses.id),
    admissionDate: dateOnly('admission_date').notNull(),

    listFeeMinor: money('list_fee_minor').notNull(),
    discountMinor: money('discount_minor').notNull().default(0),
    agreedFeeMinor: money('agreed_fee_minor').notNull(),
    admissionFeeRequiredMinor: money('admission_fee_required_minor').notNull().default(0),

    counsellorId: ref('counsellor_id').references(() => users.id),
    status: enumStr('status', ADMISSION_STATUSES).$type<AdmissionStatus>().notNull().default('pending_payment'),
    batchStatus: enumStr('batch_status', ASSIGNMENT_QUEUE_STATUSES)
      .$type<AssignmentQueueStatus>()
      .notNull()
      .default('not_assigned'),
    notes: str('notes'),

    // Lifecycle dates make "as of date D" reporting possible.
    activatedOn: dateOnly('activated_on'),
    completedOn: dateOnly('completed_on'),
    withdrawnOn: dateOnly('withdrawn_on'),
    cancelledOn: dateOnly('cancelled_on'),
    statusReason: str('status_reason'),

    /** Replaying a create with the same key returns the original admission. */
    idempotencyKey: str('idempotency_key'),
    createdById: ref('created_by_id').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('admissions_number_unique').on(t.admissionNumber),
    uniqueIndex('admissions_idempotency_unique').on(t.idempotencyKey),
    index('admissions_student_idx').on(t.studentId),
    index('admissions_course_idx').on(t.courseId),
    index('admissions_date_idx').on(t.admissionDate),
    index('admissions_status_idx').on(t.status),
    index('admissions_counsellor_idx').on(t.counsellorId),
    index('admissions_source_idx').on(t.attributedSourceId),
    index('admissions_lead_idx').on(t.leadId),
    check('admissions_status_check', inList(t.status, ADMISSION_STATUSES)),
    check('admissions_batch_status_check', inList(t.batchStatus, ASSIGNMENT_QUEUE_STATUSES)),
    check('admissions_date_format', isDateOnly(t.admissionDate)),
    check('admissions_list_fee_nonneg', sql`${t.listFeeMinor} >= 0`),
    check('admissions_discount_range', sql`${t.discountMinor} >= 0 and ${t.discountMinor} <= ${t.listFeeMinor}`),
    check('admissions_agreed_fee_formula', sql`${t.agreedFeeMinor} = ${t.listFeeMinor} - ${t.discountMinor}`),
    check(
      'admissions_admission_fee_range',
      sql`${t.admissionFeeRequiredMinor} >= 0 and ${t.admissionFeeRequiredMinor} <= ${t.agreedFeeMinor}`,
    ),
    check('admissions_cancelled_dated', sql`(${t.status} = 'cancelled') = (${t.cancelledOn} is not null)`),
    check('admissions_withdrawn_dated', sql`(${t.status} = 'withdrawn') = (${t.withdrawnOn} is not null)`),
    check('admissions_completed_dated', sql`(${t.status} = 'completed') = (${t.completedOn} is not null)`),
  ],
);

/**
 * How an admission will be paid. Restructuring never edits a plan: the old one
 * becomes 'superseded' and a new one is created, so the history survives.
 */
export const feePlans = table(
  'fee_plans',
  {
    id: id(),
    admissionId: ref('admission_id')
      .notNull()
      .references(() => admissions.id),
    planType: enumStr('plan_type', FEE_PLAN_TYPES).$type<FeePlanType>().notNull(),
    totalMinor: money('total_minor').notNull(),
    admissionFeeMinor: money('admission_fee_minor').notNull().default(0),
    instalmentCount: int('instalment_count').notNull().default(0),
    startDate: dateOnly('start_date').notNull(),
    status: enumStr('status', FEE_PLAN_STATUSES).$type<FeePlanStatus>().notNull().default('active'),
    supersededAt: instant('superseded_at'),
    notes: str('notes'),
    createdById: ref('created_by_id').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    index('fee_plans_admission_idx').on(t.admissionId),
    // At most one live plan per admission.
    uniqueIndex('fee_plans_one_active').on(t.admissionId).where(sql`status = 'active'`),
    check('fee_plans_type_check', inList(t.planType, FEE_PLAN_TYPES)),
    check('fee_plans_status_check', inList(t.status, FEE_PLAN_STATUSES)),
    check('fee_plans_total_nonneg', sql`${t.totalMinor} >= 0`),
    check('fee_plans_admission_fee_range', sql`${t.admissionFeeMinor} >= 0 and ${t.admissionFeeMinor} <= ${t.totalMinor}`),
  ],
);

/**
 * One scheduled amount. The amount PAID is deliberately not stored: it is the
 * sum of allocations from succeeded payments, so it can never drift from the
 * receipts that justify it.
 */
export const instalments = table(
  'instalments',
  {
    id: id(),
    feePlanId: ref('fee_plan_id')
      .notNull()
      .references(() => feePlans.id),
    admissionId: ref('admission_id')
      .notNull()
      .references(() => admissions.id),
    sequence: int('sequence').notNull(),
    kind: enumStr('kind', INSTALMENT_KINDS).$type<InstalmentKind>().notNull(),
    dueDate: dateOnly('due_date').notNull(),
    amountMinor: money('amount_minor').notNull(),
    state: enumStr('state', INSTALMENT_STATES).$type<InstalmentState>().notNull().default('active'),
    stateReason: str('state_reason'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('instalments_plan_sequence_unique').on(t.feePlanId, t.sequence),
    index('instalments_admission_due_idx').on(t.admissionId, t.dueDate),
    index('instalments_due_idx').on(t.dueDate),
    check('instalments_kind_check', inList(t.kind, INSTALMENT_KINDS)),
    check('instalments_state_check', inList(t.state, INSTALMENT_STATES)),
    check('instalments_amount_positive', sql`${t.amountMinor} > 0`),
    check('instalments_due_format', isDateOnly(t.dueDate)),
    check('instalments_sequence_positive', sql`${t.sequence} > 0`),
  ],
);

/** Approved reductions after admission: discounts, waivers, write-offs. */
export const feeAdjustments = table(
  'fee_adjustments',
  {
    id: id(),
    admissionId: ref('admission_id')
      .notNull()
      .references(() => admissions.id),
    type: enumStr('type', FEE_ADJUSTMENT_TYPES).$type<FeeAdjustmentType>().notNull(),
    amountMinor: money('amount_minor').notNull(),
    effectiveDate: dateOnly('effective_date').notNull(),
    reason: str('reason').notNull(),
    approvedById: ref('approved_by_id').references(() => users.id),
    voidedAt: instant('voided_at'),
    voidReason: str('void_reason'),
    createdById: ref('created_by_id').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    index('fee_adjustments_admission_idx').on(t.admissionId, t.effectiveDate),
    check('fee_adjustments_type_check', inList(t.type, FEE_ADJUSTMENT_TYPES)),
    check('fee_adjustments_amount_positive', sql`${t.amountMinor} > 0`),
    check('fee_adjustments_date_format', isDateOnly(t.effectiveDate)),
  ],
);

export const batches = table(
  'batches',
  {
    id: id(),
    batchCode: str('batch_code').notNull(),
    name: str('name').notNull(),
    courseId: ref('course_id')
      .notNull()
      .references(() => courses.id),
    trainerId: ref('trainer_id').references(() => trainers.id),
    startDate: dateOnly('start_date').notNull(),
    endDate: dateOnly('end_date'),
    capacity: int('capacity').notNull(),
    schedule: str('schedule'),
    status: enumStr('status', BATCH_STATUSES).$type<BatchStatus>().notNull().default('planned'),
    notes: str('notes'),
    createdById: ref('created_by_id').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('batches_code_unique').on(sql`upper(${t.batchCode})`),
    index('batches_course_idx').on(t.courseId, t.status),
    index('batches_trainer_idx').on(t.trainerId),
    check('batches_status_check', inList(t.status, BATCH_STATUSES)),
    check('batches_capacity_positive', sql`${t.capacity} > 0 and ${t.capacity} <= 1000`),
    check('batches_dates_ordered', sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
    check('batches_start_format', isDateOnly(t.startDate)),
  ],
);

/**
 * Assignment history. A transfer closes the current row ('transferred_out')
 * and opens a new one, so the full path a student took is preserved.
 */
export const batchAssignments = table(
  'batch_assignments',
  {
    id: id(),
    admissionId: ref('admission_id')
      .notNull()
      .references(() => admissions.id),
    studentId: ref('student_id')
      .notNull()
      .references(() => students.id),
    batchId: ref('batch_id')
      .notNull()
      .references(() => batches.id),
    status: enumStr('status', BATCH_ASSIGNMENT_STATUSES).$type<BatchAssignmentStatus>().notNull().default('active'),
    assignedOn: dateOnly('assigned_on').notNull(),
    endedOn: dateOnly('ended_on'),
    transferredToId: ref('transferred_to_id').references((): AnyColumn => batchAssignments.id),
    reason: str('reason'),
    assignedById: ref('assigned_by_id').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    // An admission sits in at most one batch at a time.
    uniqueIndex('batch_assignments_one_active').on(t.admissionId).where(sql`status = 'active'`),
    index('batch_assignments_batch_idx').on(t.batchId, t.status),
    index('batch_assignments_admission_idx').on(t.admissionId),
    check('batch_assignments_status_check', inList(t.status, BATCH_ASSIGNMENT_STATUSES)),
    check('batch_assignments_assigned_format', isDateOnly(t.assignedOn)),
  ],
);

export type Admission = typeof admissions.$inferSelect;
export type FeePlan = typeof feePlans.$inferSelect;
export type Instalment = typeof instalments.$inferSelect;
export type FeeAdjustment = typeof feeAdjustments.$inferSelect;
export type Batch = typeof batches.$inferSelect;
export type BatchAssignment = typeof batchAssignments.$inferSelect;
