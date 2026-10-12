/**
 * Internal instalment facilities and external education loans.
 *
 * The brief's two hard rules, enforced structurally:
 *   - Approval is a lender decision, never cash. An approved loan with no
 *     received disbursement adds nothing to collections.
 *   - Money counts as received only when the institute records it arriving:
 *     a disbursement with receivedByInstitute=true creates a receipt in the
 *     ledger (method finance_disbursement), and only that receipt is cash.
 * An internal facility is the institute's own credit, so it has no
 * disbursements at all -- it is repaid through the instalment schedule.
 */

import {
  disbursementSchema,
  formatMoney,
  hasPermission,
  loanCreateSchema,
  loanListQuerySchema,
  loanStatusSchema,
  loanUpdateSchema,
  type LoanDetail,
  type LoanDto,
  type LoanSummary,
} from '@ims/shared';
import { and, asc, count, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';
import { db } from '../../db';
import { qualified } from '../../db/dialect';
import { admissions, auditLogs, courses, loanDisbursements, loans, payments, students, users, type Loan } from '../../db/schema';
import type { DbLike } from '../../db/types';
import { diff, recordAudit } from '../../services/audit';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { containsText, pageWindow, paginated } from '../../utils/pagination';
import { getAdmissionRow } from '../admissions/admissions.service';
import { notifyPermission, safely } from '../notifications/notifications.service';
import { insertPayment } from './payments.service';

const L_ID = qualified('loans', 'id');
/** Σ disbursements the lender reports. */
const disbursedExpr = sql<number>`coalesce((select sum(d.amount_minor) from loan_disbursements d where d.loan_id = ${L_ID}), 0)`;
/** Σ disbursements that actually arrived: linked to a SUCCEEDED receipt. */
const receivedExpr = sql<number>`coalesce((select sum(d.amount_minor) from loan_disbursements d join payments p on p.id = d.payment_id where d.loan_id = ${L_ID} and p.status = 'succeeded'), 0)`;

const actor = alias(users, 'loan_actor');

function loanQuery(database: DbLike = db) {
  return database
    .select({
      loan: loans,
      admissionNumber: admissions.admissionNumber,
      studentName: students.fullName,
      studentCode: students.studentCode,
      courseName: courses.name,
      disbursedMinor: disbursedExpr.mapWith(Number),
      receivedMinor: receivedExpr.mapWith(Number),
    })
    .from(loans)
    .innerJoin(admissions, eq(admissions.id, loans.admissionId))
    .innerJoin(students, eq(students.id, loans.studentId))
    .innerJoin(courses, eq(courses.id, admissions.courseId));
}

type LoanRow = Awaited<ReturnType<ReturnType<typeof loanQuery>['all']>>[number];

function toDto(row: LoanRow): LoanDto {
  const l = row.loan;
  let disbursementStatus: LoanDto['disbursementStatus'] = 'not_applicable';
  if (l.financeType === 'external_loan' && l.status === 'approved' && l.approvedMinor) {
    disbursementStatus =
      row.disbursedMinor === 0 ? 'awaiting_disbursement' : row.disbursedMinor < l.approvedMinor ? 'partially_disbursed' : 'fully_disbursed';
  }
  return {
    id: l.id,
    admissionId: l.admissionId,
    admissionNumber: row.admissionNumber,
    studentId: l.studentId,
    studentName: row.studentName,
    studentCode: row.studentCode,
    courseName: row.courseName,
    financeType: l.financeType,
    providerName: l.providerName,
    applicationReference: l.applicationReference,
    requestedMinor: l.requestedMinor,
    approvedMinor: l.approvedMinor,
    disbursedMinor: row.disbursedMinor,
    receivedMinor: row.receivedMinor,
    status: l.status,
    disbursementStatus,
    appliedOn: l.appliedOn,
    decisionOn: l.decisionOn,
    rejectionReason: l.rejectionReason,
    notes: l.notes,
    createdAt: l.createdAt.toISOString(),
  };
}

function getLoanRow(id: string, database: DbLike = db): Loan {
  const loan = database.select().from(loans).where(eq(loans.id, id)).get();
  if (!loan) throw ApiError.notFound('Loan');
  return loan;
}

export function getLoan(id: string): LoanDetail {
  const row = loanQuery().where(eq(loans.id, id)).get();
  if (!row) throw ApiError.notFound('Loan');
  const disbursements = db
    .select({ d: loanDisbursements, receiptNumber: payments.receiptNumber, paymentStatus: payments.status })
    .from(loanDisbursements)
    .leftJoin(payments, eq(payments.id, loanDisbursements.paymentId))
    .where(eq(loanDisbursements.loanId, id))
    .orderBy(asc(loanDisbursements.disbursedOn))
    .all();
  const history = db
    .select({ log: auditLogs, actorName: actor.name })
    .from(auditLogs)
    .leftJoin(actor, eq(actor.id, auditLogs.actorId))
    .where(and(eq(auditLogs.entityType, 'loan'), eq(auditLogs.entityId, id)))
    .orderBy(desc(auditLogs.occurredAt))
    .all();
  return {
    ...toDto(row),
    disbursements: disbursements.map(({ d, receiptNumber, paymentStatus }) => ({
      id: d.id,
      disbursedOn: d.disbursedOn,
      amountMinor: d.amountMinor,
      reference: d.reference,
      notes: d.notes,
      paymentId: d.paymentId,
      receiptNumber,
      received: paymentStatus === 'succeeded',
      createdAt: d.createdAt.toISOString(),
    })),
    history: history.map(({ log, actorName }) => ({ at: log.occurredAt.toISOString(), summary: log.summary, actorName })),
  };
}

type ListQuery = z.output<typeof loanListQuerySchema>;

function filters(query: Partial<ListQuery>): SQL[] {
  const conditions: SQL[] = [];
  if (query.q) {
    conditions.push(
      or(
        containsText(students.fullName, query.q),
        containsText(students.studentCode, query.q),
        containsText(loans.providerName, query.q),
        containsText(loans.applicationReference, query.q),
        containsText(admissions.admissionNumber, query.q),
      )!,
    );
  }
  if (query.status?.length) conditions.push(inArray(loans.status, query.status));
  if (query.financeType) conditions.push(eq(loans.financeType, query.financeType));
  if (query.provider) conditions.push(sql`lower(${loans.providerName}) = lower(${query.provider})`);
  if (query.admissionId) conditions.push(eq(loans.admissionId, query.admissionId));
  if (query.studentId) conditions.push(eq(loans.studentId, query.studentId));
  if (query.from) conditions.push(sql`coalesce(${loans.appliedOn}, date(${loans.createdAt} / 1000, 'unixepoch')) >= ${query.from}`);
  if (query.to) conditions.push(sql`coalesce(${loans.appliedOn}, date(${loans.createdAt} / 1000, 'unixepoch')) <= ${query.to}`);
  return conditions;
}

export function listLoans(query: ListQuery) {
  const where = and(...filters(query));
  const total =
    db
      .select({ n: count() })
      .from(loans)
      .innerJoin(admissions, eq(admissions.id, loans.admissionId))
      .innerJoin(students, eq(students.id, loans.studentId))
      .where(where)
      .get()?.n ?? 0;
  const { limit, offset } = pageWindow(query.page, query.limit);
  const rows = loanQuery()
    .where(where)
    .orderBy(query.order === 'asc' ? asc(loans.createdAt) : desc(loans.createdAt))
    .limit(limit)
    .offset(offset)
    .all();
  return paginated(rows.map(toDto), total, query.page, query.limit);
}

export function loansForAdmission(admissionId: string): LoanDto[] {
  return loanQuery().where(eq(loans.admissionId, admissionId)).orderBy(desc(loans.createdAt)).all().map(toDto);
}

export function loanSummary(): LoanSummary {
  const rows = loanQuery().all().map(toDto);
  const byStatus = new Map<string, { count: number; requestedMinor: number }>();
  const byProvider = new Map<string, { count: number; approvedMinor: number; receivedMinor: number }>();
  let requested = 0;
  let approved = 0;
  let disbursed = 0;
  let received = 0;
  for (const loan of rows) {
    const s = byStatus.get(loan.status) ?? { count: 0, requestedMinor: 0 };
    s.count += 1;
    s.requestedMinor += loan.requestedMinor;
    byStatus.set(loan.status, s);
    if (!['cancelled', 'rejected'].includes(loan.status)) requested += loan.requestedMinor;
    if (loan.status === 'approved') approved += loan.approvedMinor ?? 0;
    disbursed += loan.disbursedMinor;
    received += loan.receivedMinor;
    const p = byProvider.get(loan.providerName) ?? { count: 0, approvedMinor: 0, receivedMinor: 0 };
    p.count += 1;
    if (loan.status === 'approved') p.approvedMinor += loan.approvedMinor ?? 0;
    p.receivedMinor += loan.receivedMinor;
    byProvider.set(loan.providerName, p);
  }
  return {
    byStatus: [...byStatus].map(([status, v]) => ({ status, ...v })),
    requestedMinor: requested,
    approvedMinor: approved,
    disbursedMinor: disbursed,
    receivedMinor: received,
    pendingApplications: rows.filter((l) => ['applied', 'under_review'].includes(l.status)).length,
    byProvider: [...byProvider].map(([providerName, v]) => ({ providerName, ...v })).sort((a, b) => b.count - a.count),
  };
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

export function createLoan(ctx: RequestContext, raw: unknown): LoanDetail {
  const input = loanCreateSchema.parse(raw);
  const admission = getAdmissionRow(input.admissionId);
  if (admission.status === 'cancelled') throw ApiError.unprocessable('This admission is cancelled.', 'ADMISSION_CANCELLED');
  if (input.requestedMinor > admission.agreedFeeMinor) {
    throw ApiError.validation([{ path: 'requestedMinor', message: `Cannot exceed the agreed fee of ${formatMoney(admission.agreedFeeMinor)}` }]);
  }
  const id = db.transaction((tx) => {
    const loan = tx
      .insert(loans)
      .values({
        ...input,
        studentId: admission.studentId,
        applicationReference: input.applicationReference ?? null,
        notes: input.notes ?? null,
        createdById: ctx.actorId || null,
      })
      .returning()
      .get();
    recordAudit(tx, ctx, {
      action: 'create',
      entityType: 'loan',
      entityId: loan.id,
      summary: `Opened ${loan.financeType === 'internal_instalment' ? 'internal facility' : 'loan application'} with ${loan.providerName} for ${formatMoney(loan.requestedMinor)} (${admission.admissionNumber})`,
      after: loan,
    });
    return loan.id;
  });
  return getLoan(id);
}

export function updateLoan(ctx: RequestContext, id: string, raw: unknown): LoanDetail {
  const input = loanUpdateSchema.parse(raw);
  const existing = getLoanRow(id);
  if (['rejected', 'cancelled'].includes(existing.status)) throw ApiError.conflict('A closed loan cannot be edited.');
  if (existing.status === 'approved' && input.requestedMinor !== existing.requestedMinor) {
    throw ApiError.conflict('The requested amount cannot change after approval.');
  }
  db.transaction((tx) => {
    const updated = tx
      .update(loans)
      .set({ ...input, applicationReference: input.applicationReference ?? null, notes: input.notes ?? null })
      .where(eq(loans.id, id))
      .returning()
      .get();
    recordAudit(tx, ctx, {
      action: 'update',
      entityType: 'loan',
      entityId: id,
      summary: `Updated loan with ${updated.providerName}`,
      ...diff(existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>),
    });
  });
  return getLoan(id);
}

const TRANSITIONS: Record<Loan['status'], readonly Loan['status'][]> = {
  draft: ['applied', 'approved', 'cancelled'],
  applied: ['under_review', 'approved', 'rejected', 'cancelled'],
  under_review: ['approved', 'rejected', 'cancelled'],
  approved: ['cancelled'],
  rejected: [],
  cancelled: [],
};

export function changeLoanStatus(ctx: RequestContext, id: string, raw: unknown): LoanDetail {
  const input = loanStatusSchema.parse(raw);
  const loan = getLoanRow(id);
  const to = input.status as Loan['status'];

  if (!TRANSITIONS[loan.status].includes(to)) {
    throw ApiError.conflict(`A loan that is ${loan.status.replace(/_/g, ' ')} cannot move to ${to.replace(/_/g, ' ')}.`, 'INVALID_TRANSITION');
  }
  if ((to === 'approved' || to === 'rejected') && !hasPermission(ctx.permissions, 'loans:approve')) {
    throw ApiError.forbidden('Recording a lender decision needs the "loans:approve" permission.');
  }
  if (to === 'approved') {
    if (!input.approvedMinor || input.approvedMinor <= 0) throw ApiError.validation([{ path: 'approvedMinor', message: 'Enter the approved amount' }]);
    if (input.approvedMinor > loan.requestedMinor) {
      throw ApiError.validation([{ path: 'approvedMinor', message: `Cannot exceed the requested ${formatMoney(loan.requestedMinor)}` }]);
    }
  }
  if (to === 'cancelled') {
    const disbursed = db.select({ n: count() }).from(loanDisbursements).where(eq(loanDisbursements.loanId, id)).get()?.n ?? 0;
    if (disbursed > 0) throw ApiError.conflict('Money has been disbursed on this loan; it cannot be cancelled.');
  }

  db.transaction((tx) => {
    tx.update(loans)
      .set({
        status: to,
        ...(to === 'applied' && { appliedOn: input.date }),
        ...((to === 'approved' || to === 'rejected') && { decisionOn: input.date }),
        ...(to === 'approved' && { approvedMinor: input.approvedMinor }),
        ...(to === 'rejected' && { rejectionReason: input.rejectionReason ?? null }),
      })
      .where(eq(loans.id, id))
      .run();
    recordAudit(tx, ctx, {
      action: 'status_change',
      entityType: 'loan',
      entityId: id,
      summary: `Loan with ${loan.providerName}: ${loan.status.replace(/_/g, ' ')} → ${to.replace(/_/g, ' ')}${to === 'approved' ? ` for ${formatMoney(input.approvedMinor!)}` : ''}${input.rejectionReason ? ` (${input.rejectionReason})` : ''}`,
      before: { status: loan.status },
      after: { status: to, date: input.date, approvedMinor: input.approvedMinor ?? null, note: input.note ?? null },
    });
  });
  if (to === 'approved' || to === 'rejected' || to === 'under_review') {
    safely('loan_status_change', () => {
      const student = db.select({ name: students.fullName }).from(students).where(eq(students.id, loan.studentId)).get();
      notifyPermission(
        'loans:read',
        {
          type: 'loan_status_change',
          severity: to === 'rejected' ? 'warning' : to === 'approved' ? 'success' : 'info',
          title: `Loan ${to.replace(/_/g, ' ')}: ${student?.name ?? 'student'} (${loan.providerName})`,
          body: to === 'approved' ? `Approved for ${formatMoney(input.approvedMinor!)}. Approval is not cash: record disbursements as they arrive.` : (input.rejectionReason ?? null),
          link: `/loans?loan=${id}`,
          entityType: 'loan',
          entityId: id,
          dedupeKey: `loan:${id}:${to}`,
        },
        { except: ctx.actorId },
      );
    });
  }
  return getLoan(id);
}

export function recordDisbursement(ctx: RequestContext, id: string, raw: unknown): LoanDetail {
  const input = disbursementSchema.parse(raw);
  db.transaction((tx) => {
    const loan = getLoanRow(id, tx);
    if (loan.financeType === 'internal_instalment') {
      throw ApiError.unprocessable('An internal facility is repaid through its instalment schedule; there is nothing to disburse.', 'NOT_DISBURSABLE');
    }
    if (loan.status !== 'approved' || !loan.approvedMinor) {
      throw ApiError.unprocessable('Only an approved loan can be disbursed.', 'NOT_APPROVED');
    }
    const soFar =
      tx
        .select({ total: sql<number>`coalesce(sum(${loanDisbursements.amountMinor}), 0)`.mapWith(Number) })
        .from(loanDisbursements)
        .where(eq(loanDisbursements.loanId, id))
        .get()?.total ?? 0;
    if (soFar + input.amountMinor > loan.approvedMinor) {
      throw ApiError.unprocessable(
        `Only ${formatMoney(loan.approvedMinor - soFar)} of the approved ${formatMoney(loan.approvedMinor)} remains to disburse.`,
        'DISBURSEMENT_EXCEEDS_APPROVAL',
      );
    }

    // Cash only when it has actually reached the institute.
    const payment = input.receivedByInstitute
      ? insertPayment(
          tx,
          ctx,
          {
            admissionId: loan.admissionId,
            paymentDate: input.disbursedOn,
            amountMinor: input.amountMinor,
            method: 'finance_disbursement',
            paymentType: 'loan_disbursement',
            referenceNumber: input.reference,
            notes: `Disbursement from ${loan.providerName}`,
          },
          { summaryPrefix: 'Received loan disbursement' },
        )
      : null;

    const disbursement = tx
      .insert(loanDisbursements)
      .values({
        loanId: id,
        disbursedOn: input.disbursedOn,
        amountMinor: input.amountMinor,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        paymentId: payment?.id ?? null,
        recordedById: ctx.actorId || null,
      })
      .returning()
      .get();
    recordAudit(tx, ctx, {
      action: 'create',
      entityType: 'loan',
      entityId: id,
      summary: `${loan.providerName} disbursed ${formatMoney(input.amountMinor)}${payment ? ` (received, receipt ${payment.receiptNumber})` : ' (reported; not yet received)'}`,
      after: disbursement,
    });
  });
  return getLoan(id);
}

/** Link a reported disbursement to its arrival later, recording the receipt then. */
export function markDisbursementReceived(ctx: RequestContext, loanId: string, disbursementId: string, receivedOn: string): LoanDetail {
  db.transaction((tx) => {
    const loan = getLoanRow(loanId, tx);
    const d = tx.select().from(loanDisbursements).where(and(eq(loanDisbursements.id, disbursementId), eq(loanDisbursements.loanId, loanId))).get();
    if (!d) throw ApiError.notFound('Disbursement');
    if (d.paymentId) {
      const linked = tx.select({ status: payments.status }).from(payments).where(eq(payments.id, d.paymentId)).get();
      if (linked?.status === 'succeeded') throw ApiError.conflict('This disbursement is already marked as received.');
    }
    const payment = insertPayment(
      tx,
      ctx,
      { admissionId: loan.admissionId, paymentDate: receivedOn, amountMinor: d.amountMinor, method: 'finance_disbursement', paymentType: 'loan_disbursement', referenceNumber: d.reference ?? undefined, notes: `Disbursement from ${loan.providerName}` },
      { summaryPrefix: 'Received loan disbursement' },
    );
    tx.update(loanDisbursements).set({ paymentId: payment.id }).where(eq(loanDisbursements.id, d.id)).run();
  });
  return getLoan(loanId);
}
