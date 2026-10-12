/**
 * Receipts, refunds and reversals -- the append-only money ledger.
 *
 * Recording a payment is ONE synchronous transaction: overpayment check,
 * allocation to instalments, receipt number, admission activation and audit
 * entry either all commit or none do. better-sqlite3 transactions cannot
 * interleave, so two cashiers recording payments for the same student at the
 * same moment cannot both pass the "is it more than outstanding?" check.
 *
 * Nothing here ever deletes or edits an amount:
 *   - a mistake is REVERSED (status -> 'reversed', with who/when/why); it then
 *     drops out of every total;
 *   - money given back is a separate REFUND row, shown separately in reports.
 */

import { createHash } from 'node:crypto';
import {
  formatMoney,
  paymentCreateSchema,
  paymentListQuerySchema,
  refundSchema,
  reversalSchema,
  amountInWords,
  type PaymentDto,
  type PaymentList,
  type ReceiptDto,
} from '@ims/shared';
import { and, asc, count, desc, eq, inArray, isNull, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';
import { db } from '../../db';
import { admissions, courses, feeAdjustments, instalments, paymentAllocations, payments, students, users, type Payment } from '../../db/schema';
import type { DbLike, Tx } from '../../db/types';
import { recordAudit } from '../../services/audit';
import { nextCode } from '../../services/sequences';
import { getSettings } from '../../services/settings';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { containsText, pageWindow, paginated } from '../../utils/pagination';
import { activateIfFeeCovered, getAdmission, getAdmissionRow } from '../admissions/admissions.service';
import { toInstituteInfo } from '../users/serialize';
import { openInstalments } from './feePlans.service';
import { paymentHooks } from './hooks';

const recorder = alias(users, 'recorder');
const reverser = alias(users, 'reverser');

/** Prefix for refund vouchers; they share nothing with receipt numbering. */
const REFUND_PREFIX = 'RFD';

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

export function paymentQuery(database: DbLike = db) {
  return database
    .select({
      payment: payments,
      studentName: students.fullName,
      studentCode: students.studentCode,
      admissionNumber: admissions.admissionNumber,
      courseName: courses.name,
      recordedByName: recorder.name,
      reversedByName: reverser.name,
    })
    .from(payments)
    .innerJoin(students, eq(students.id, payments.studentId))
    .innerJoin(admissions, eq(admissions.id, payments.admissionId))
    .innerJoin(courses, eq(courses.id, admissions.courseId))
    .leftJoin(recorder, eq(recorder.id, payments.recordedById))
    .leftJoin(reverser, eq(reverser.id, payments.reversedById));
}

type PaymentRow = Awaited<ReturnType<ReturnType<typeof paymentQuery>['all']>>[number];

export function withAllocations(rows: PaymentRow[], database: DbLike = db): PaymentDto[] {
  if (rows.length === 0) return [];
  const allocationRows = database
    .select({ allocation: paymentAllocations, sequence: instalments.sequence, dueDate: instalments.dueDate })
    .from(paymentAllocations)
    .leftJoin(instalments, eq(instalments.id, paymentAllocations.instalmentId))
    .where(inArray(paymentAllocations.paymentId, rows.map((r) => r.payment.id)))
    .orderBy(asc(instalments.dueDate))
    .all();

  return rows.map(({ payment: p, ...row }) => ({
    id: p.id,
    receiptNumber: p.receiptNumber,
    studentId: p.studentId,
    studentName: row.studentName,
    studentCode: row.studentCode,
    admissionId: p.admissionId,
    admissionNumber: row.admissionNumber,
    courseName: row.courseName,
    paymentDate: p.paymentDate,
    amountMinor: p.amountMinor,
    direction: p.direction,
    paymentType: p.paymentType,
    method: p.method,
    referenceNumber: p.referenceNumber,
    notes: p.notes,
    status: p.status,
    reversedAt: p.reversedAt?.toISOString() ?? null,
    reversalReason: p.reversalReason,
    reversedByName: row.reversedByName,
    refundOfId: p.refundOfId,
    recordedByName: row.recordedByName,
    createdAt: p.createdAt.toISOString(),
    allocations: allocationRows
      .filter((a) => a.allocation.paymentId === p.id)
      .map((a) => ({
        id: a.allocation.id,
        instalmentId: a.allocation.instalmentId,
        instalmentSequence: a.sequence,
        instalmentDueDate: a.dueDate,
        amountMinor: a.allocation.amountMinor,
      })),
  }));
}

export function getPayment(id: string, database: DbLike = db): PaymentDto {
  const row = paymentQuery(database).where(eq(payments.id, id)).get();
  if (!row) throw ApiError.notFound('Payment');
  return withAllocations([row], database)[0]!;
}

export function paymentsForAdmission(admissionId: string): PaymentDto[] {
  return withAllocations(paymentQuery().where(eq(payments.admissionId, admissionId)).orderBy(desc(payments.paymentDate), desc(payments.createdAt)).all());
}

type ListQuery = z.output<typeof paymentListQuerySchema>;

function listFilters(query: ListQuery): SQL[] {
  const conditions: SQL[] = [];
  if (query.q) {
    const digits = query.q.replace(/\D/g, '');
    const text = [
      containsText(payments.receiptNumber, query.q),
      containsText(students.fullName, query.q),
      containsText(students.studentCode, query.q),
      containsText(payments.referenceNumber, query.q),
      containsText(admissions.admissionNumber, query.q),
    ];
    if (digits.length >= 4) text.push(containsText(students.phoneNormalized, digits));
    conditions.push(or(...text)!);
  }
  if (query.from) conditions.push(sql`${payments.paymentDate} >= ${query.from}`);
  if (query.to) conditions.push(sql`${payments.paymentDate} <= ${query.to}`);
  if (query.method?.length) conditions.push(inArray(payments.method, query.method));
  if (query.status?.length) conditions.push(inArray(payments.status, query.status));
  if (query.direction) conditions.push(eq(payments.direction, query.direction));
  if (query.courseId) conditions.push(eq(admissions.courseId, query.courseId));
  if (query.recordedById) conditions.push(eq(payments.recordedById, query.recordedById));
  if (query.admissionId) conditions.push(eq(payments.admissionId, query.admissionId));
  if (query.studentId) conditions.push(eq(payments.studentId, query.studentId));
  return conditions;
}

const SORTS: Record<string, SQLWrapper> = {
  paymentDate: payments.paymentDate,
  amount: payments.amountMinor,
  receiptNumber: payments.receiptNumber,
  createdAt: payments.createdAt,
};

export function listPayments(query: ListQuery): PaymentList {
  const where = and(...listFilters(query));
  // Totals over the whole filtered set (not just this page). Only succeeded
  // rows are money; reversed rows are counted separately for visibility.
  const summary = db
    .select({
      count: count(),
      gross: sql<number>`coalesce(sum(case when ${payments.status} = 'succeeded' and ${payments.direction} = 'in' then ${payments.amountMinor} else 0 end), 0)`.mapWith(Number),
      refunds: sql<number>`coalesce(sum(case when ${payments.status} = 'succeeded' and ${payments.direction} = 'refund' then ${payments.amountMinor} else 0 end), 0)`.mapWith(Number),
      reversed: sql<number>`coalesce(sum(case when ${payments.status} = 'reversed' then 1 else 0 end), 0)`.mapWith(Number),
    })
    .from(payments)
    .innerJoin(students, eq(students.id, payments.studentId))
    .innerJoin(admissions, eq(admissions.id, payments.admissionId))
    .where(where)
    .get()!;

  const sortColumn = SORTS[query.sort ?? 'paymentDate'] ?? payments.paymentDate;
  const { limit, offset } = pageWindow(query.page, query.limit);
  const rows = paymentQuery()
    .where(where)
    .orderBy(query.order === 'asc' ? asc(sortColumn) : desc(sortColumn), desc(payments.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  return {
    ...paginated(withAllocations(rows), summary.count, query.page, query.limit),
    summary: {
      count: summary.count,
      grossMinor: summary.gross,
      refundsMinor: summary.refunds,
      netMinor: summary.gross - summary.refunds,
      reversedCount: summary.reversed,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Recording a payment
 * ------------------------------------------------------------------ */

/** Stable hash of the request, to detect an idempotency key reused for different data. */
function requestHash(input: unknown): string {
  const canonical = JSON.stringify(input, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
  return createHash('sha256').update(canonical).digest('hex');
}

interface Allocation {
  instalmentId: string | null;
  amountMinor: number;
  kind?: string;
}

function inferType(allocations: Allocation[], amountMinor: number, agreedFeeMinor: number, priorReceipts: number): Payment['paymentType'] {
  if (allocations.some((a) => a.kind === 'loan_disbursement')) return 'loan_disbursement';
  if (priorReceipts === 0 && amountMinor === agreedFeeMinor) return 'full_payment';
  if (allocations.some((a) => a.kind === 'admission_fee')) return 'admission_fee';
  if (allocations.some((a) => a.instalmentId)) return 'instalment';
  return 'part_payment';
}

export interface RecordedPayment {
  payment: PaymentDto;
  created: boolean;
}

/** Shared by direct receipts and received loan disbursements. Must run inside `tx`. */
export function insertPayment(
  tx: Tx,
  ctx: RequestContext,
  input: z.output<typeof paymentCreateSchema>,
  extra: { idempotencyKey?: string | null; requestHash?: string | null; summaryPrefix?: string } = {},
): Payment {
  const admission = getAdmissionRow(input.admissionId, tx);
  if (admission.status === 'cancelled') {
    throw ApiError.unprocessable('This admission is cancelled; it cannot take payments.', 'ADMISSION_CANCELLED');
  }
  if (input.paymentDate < admission.admissionDate) {
    throw ApiError.validation([{ path: 'paymentDate', message: 'A payment cannot be dated before the admission' }]);
  }

  const finance = getAdmission(admission.id, tx);
  if (input.amountMinor > finance.outstandingMinor) {
    throw ApiError.unprocessable(
      `This payment of ${formatMoney(input.amountMinor)} is more than the outstanding balance of ${formatMoney(finance.outstandingMinor)}.`,
      'OVERPAYMENT',
    );
  }

  const open = openInstalments(tx, admission.id);
  let allocations: Allocation[];
  if (input.allocations?.length) {
    const byId = new Map(open.map((row) => [row.id, row]));
    let total = 0;
    allocations = input.allocations.map((a, index) => {
      const instalment = byId.get(a.instalmentId);
      if (!instalment) {
        throw ApiError.validation([{ path: `allocations.${index}.instalmentId`, message: 'Not an open instalment of this admission' }]);
      }
      if (a.amountMinor > instalment.remainingMinor) {
        throw ApiError.validation([
          { path: `allocations.${index}.amountMinor`, message: `Only ${formatMoney(instalment.remainingMinor)} remains on this instalment` },
        ]);
      }
      total += a.amountMinor;
      return { instalmentId: a.instalmentId, amountMinor: a.amountMinor, kind: instalment.kind };
    });
    if (total !== input.amountMinor) {
      throw ApiError.validation([{ path: 'allocations', message: `Allocations total ${formatMoney(total)} but the payment is ${formatMoney(input.amountMinor)}` }]);
    }
  } else {
    // Oldest unpaid instalment first; anything beyond the schedule is applied
    // to the admission without an instalment (e.g. no plan yet).
    let left = input.amountMinor;
    allocations = [];
    for (const row of open) {
      if (left === 0) break;
      const take = Math.min(left, row.remainingMinor);
      allocations.push({ instalmentId: row.id, amountMinor: take, kind: row.kind });
      left -= take;
    }
    if (left > 0) allocations.push({ instalmentId: null, amountMinor: left });
  }

  const priorReceipts =
    tx
      .select({ n: count() })
      .from(payments)
      .where(and(eq(payments.admissionId, admission.id), eq(payments.status, 'succeeded'), eq(payments.direction, 'in')))
      .get()?.n ?? 0;

  const receiptNumber = nextCode(tx, getSettings().receiptNumberPrefix, input.paymentDate);
  const payment = tx
    .insert(payments)
    .values({
      receiptNumber,
      idempotencyKey: extra.idempotencyKey ?? null,
      requestHash: extra.requestHash ?? null,
      studentId: admission.studentId,
      admissionId: admission.id,
      paymentDate: input.paymentDate,
      amountMinor: input.amountMinor,
      direction: 'in',
      paymentType: input.paymentType ?? inferType(allocations, input.amountMinor, admission.agreedFeeMinor, priorReceipts),
      method: input.method,
      referenceNumber: input.referenceNumber ?? null,
      notes: input.notes ?? null,
      status: 'succeeded',
      recordedById: ctx.actorId || null,
    })
    .returning()
    .get();

  for (const allocation of allocations) {
    tx.insert(paymentAllocations)
      .values({ paymentId: payment.id, admissionId: admission.id, instalmentId: allocation.instalmentId, amountMinor: allocation.amountMinor })
      .run();
  }

  // Invariant: a receipt is fully explained by its allocations, to the paisa.
  const allocated = tx
    .select({ total: sql<number>`coalesce(sum(${paymentAllocations.amountMinor}), 0)`.mapWith(Number) })
    .from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, payment.id))
    .get()!.total;
  if (allocated !== payment.amountMinor) {
    throw new Error(`Allocation invariant violated for ${receiptNumber}: ${allocated} != ${payment.amountMinor}`);
  }

  activateIfFeeCovered(tx, ctx, admission.id, input.paymentDate);
  recordAudit(tx, ctx, {
    action: 'create',
    entityType: 'payment',
    entityId: payment.id,
    summary: `${extra.summaryPrefix ?? 'Recorded receipt'} ${receiptNumber}: ${formatMoney(payment.amountMinor)} by ${payment.method.replace(/_/g, ' ')} for ${admission.admissionNumber}`,
    after: { ...payment, allocations },
  });
  return payment;
}

export function recordPayment(ctx: RequestContext, raw: unknown, idempotencyKey?: string): RecordedPayment {
  const input = paymentCreateSchema.parse(raw);
  const hash = requestHash(input);

  if (idempotencyKey) {
    const existing = db.select().from(payments).where(eq(payments.idempotencyKey, idempotencyKey)).get();
    if (existing) {
      if (existing.requestHash !== hash) {
        throw ApiError.conflict('This idempotency key was already used for a different payment.', 'IDEMPOTENCY_KEY_REUSED');
      }
      return { payment: getPayment(existing.id), created: false };
    }
  }

  const id = db.transaction((tx) => insertPayment(tx, ctx, input, { idempotencyKey, requestHash: hash }).id);
  paymentHooks.afterRecorded(id);
  return { payment: getPayment(id), created: true };
}

/* ------------------------------------------------------------------ *
 * Reversal and refund
 * ------------------------------------------------------------------ */

export function reversePayment(ctx: RequestContext, id: string, raw: unknown): PaymentDto {
  const { reason } = reversalSchema.parse(raw);
  db.transaction((tx) => {
    const payment = tx.select().from(payments).where(eq(payments.id, id)).get();
    if (!payment) throw ApiError.notFound('Payment');
    if (payment.status !== 'succeeded') {
      throw ApiError.conflict(`Only a succeeded receipt can be reversed; this one is ${payment.status}.`, 'NOT_REVERSIBLE');
    }
    if (payment.direction === 'in') {
      const finance = getAdmission(payment.admissionId, tx);
      if (finance.netPaidMinor - payment.amountMinor < 0) {
        throw ApiError.conflict('Part of this receipt has been refunded. Reverse the refund first.', 'REFUND_EXISTS');
      }
    }
    tx.update(payments)
      .set({ status: 'reversed', reversedAt: new Date(), reversedById: ctx.actorId || null, reversalReason: reason })
      .where(eq(payments.id, id))
      .run();
    recordAudit(tx, ctx, {
      action: 'reverse',
      entityType: 'payment',
      entityId: id,
      summary: `Reversed ${payment.direction === 'refund' ? 'refund' : 'receipt'} ${payment.receiptNumber} (${formatMoney(payment.amountMinor)}): ${reason}`,
      before: { status: 'succeeded' },
      after: { status: 'reversed', reason },
    });
  });
  return getPayment(id);
}

export function refundPayment(ctx: RequestContext, admissionId: string, raw: unknown): PaymentDto {
  const input = refundSchema.parse(raw);
  const id = db.transaction((tx) => {
    const admission = getAdmissionRow(admissionId, tx);
    if (input.paymentDate < admission.admissionDate) {
      throw ApiError.validation([{ path: 'paymentDate', message: 'A refund cannot be dated before the admission' }]);
    }
    const finance = getAdmission(admissionId, tx);
    if (input.amountMinor > finance.netPaidMinor) {
      throw ApiError.unprocessable(
        `Only ${formatMoney(finance.netPaidMinor)} has been received net of earlier refunds; a refund cannot exceed it.`,
        'REFUND_EXCEEDS_RECEIVED',
      );
    }
    if (input.refundOfId) {
      const original = tx.select().from(payments).where(eq(payments.id, input.refundOfId)).get();
      if (!original || original.admissionId !== admissionId || original.direction !== 'in' || original.status !== 'succeeded') {
        throw ApiError.validation([{ path: 'refundOfId', message: 'Choose a succeeded receipt of this admission' }]);
      }
      const alreadyRefunded =
        tx
          .select({ total: sql<number>`coalesce(sum(${payments.amountMinor}), 0)`.mapWith(Number) })
          .from(payments)
          .where(and(eq(payments.refundOfId, original.id), eq(payments.status, 'succeeded')))
          .get()?.total ?? 0;
      if (alreadyRefunded + input.amountMinor > original.amountMinor) {
        throw ApiError.unprocessable(
          `Receipt ${original.receiptNumber} has ${formatMoney(original.amountMinor - alreadyRefunded)} left to refund.`,
          'REFUND_EXCEEDS_RECEIPT',
        );
      }
    }

    const refund = tx
      .insert(payments)
      .values({
        receiptNumber: nextCode(tx, REFUND_PREFIX, input.paymentDate),
        studentId: admission.studentId,
        admissionId,
        paymentDate: input.paymentDate,
        amountMinor: input.amountMinor,
        direction: 'refund',
        paymentType: 'refund',
        method: input.method,
        referenceNumber: input.referenceNumber ?? null,
        notes: input.reason,
        status: 'succeeded',
        refundOfId: input.refundOfId ?? null,
        recordedById: ctx.actorId || null,
      })
      .returning()
      .get();
    tx.insert(paymentAllocations).values({ paymentId: refund.id, admissionId, instalmentId: null, amountMinor: input.amountMinor }).run();
    recordAudit(tx, ctx, {
      action: 'refund',
      entityType: 'payment',
      entityId: refund.id,
      summary: `Refunded ${formatMoney(input.amountMinor)} on ${admission.admissionNumber} (${refund.receiptNumber}): ${input.reason}`,
      after: refund,
    });
    return refund.id;
  });
  return getPayment(id);
}

/* ------------------------------------------------------------------ *
 * Receipt
 * ------------------------------------------------------------------ */

/** The payment plus the admission balance immediately after it, for printing. */
export function getReceipt(id: string): ReceiptDto {
  const payment = getPayment(id);
  const admission = getAdmissionRow(payment.admissionId);
  const ledger = db
    .select()
    .from(payments)
    .where(and(eq(payments.admissionId, payment.admissionId), eq(payments.status, 'succeeded')))
    .all()
    // Everything recorded up to and including this receipt.
    .filter((p) => p.paymentDate < payment.paymentDate || (p.paymentDate === payment.paymentDate && p.createdAt.toISOString() <= payment.createdAt));
  const received = ledger.reduce((sum, p) => sum + (p.direction === 'in' ? p.amountMinor : -p.amountMinor), 0);
  // Adjustments in force on the receipt date, so a reprint shows the balance as it stood then.
  const adjustments =
    db
      .select({ total: sql<number>`coalesce(sum(${feeAdjustments.amountMinor}), 0)`.mapWith(Number) })
      .from(feeAdjustments)
      .where(and(eq(feeAdjustments.admissionId, payment.admissionId), isNull(feeAdjustments.voidedAt), sql`${feeAdjustments.effectiveDate} <= ${payment.paymentDate}`))
      .get()?.total ?? 0;

  return {
    payment,
    institute: toInstituteInfo(getSettings()),
    agreedFeeMinor: admission.agreedFeeMinor,
    totalReceivedMinor: received,
    balanceAfterMinor: Math.max(0, admission.agreedFeeMinor - adjustments - received),
    amountInWords: amountInWords(payment.amountMinor),
  };
}
