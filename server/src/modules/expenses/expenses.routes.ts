/**
 * GET  /expenses               expenses:read     list + totals by category
 * GET  /expenses/:id           expenses:read
 * POST /expenses               expenses:write
 * PUT  /expenses/:id           expenses:write    edit (audited; re-approval if required)
 * POST /expenses/:id/void      expenses:write    never deleted, voided with a reason
 * POST /expenses/:id/decision  expenses:approve  approve / reject a pending expense
 *
 * Expense totals are cash spent, not accounting profit: they count recorded
 * or approved, non-voided rows by expense date.
 */

import {
  expenseDecisionSchema,
  expenseListQuerySchema,
  expenseSchema,
  formatMoney,
  reversalSchema,
  type ExpenseDto,
  type ExpenseList,
} from '@ims/shared';
import { and, asc, count, desc, eq, inArray, isNull, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { Router } from 'express';
import type { z } from 'zod';
import { db } from '../../db';
import { expenseCategories, expenses, type Expense } from '../../db/schema';
import { users } from '../../db/schema';
import { requirePermission } from '../../middleware/auth';
import { diff, recordAudit } from '../../services/audit';
import { nextCode } from '../../services/sequences';
import { getSettings } from '../../services/settings';
import { ApiError } from '../../utils/ApiError';
import { contextFrom, type RequestContext } from '../../utils/context';
import { containsText, pageWindow, paginated } from '../../utils/pagination';
import { created, ok } from '../../utils/respond';
import { paramId, parseBody, parseQuery } from '../../utils/validate';

export const expensesRouter = Router();

const recorder = alias(users, 'exp_recorder');
const approver = alias(users, 'exp_approver');

/** Spending that counts: recorded (no approval needed) or approved, and not voided. */
export const COUNTED_EXPENSE = sql`(${expenses.voidedAt} is null and ${expenses.approvalStatus} in ('recorded', 'approved'))`;

function query() {
  return db
    .select({ expense: expenses, categoryName: expenseCategories.name, recordedByName: recorder.name, approvedByName: approver.name })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .leftJoin(recorder, eq(recorder.id, expenses.recordedById))
    .leftJoin(approver, eq(approver.id, expenses.approvedById));
}

type Row = Awaited<ReturnType<ReturnType<typeof query>['all']>>[number];

function toDto({ expense: e, categoryName, recordedByName, approvedByName }: Row): ExpenseDto {
  return {
    id: e.id,
    expenseCode: e.expenseCode,
    expenseDate: e.expenseDate,
    categoryId: e.categoryId,
    categoryName,
    description: e.description,
    amountMinor: e.amountMinor,
    paymentMethod: e.paymentMethod,
    payee: e.payee,
    referenceNumber: e.referenceNumber,
    receiptDocumentId: e.receiptDocumentId,
    approvalStatus: e.approvalStatus,
    approvedByName,
    rejectionReason: e.rejectionReason,
    voidedAt: e.voidedAt?.toISOString() ?? null,
    voidReason: e.voidReason,
    recordedByName,
    createdAt: e.createdAt.toISOString(),
  };
}

async function getExpense(id: string): Promise<ExpenseDto> {
  const row = await query().where(eq(expenses.id, id)).get();
  if (!row) throw ApiError.notFound('Expense');
  return toDto(row);
}

async function getRow(id: string): Promise<Expense> {
  const row = await db.select().from(expenses).where(eq(expenses.id, id)).get();
  if (!row) throw ApiError.notFound('Expense');
  return row;
}

async function assertCategory(categoryId: string): Promise<void> {
  if (!await db.select({ id: expenseCategories.id }).from(expenseCategories).where(eq(expenseCategories.id, categoryId)).get()) {
    throw ApiError.validation([{ path: 'categoryId', message: 'Choose a valid category' }]);
  }
}

type ListQuery = z.output<typeof expenseListQuerySchema>;

function filters(q: ListQuery): SQL[] {
  const conditions: SQL[] = [];
  if (q.q) conditions.push(or(containsText(expenses.description, q.q), containsText(expenses.payee, q.q), containsText(expenses.expenseCode, q.q), containsText(expenses.referenceNumber, q.q))!);
  if (q.from) conditions.push(sql`${expenses.expenseDate} >= ${q.from}`);
  if (q.to) conditions.push(sql`${expenses.expenseDate} <= ${q.to}`);
  if (q.categoryId) conditions.push(eq(expenses.categoryId, q.categoryId));
  if (q.status?.length) conditions.push(inArray(expenses.approvalStatus, q.status));
  if (q.method) conditions.push(eq(expenses.paymentMethod, q.method));
  if (q.recordedById) conditions.push(eq(expenses.recordedById, q.recordedById));
  if (q.includeVoided !== 'true') conditions.push(isNull(expenses.voidedAt));
  return conditions;
}

const SORTS: Record<string, SQLWrapper> = { expenseDate: expenses.expenseDate, amount: expenses.amountMinor, createdAt: expenses.createdAt };

export async function listExpenses(q: ListQuery): Promise<ExpenseList> {
  const where = and(...filters(q));
  const total = (await db.select({ n: count() }).from(expenses).where(where).get())?.n ?? 0;
  const { limit, offset } = pageWindow(q.page, q.limit);
  const sortColumn = SORTS[q.sort ?? 'expenseDate'] ?? expenses.expenseDate;
  const rows = await query().where(where).orderBy(q.order === 'asc' ? asc(sortColumn) : desc(sortColumn), desc(expenses.createdAt)).limit(limit).offset(offset).all();

  const totals = (await db
    .select({
      total: sql<number>`coalesce(sum(case when ${COUNTED_EXPENSE} then ${expenses.amountMinor} else 0 end), 0)`.mapWith(Number),
      pendingCount: sql<number>`coalesce(sum(case when ${expenses.voidedAt} is null and ${expenses.approvalStatus} = 'pending' then 1 else 0 end), 0)`.mapWith(Number),
      pendingMinor: sql<number>`coalesce(sum(case when ${expenses.voidedAt} is null and ${expenses.approvalStatus} = 'pending' then ${expenses.amountMinor} else 0 end), 0)`.mapWith(Number),
    })
    .from(expenses)
    .where(where)
    .get())!;
  const byCategory = await db
    .select({
      categoryId: expenses.categoryId,
      categoryName: expenseCategories.name,
      totalMinor: sql<number>`coalesce(sum(${expenses.amountMinor}), 0)`.mapWith(Number),
      count: count(),
    })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .where(and(where, COUNTED_EXPENSE))
    .groupBy(expenses.categoryId, expenseCategories.name)
    .orderBy(desc(sql`sum(${expenses.amountMinor})`))
    .all();

  return { ...paginated(rows.map(toDto), total, q.page, q.limit), summary: { totalMinor: totals.total, pendingCount: totals.pendingCount, pendingMinor: totals.pendingMinor, byCategory } };
}

/** Record an expense (also used by the demo seed). */
export async function createExpense(ctx: RequestContext, raw: unknown): Promise<ExpenseDto> {
  const input = expenseSchema.parse(raw);
  await assertCategory(input.categoryId);
  const settings = getSettings();
  const id = await db.transaction(async (tx) => {
    const row = await tx
      .insert(expenses)
      .values({
        ...input,
        payee: input.payee ?? null,
        referenceNumber: input.referenceNumber ?? null,
        expenseCode: await nextCode(tx, settings.expenseCodePrefix, input.expenseDate),
        approvalStatus: settings.expenseApprovalRequired ? 'pending' : 'recorded',
        recordedById: ctx.actorId || null,
      })
      .returning()
      .get();
    await recordAudit(tx, ctx, { action: 'create', entityType: 'expense', entityId: row.id, summary: `Recorded expense ${row.expenseCode}: ${formatMoney(row.amountMinor)} ${row.description}`, after: row });
    return row.id;
  });
  return await getExpense(id);
}

async function update(ctx: RequestContext, id: string, raw: unknown): Promise<ExpenseDto> {
  const input = expenseSchema.parse(raw);
  const existing = await getRow(id);
  if (existing.voidedAt) throw ApiError.conflict('A voided expense cannot be edited.');
  await assertCategory(input.categoryId);
  const needsApproval = getSettings().expenseApprovalRequired;
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(expenses)
      .set({
        ...input,
        payee: input.payee ?? null,
        referenceNumber: input.referenceNumber ?? null,
        // A changed amount must be approved again when approvals are on.
        ...(needsApproval && existing.approvalStatus === 'approved' && input.amountMinor !== existing.amountMinor && { approvalStatus: 'pending', approvedById: null, approvedAt: null }),
      })
      .where(eq(expenses.id, id))
      .returning()
      .get();
    await recordAudit(tx, ctx, { action: 'update', entityType: 'expense', entityId: id, summary: `Edited expense ${existing.expenseCode}`, ...diff(existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>) });
  });
  return await getExpense(id);
}

