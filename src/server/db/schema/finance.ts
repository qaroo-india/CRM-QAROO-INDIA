/**
 * The money ledger: receipts, their allocation to instalments, loans and
 * their disbursements, and expenses.
 *
 * Append-only by design. No financial row is ever deleted or has its amount
 * edited. A mistake is corrected by reversing (status -> 'reversed', with who,
 * when and why) and recording a fresh row, so every report can be re-derived
 * and every change explained.
 */

import {
  EXPENSE_APPROVAL_STATUSES,
  FINANCE_TYPES,
  LOAN_STATUSES,
  PAYMENT_DIRECTIONS,
  PAYMENT_METHODS,
  PAYMENT_TYPES,
  TRANSACTION_STATUSES,
  type ExpenseApprovalStatus,
  type FinanceType,
  type LoanStatus,
  type PaymentDirection,
  type PaymentMethod,
  type PaymentType,
  type TransactionStatus,
} from '@ims/shared';
import {
  check,
  dateOnly,
  enumStr,
  id,
  index,
  inList,
  instant,
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
import { expenseCategories, students } from './catalog';
import { admissions, instalments } from './enrolment';
import { documents } from './operations';
import { users } from './users';

export const payments = table(
  'payments',
  {
    id: id(),
    receiptNumber: str('receipt_number').notNull(),
    /**
     * Client-supplied key. A retried "record payment" request with the same
     * key returns the original receipt instead of booking the money twice.
     */
    idempotencyKey: str('idempotency_key'),
    /** Hash of the original request body, to reject a key reused for different data. */
    requestHash: str('request_hash'),

    studentId: ref('student_id')
      .notNull()
      .references(() => students.id),
    admissionId: ref('admission_id')
      .notNull()
      .references(() => admissions.id),
    paymentDate: dateOnly('payment_date').notNull(),
    amountMinor: money('amount_minor').notNull(),
    direction: enumStr('direction', PAYMENT_DIRECTIONS).$type<PaymentDirection>().notNull().default('in'),
    paymentType: enumStr('payment_type', PAYMENT_TYPES).$type<PaymentType>().notNull(),
    method: enumStr('method', PAYMENT_METHODS).$type<PaymentMethod>().notNull(),
    referenceNumber: str('reference_number'),
    notes: str('notes'),

    status: enumStr('status', TRANSACTION_STATUSES).$type<TransactionStatus>().notNull().default('succeeded'),
    reversedAt: instant('reversed_at'),
    reversedById: ref('reversed_by_id').references(() => users.id),
    reversalReason: str('reversal_reason'),
    /** For refunds: the receipt being refunded, when it is a specific one. */
    refundOfId: ref('refund_of_id').references((): AnyColumn => payments.id),

    recordedById: ref('recorded_by_id').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('payments_receipt_unique').on(t.receiptNumber),
    uniqueIndex('payments_idempotency_unique').on(t.idempotencyKey),
    index('payments_date_idx').on(t.status, t.paymentDate),
    index('payments_admission_idx').on(t.admissionId),
    index('payments_student_idx').on(t.studentId),
    index('payments_recorded_by_idx').on(t.recordedById),
    check('payments_amount_positive', sql`${t.amountMinor} > 0`),
    check('payments_direction_check', inList(t.direction, PAYMENT_DIRECTIONS)),
    check('payments_type_check', inList(t.paymentType, PAYMENT_TYPES)),
    check('payments_method_check', inList(t.method, PAYMENT_METHODS)),
    check('payments_status_check', inList(t.status, TRANSACTION_STATUSES)),
    check('payments_date_format', isDateOnly(t.paymentDate)),
    check('payments_reversal_consistent', sql`(${t.status} = 'reversed') = (${t.reversedAt} is not null)`),
    check('payments_refund_direction', sql`${t.refundOfId} is null or ${t.direction} = 'refund'`),
  ],
);

/**
 * How one receipt was applied. A single payment may cover several
 * instalments; `instalmentId` is null for money applied to the admission
 * without a schedule row (or for a refund). Σ allocations = payment amount.
 */
export const paymentAllocations = table(
  'payment_allocations',
  {
    id: id(),
    paymentId: ref('payment_id')
      .notNull()
      .references(() => payments.id),
    admissionId: ref('admission_id')
      .notNull()
      .references(() => admissions.id),
    instalmentId: ref('instalment_id').references(() => instalments.id),
    amountMinor: money('amount_minor').notNull(),
    createdAt: instant('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('payment_allocations_payment_idx').on(t.paymentId),
    index('payment_allocations_instalment_idx').on(t.instalmentId),
    index('payment_allocations_admission_idx').on(t.admissionId),
    check('payment_allocations_amount_positive', sql`${t.amountMinor} > 0`),
  ],
);

/**
 * An internal instalment facility or an external loan for one admission.
 * Requested and approved amounts are lender facts; they are never cash.
 */
export const loans = table(
  'loans',
  {
    id: id(),
    admissionId: ref('admission_id')
      .notNull()
      .references(() => admissions.id),
    studentId: ref('student_id')
      .notNull()
      .references(() => students.id),
    financeType: enumStr('finance_type', FINANCE_TYPES).$type<FinanceType>().notNull(),
    providerName: str('provider_name').notNull(),
    applicationReference: str('application_reference'),
    requestedMinor: money('requested_minor').notNull(),
    approvedMinor: money('approved_minor'),
    status: enumStr('status', LOAN_STATUSES).$type<LoanStatus>().notNull().default('draft'),
    appliedOn: dateOnly('applied_on'),
    decisionOn: dateOnly('decision_on'),
    rejectionReason: str('rejection_reason'),
    notes: str('notes'),
    createdById: ref('created_by_id').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    index('loans_admission_idx').on(t.admissionId),
    index('loans_status_idx').on(t.status),
    index('loans_provider_idx').on(t.providerName),
    check('loans_type_check', inList(t.financeType, FINANCE_TYPES)),
    check('loans_status_check', inList(t.status, LOAN_STATUSES)),
    check('loans_requested_positive', sql`${t.requestedMinor} > 0`),
    check('loans_approved_nonneg', sql`${t.approvedMinor} is null or ${t.approvedMinor} >= 0`),
    check('loans_approval_has_amount', sql`${t.status} <> 'approved' or ${t.approvedMinor} is not null`),
  ],
);

/**
 * Money a lender reports as released. It becomes cash RECEIVED by the
 * institute only through `paymentId`: a succeeded receipt in the ledger.
 */
export const loanDisbursements = table(
  'loan_disbursements',
  {
    id: id(),
    loanId: ref('loan_id')
      .notNull()
      .references(() => loans.id),
    disbursedOn: dateOnly('disbursed_on').notNull(),
    amountMinor: money('amount_minor').notNull(),
    reference: str('reference'),
    paymentId: ref('payment_id').references(() => payments.id),
    notes: str('notes'),
    recordedById: ref('recorded_by_id').references(() => users.id),
    createdAt: instant('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('loan_disbursements_loan_idx').on(t.loanId),
    uniqueIndex('loan_disbursements_payment_unique').on(t.paymentId),
    check('loan_disbursements_amount_positive', sql`${t.amountMinor} > 0`),
    check('loan_disbursements_date_format', isDateOnly(t.disbursedOn)),
  ],
);

export const expenses = table(
  'expenses',
  {
    id: id(),
    expenseCode: str('expense_code').notNull(),
    expenseDate: dateOnly('expense_date').notNull(),
    categoryId: ref('category_id')
      .notNull()
      .references(() => expenseCategories.id),
    description: str('description').notNull(),
    amountMinor: money('amount_minor').notNull(),
    paymentMethod: enumStr('payment_method', PAYMENT_METHODS).$type<PaymentMethod>().notNull(),
    payee: str('payee'),
    referenceNumber: str('reference_number'),
    receiptDocumentId: ref('receipt_document_id').references(() => documents.id),

    approvalStatus: enumStr('approval_status', EXPENSE_APPROVAL_STATUSES)
      .$type<ExpenseApprovalStatus>()
      .notNull()
      .default('recorded'),
    approvedById: ref('approved_by_id').references(() => users.id),
    approvedAt: instant('approved_at'),
    rejectionReason: str('rejection_reason'),

    voidedAt: instant('voided_at'),
    voidedById: ref('voided_by_id').references(() => users.id),
    voidReason: str('void_reason'),

    recordedById: ref('recorded_by_id').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('expenses_code_unique').on(t.expenseCode),
    index('expenses_date_idx').on(t.expenseDate),
    index('expenses_category_idx').on(t.categoryId),
    index('expenses_status_idx').on(t.approvalStatus),
    check('expenses_amount_positive', sql`${t.amountMinor} > 0`),
    check('expenses_status_check', inList(t.approvalStatus, EXPENSE_APPROVAL_STATUSES)),
    check('expenses_method_check', inList(t.paymentMethod, PAYMENT_METHODS)),
    check('expenses_date_format', isDateOnly(t.expenseDate)),
    check('expenses_void_consistent', sql`(${t.voidedAt} is null) = (${t.voidReason} is null)`),
  ],
);

export type Payment = typeof payments.$inferSelect;
export type PaymentAllocation = typeof paymentAllocations.$inferSelect;
export type Loan = typeof loans.$inferSelect;
export type LoanDisbursement = typeof loanDisbursements.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
