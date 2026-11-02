/**
 * The platform's status vocabulary -- the single source of truth shared by the
 * database CHECK constraints, the Zod request validators, and the UI badges.
 *
 * Statuses that drive money or lifecycle decisions live here in code, because a
 * report that groups by status must never encounter a value nobody wrote logic
 * for. Purely descriptive taxonomies that the owner is meant to curate (lead
 * sources, expense categories, job categories) live in database lookup tables
 * instead; the lists below are only their seed values.
 */

/* ------------------------------------------------------------------ *
 * Leads / CRM
 * ------------------------------------------------------------------ */

export const LEAD_STATUSES = [
  'new',
  'contacted',
  'counselling_scheduled',
  'follow_up',
  'interested',
  'converted',
  'not_interested',
  'lost',
  'unreachable',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Ordered stages shown as Kanban columns. Terminal states are excluded. */
export const LEAD_PIPELINE_STAGES = [
  'new',
  'contacted',
  'counselling_scheduled',
  'follow_up',
  'interested',
  'converted',
] as const satisfies readonly LeadStatus[];

/** Reached the end of the funnel without converting -- excluded from "open" counts. */
export const LEAD_CLOSED_LOST_STATUSES = [
  'not_interested',
  'lost',
  'unreachable',
] as const satisfies readonly LeadStatus[];

export const LEAD_PRIORITIES = ['low', 'medium', 'high'] as const;
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];

export const LEAD_ACTIVITY_TYPES = [
  'note',
  'call',
  'email',
  'meeting',
  'status_change',
  'assignment',
  'follow_up_set',
  'conversion',
] as const;
export type LeadActivityType = (typeof LEAD_ACTIVITY_TYPES)[number];

/** Activities a person logs by hand; the rest are written by the system. */
export const MANUAL_LEAD_ACTIVITY_TYPES = ['note', 'call', 'email', 'meeting'] as const;

/** Seed values for the configurable `lead_sources` table. */
export const DEFAULT_LEAD_SOURCES = [
  'Justdial',
  'Google Ads',
  'LinkedIn',
  'Instagram Ads',
  'Facebook Ads',
  'Website',
  'Organic Search',
  'Walk-in',
  'Student Referral',
  'Staff Referral',
  'Phone Enquiry',
  'Email Enquiry',
  'Interview / Counselling',
  'Education Fair',
  'Other',
] as const;

/* ------------------------------------------------------------------ *
 * Admissions
 * ------------------------------------------------------------------ */

export const ADMISSION_STATUSES = [
  'pending_payment',
  'active',
  'completed',
  'withdrawn',
  'cancelled',
] as const;
export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];

/**
 * Admissions that count as live enrolment. `pending_payment` IS included --
 * the student is admitted but has not paid, which is exactly the population the
 * outstanding-fees report exists to surface.
 */
export const ADMISSION_OPEN_STATUSES = [
  'pending_payment',
  'active',
] as const satisfies readonly AdmissionStatus[];

/** Statuses that stop a fee being collectable, so they drop out of receivables. */
export const ADMISSION_VOID_STATUSES = [
  'cancelled',
] as const satisfies readonly AdmissionStatus[];

/* ------------------------------------------------------------------ *
 * Fees, payments, instalments
 * ------------------------------------------------------------------ */

export const FEE_PLAN_TYPES = [
  'full_payment',
  'admission_plus_monthly',
  'admission_plus_flexible',
  'internal_financing',
  'external_financing',
] as const;
export type FeePlanType = (typeof FEE_PLAN_TYPES)[number];

export const PAYMENT_TYPES = [
  'admission_fee',
  'instalment',
  'full_payment',
  'part_payment',
  'loan_disbursement',
  'refund',
  'other',
] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