async function voidExpense(ctx: RequestContext, id: string, raw: unknown): Promise<ExpenseDto> {
  const { reason } = reversalSchema.parse(raw);
  const existing = await getRow(id);
  if (existing.voidedAt) throw ApiError.conflict('This expense is already void.');
  await db.transaction(async (tx) => {
    await tx.update(expenses).set({ voidedAt: new Date(), voidedById: ctx.actorId || null, voidReason: reason }).where(eq(expenses.id, id)).run();
    await recordAudit(tx, ctx, { action: 'void', entityType: 'expense', entityId: id, summary: `Voided expense ${existing.expenseCode} (${formatMoney(existing.amountMinor)}): ${reason}` });
  });
  return await getExpense(id);
}

async function decide(ctx: RequestContext, id: string, raw: unknown): Promise<ExpenseDto> {
  const input = expenseDecisionSchema.parse(raw);
  const existing = await getRow(id);
  if (existing.voidedAt) throw ApiError.conflict('This expense is void.');
  if (existing.approvalStatus !== 'pending') throw ApiError.conflict(`This expense is ${existing.approvalStatus}, not pending.`);
  await db.transaction(async (tx) => {
    await tx.update(expenses)
      .set(
        input.decision === 'approve'
          ? { approvalStatus: 'approved', approvedById: ctx.actorId || null, approvedAt: new Date(), rejectionReason: null }
          : { approvalStatus: 'rejected', approvedById: ctx.actorId || null, approvedAt: new Date(), rejectionReason: input.reason ?? null },
      )
      .where(eq(expenses.id, id))
      .run();
    await recordAudit(tx, ctx, {
      action: input.decision === 'approve' ? 'approve' : 'reject',
      entityType: 'expense',
      entityId: id,
      summary: `${input.decision === 'approve' ? 'Approved' : 'Rejected'} expense ${existing.expenseCode}${input.reason ? `: ${input.reason}` : ''}`,
    });
  });
  return await getExpense(id);
}

expensesRouter.get('/', requirePermission('expenses:read'), async (req, res) => ok(res, await listExpenses(parseQuery(expenseListQuerySchema, req))));
expensesRouter.get('/:id', requirePermission('expenses:read'), async (req, res) => ok(res, await getExpense(paramId(req))));
expensesRouter.post('/', requirePermission('expenses:write'), async (req, res) => created(res, await createExpense(contextFrom(req), req.body)));
expensesRouter.put('/:id', requirePermission('expenses:write'), async (req, res) => ok(res, await update(contextFrom(req), paramId(req), req.body)));
expensesRouter.post('/:id/void', requirePermission('expenses:write'), async (req, res) => ok(res, await voidExpense(contextFrom(req), paramId(req), req.body)));
expensesRouter.post('/:id/decision', requirePermission('expenses:approve'), async (req, res) => ok(res, await decide(contextFrom(req), paramId(req), parseBody(expenseDecisionSchema, req))));