/** Seed values for the configurable payment-method list. */
export const PAYMENT_METHODS = [
  'cash',
  'upi',
  'bank_transfer',
  'debit_card',
  'credit_card',
  'cheque',
  'finance_disbursement',
  'other',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Transaction lifecycle. Financial rows are append-only: a correction writes a
 * new row and flips the original to `reversed`, so the audit trail survives.
 */
export const TRANSACTION_STATUSES = ['pending', 'succeeded', 'failed', 'reversed'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

/**
 * The ONLY status that may be counted as money received by the institute.
 * Reports must filter on this; `pending` is a promise, not cash.
 */
export const COLLECTABLE_TRANSACTION_STATUS = 'succeeded' as const;

export const INSTALMENT_STATUSES = [
  'scheduled',
  'partially_paid',
  'paid',
  'overdue',
  'waived',
  'cancelled',
] as const;
export type InstalmentStatus = (typeof INSTALMENT_STATUSES)[number];

/** Instalments still expected to bring in cash. */
export const INSTALMENT_DUE_STATUSES = [
  'scheduled',
  'partially_paid',
  'overdue',
] as const satisfies readonly InstalmentStatus[];

/** Money direction on a receipt row. Refunds are separate rows, never negative amounts. */
export const PAYMENT_DIRECTIONS = ['in', 'refund'] as const;
export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number];

/** Stored lifecycle of an instalment row; paid/overdue are derived from allocations. */
export const INSTALMENT_STATES = ['active', 'waived', 'cancelled'] as const;
export type InstalmentState = (typeof INSTALMENT_STATES)[number];

export const INSTALMENT_KINDS = ['admission_fee', 'instalment', 'full_payment', 'loan_disbursement'] as const;
export type InstalmentKind = (typeof INSTALMENT_KINDS)[number];

export const FEE_PLAN_STATUSES = ['active', 'superseded'] as const;
export type FeePlanStatus = (typeof FEE_PLAN_STATUSES)[number];

/** Post-admission reductions of what a student owes. Each needs an approver. */
export const FEE_ADJUSTMENT_TYPES = ['discount', 'waiver', 'write_off'] as const;
export type FeeAdjustmentType = (typeof FEE_ADJUSTMENT_TYPES)[number];

/* ------------------------------------------------------------------ *
 * Financing
 * ------------------------------------------------------------------ */

/**
 * An internal instalment facility is the institute lending its own fee over
 * time; an external loan is a third party paying the institute. They are
 * never interchangeable in a report.
 */
export const FINANCE_TYPES = ['internal_instalment', 'external_loan'] as const;
export type FinanceType = (typeof FINANCE_TYPES)[number];

export const LOAN_STATUSES = [
  'draft',
  'applied',
  'under_review',
  'approved',
  'rejected',
  'cancelled',
] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

/**
 * Approval does NOT mean funded. Disbursement is tracked in its own table, so
 * "approved amount" and "amount actually received" are always distinguishable.
 */
export const LOAN_DISBURSEMENT_STATUSES = [
  'awaiting_disbursement',
  'partially_disbursed',
  'fully_disbursed',
] as const;
export type LoanDisbursementStatus = (typeof LOAN_DISBURSEMENT_STATUSES)[number];

/* ------------------------------------------------------------------ *
 * Batches and delivery
 * ------------------------------------------------------------------ */

export const BATCH_STATUSES = [
  'planned',
  'enrolling',
  'running',
  'completed',
  'cancelled',
] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

/** Batches a student may still be placed into. */
export const BATCH_ASSIGNABLE_STATUSES = [
  'planned',
  'enrolling',
  'running',
] as const satisfies readonly BatchStatus[];

export const ASSIGNMENT_QUEUE_STATUSES = [
  'not_assigned',
  'waiting_for_next_batch',
  'eligible',
  'assigned',
  'transferred',
  'completed',
] as const;
export type AssignmentQueueStatus = (typeof ASSIGNMENT_QUEUE_STATUSES)[number];

export const BATCH_ASSIGNMENT_STATUSES = [
  'active',
  'transferred_out',
  'completed',
  'dropped',
] as const;
export type BatchAssignmentStatus = (typeof BATCH_ASSIGNMENT_STATUSES)[number];

/* ------------------------------------------------------------------ *
 * Placement
 * ------------------------------------------------------------------ */

export const PLACEMENT_TRACKS = ['technical', 'non_technical', 'both'] as const;
export type PlacementTrack = (typeof PLACEMENT_TRACKS)[number];

export const PLACEMENT_STAGES = [
  'eligible',
  'resume_preparation',
  'ready',
  'applied',
  'interview_scheduled',
  'interviewing',
  'selected',
  'rejected',
  'offer_received',
  'joined',
  'on_hold',
  'withdrawn',
  'not_seeking',
] as const;
export type PlacementStage = (typeof PLACEMENT_STAGES)[number];

/**
 * A student counts as PLACED only after joining. Selection or an offer is not
 * placement, and one student with three offers is still one placed student.
 */
export const PLACED_STAGES = ['joined'] as const satisfies readonly PlacementStage[];

/** Excluded from the denominator of a placement rate -- they opted out. */
export const PLACEMENT_EXCLUDED_STAGES = [
  'withdrawn',
  'not_seeking',
] as const satisfies readonly PlacementStage[];

export const APPLICATION_OUTCOMES = [
  'in_progress',
  'selected',
  'rejected',
  'offer_received',
  'offer_declined',
  'joined',
  'withdrawn',
] as const;
export type ApplicationOutcome = (typeof APPLICATION_OUTCOMES)[number];

/** A profile is either technical or non-technical; a course may support both. */
export const PROFILE_TRACKS = ['technical', 'non_technical'] as const;
export type ProfileTrack = (typeof PROFILE_TRACKS)[number];

export const RESUME_STATUSES = ['not_started', 'in_progress', 'ready'] as const;
export type ResumeStatus = (typeof RESUME_STATUSES)[number];

export const INTERVIEW_MODES = ['in_person', 'phone', 'video'] as const;
export type InterviewMode = (typeof INTERVIEW_MODES)[number];

export const INTERVIEW_RESULTS = ['scheduled', 'passed', 'failed', 'no_show', 'cancelled'] as const;
export type InterviewResult = (typeof INTERVIEW_RESULTS)[number];

/** Seed values for the configurable `job_categories` table. */
export const DEFAULT_TECHNICAL_JOB_CATEGORIES = [
  'Software Development',
  'Frontend Development',
  'Backend Development',
  'Full-Stack Development',
  'Software Testing',
  'Data Analytics',
  'IT Support',
  'Cloud and DevOps',
  'Other Technical',
] as const;

export const DEFAULT_NON_TECHNICAL_JOB_CATEGORIES = [
  'HR',
  'Recruitment',
  'Sales',
  'Digital Marketing',
  'Customer Support',
  'Operations',
  'Administration',
  'Business Development',
  'Other Non-Technical',
] as const;

/* ------------------------------------------------------------------ *
 * Expenses
 * ------------------------------------------------------------------ */

export const EXPENSE_APPROVAL_STATUSES = ['recorded', 'pending', 'approved', 'rejected'] as const;
export type ExpenseApprovalStatus = (typeof EXPENSE_APPROVAL_STATUSES)[number];

/** Seed values for the configurable `expense_categories` table. */
export const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent',
  'Salaries',
  'Advertising',
  'Electricity',
  'Internet',
  'Equipment',
  'Software Subscriptions',
  'Training Materials',
  'Maintenance',
  'Travel',
  'Miscellaneous',
] as const;

/* ------------------------------------------------------------------ *
 * Reporting and operations
 * ------------------------------------------------------------------ */

export const REPORT_PERIODS = [
  'today',
  'yesterday',
  'this_week',
  'this_month',
  'previous_month',
  'this_quarter',
  'this_year',
  'custom',
] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const REPORT_FORMATS = ['pdf', 'excel'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'instalment_due',
  'instalment_overdue',
  'follow_up_due',
  'follow_up_missed',
  'new_admission',
  'unassigned_student',
  'batch_capacity',
  'loan_status_change',
  'interview_upcoming',
  'placement_offer',
  'report_failed',
  'email_failed',
  'leave_request',
  'leave_decision',
  'task_assigned',
  'task_due',
  'exam_published',
  'class_scheduled',
  'certificate_update',
  'drive_open',
  'inventory_request',
  'inventory_decision',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_SEVERITIES = ['info', 'success', 'warning', 'error'] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const AUDIT_ACTIONS = [
  'create',
  'update',
  'delete',
  'status_change',
  'reverse',
  'refund',
  'void',
  'approve',
  'reject',
  'login',
  'logout',
  'password_change',
  'export',
  'email',
  'import',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const REPORT_DELIVERY_STATUSES = ['pending', 'sent', 'failed'] as const;
export type ReportDeliveryStatus = (typeof REPORT_DELIVERY_STATUSES)[number];

export const SCHEDULE_CADENCES = ['daily', 'weekly', 'monthly'] as const;
export type ScheduleCadence = (typeof SCHEDULE_CADENCES)[number];

export const DOCUMENT_OWNER_TYPES = [
  'student',
  'admission',
  'loan',
  'expense',
  'placement_application',
  'institute',
] as const;
export type DocumentOwnerType = (typeof DOCUMENT_OWNER_TYPES)[number];

/** Restricted documents (loan paperwork, IDs) need an extra permission to open. */
export const DOCUMENT_ACCESS_LEVELS = ['general', 'restricted'] as const;
export type DocumentAccessLevel = (typeof DOCUMENT_ACCESS_LEVELS)[number];

/* ------------------------------------------------------------------ *
 * People
 * ------------------------------------------------------------------ */

export const GENDERS = ['male', 'female', 'other', 'undisclosed'] as const;
export type Gender = (typeof GENDERS)[number];

/** A student's standing with the institute (separate from any one admission). */
export const STUDENT_STATUSES = ['active', 'inactive', 'graduated', 'suspended'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'visiting', 'intern'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/* ------------------------------------------------------------------ *
 * Teaching
 * ------------------------------------------------------------------ */

export const CLASS_SESSION_KINDS = ['lecture', 'practical', 'revision', 'assessment'] as const;
export type ClassSessionKind = (typeof CLASS_SESSION_KINDS)[number];

export const CLASS_SESSION_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;
export type ClassSessionStatus = (typeof CLASS_SESSION_STATUSES)[number];

/**
 * Attendance marks. `late` and `on_duty` count as attended; `holiday`
 * removes the day from the student's denominator.
 */
export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'on_duty', 'holiday'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const EXAM_KINDS = ['unit_test', 'session_test', 'placement_test'] as const;
export type ExamKind = (typeof EXAM_KINDS)[number];

export const EXAM_STATUSES = ['draft', 'published', 'closed', 'archived'] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];

export const MATERIAL_KINDS = ['notes', 'slides', 'source_code', 'video', 'reference'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const CERTIFICATE_STATUSES = ['requested', 'under_review', 'approved', 'issued', 'rejected'] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];

/* ------------------------------------------------------------------ *
 * Placement drives
 * ------------------------------------------------------------------ */

export const DRIVE_STATUSES = ['planned', 'open', 'closed'] as const;
export type DriveStatus = (typeof DRIVE_STATUSES)[number];

/* ------------------------------------------------------------------ *
 * People operations
 * ------------------------------------------------------------------ */

export const LEAVE_TYPES = ['casual', 'sick', 'earned', 'unpaid', 'maternity', 'paternity'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const INVENTORY_CATEGORIES = ['laptop', 'desktop', 'peripheral', 'furniture', 'software', 'consumable', 'network', 'other'] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

/** An asset's condition; how many are free is tracked by quantity. */
export const INVENTORY_ITEM_STATUSES = ['in_service', 'repair', 'retired'] as const;
export type InventoryItemStatus = (typeof INVENTORY_ITEM_STATUSES)[number];

/**
 * pending -> issued (stock leaves) -> returned (stock comes back)
 * pending -> rejected | cancelled (by the requester)
 * Consumables are never returned.
 */
export const INVENTORY_REQUEST_STATUSES = ['pending', 'issued', 'returned', 'rejected', 'cancelled'] as const;
export type InventoryRequestStatus = (typeof INVENTORY_REQUEST_STATUSES)[number];
