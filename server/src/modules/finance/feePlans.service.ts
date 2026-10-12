/**
 * Fee plans and instalment schedules.
 *
 * A plan turns "what is still owed" into dated instalments. Amounts are split
 * with the remainder-safe allocator (shared/money.ts), so a schedule always
 * sums to the exact paisa. Plans are never edited: restructuring cancels the
 * unpaid part of the old schedule, marks it superseded, and creates a new plan
 * for the current outstanding balance -- the history stays readable.
 *
 * What an instalment has PAID is never stored; it is the sum of allocations
 * from succeeded receipts, computed on read.
 */

import {
  addMonths,
  buildInstalmentAmounts,
  feePlanSchema,
  formatMoney,
  type FeePlanDto,
  type InstalmentDto,
} from '@ims/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';
import { db } from '../../db';
import { feePlans, instalments, type Admission, type FeePlan } from '../../db/schema';
import type { DbLike, Tx } from '../../db/types';
import { recordAudit } from '../../services/audit';
import { instituteToday } from '../../services/clock';
import { instalmentPaidSql } from '../../services/ledger';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { getAdmission, getAdmissionRow } from '../admissions/admissions.service';
import { admissionHooks } from '../admissions/hooks';

type PlanInput = z.output<typeof feePlanSchema>;
type Kind = 'admission_fee' | 'instalment' | 'full_payment' | 'loan_disbursement';

export interface ScheduleRow {
  kind: Kind;
  dueDate: string;
  amountMinor: number;
}

/** Turn a plan into dated rows summing exactly to `totalMinor`. */
export function buildSchedule(plan: PlanInput, totalMinor: number, admissionFeeMinor: number): ScheduleRow[] {
  if (totalMinor <= 0) return [];
  const fee = Math.min(Math.max(0, admissionFeeMinor), totalMinor);
  const rows: ScheduleRow[] = [];
  const pushFee = () => {
    if (fee > 0) rows.push({ kind: 'admission_fee', dueDate: plan.startDate, amountMinor: fee });
  };

  switch (plan.planType) {
    case 'full_payment':
      return [{ kind: 'full_payment', dueDate: plan.startDate, amountMinor: totalMinor }];

    case 'admission_plus_monthly':
    case 'internal_financing': {
      pushFee();
      buildInstalmentAmounts(totalMinor, fee, plan.instalmentCount!).forEach((amount, index) => {
        // A balance smaller than the instalment count leaves zero-value rows; skip them.
        if (amount > 0) rows.push({ kind: 'instalment', dueDate: addMonths(plan.firstDueDate!, index), amountMinor: amount });
      });
      return rows;
    }

    case 'admission_plus_flexible': {
      pushFee();
      const balance = totalMinor - fee;
      const scheduled = plan.schedule!.reduce((sum, row) => sum + row.amountMinor, 0);
      if (scheduled !== balance) {
        throw ApiError.validation([
          {
            path: 'feePlan.schedule',
            message: `The instalments add up to ${formatMoney(scheduled)}, but ${formatMoney(balance)} remains after the admission fee.`,
          },
        ]);
      }
      [...plan.schedule!]
        .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
        .forEach((row) => rows.push({ kind: 'instalment', dueDate: row.dueDate, amountMinor: row.amountMinor }));
      return rows;
    }

    case 'external_financing': {
      pushFee();
      if (totalMinor - fee > 0) {
        rows.push({ kind: 'loan_disbursement', dueDate: plan.expectedDisbursementDate!, amountMinor: totalMinor - fee });
      }
      return rows;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Reading plans with computed instalment status
 * ------------------------------------------------------------------ */

const i = alias(instalments, 'i');

function instalmentColumns(today: string) {
  const paid = instalmentPaidSql();
  return {
    inst: i,
    paidMinor: paid.mapWith(Number),
    status: sql<string>`case when ${i.state} <> 'active' then ${i.state} when ${paid} >= ${i.amountMinor} then 'paid' when ${i.dueDate} < ${today} then 'overdue' when ${paid} > 0 then 'partially_paid' else 'scheduled' end`,
  };
}

function toInstalmentDto(row: { inst: typeof instalments.$inferSelect; paidMinor: number; status: string }): InstalmentDto {
  return {
    id: row.inst.id,
    feePlanId: row.inst.feePlanId,
    admissionId: row.inst.admissionId,
    sequence: row.inst.sequence,
    kind: row.inst.kind,
    dueDate: row.inst.dueDate,
    amountMinor: row.inst.amountMinor,
    paidMinor: row.paidMinor,
    remainingMinor: row.inst.state === 'active' ? Math.max(0, row.inst.amountMinor - row.paidMinor) : 0,
    status: row.status,
    state: row.inst.state,
  };
}

export function instalmentsForPlan(planId: string, database: DbLike = db): InstalmentDto[] {
  return database
    .select(instalmentColumns(instituteToday()))
    .from(i)
    .where(eq(i.feePlanId, planId))
    .orderBy(asc(i.sequence))
    .all()
    .map(toInstalmentDto);
}

function toPlanDto(plan: FeePlan, database: DbLike = db): FeePlanDto {
  return {
    id: plan.id,
    admissionId: plan.admissionId,
    planType: plan.planType,
    totalMinor: plan.totalMinor,
    admissionFeeMinor: plan.admissionFeeMinor,
    instalmentCount: plan.instalmentCount,
    startDate: plan.startDate,
    status: plan.status,
    supersededAt: plan.supersededAt?.toISOString() ?? null,
    notes: plan.notes,
    createdAt: plan.createdAt.toISOString(),
    instalments: instalmentsForPlan(plan.id, database),
  };
}

export function plansForAdmission(admissionId: string): { active: FeePlanDto | null; previous: FeePlanDto[] } {
  const plans = db.select().from(feePlans).where(eq(feePlans.admissionId, admissionId)).orderBy(desc(feePlans.createdAt)).all();
  const active = plans.find((p) => p.status === 'active');
  return {
    active: active ? toPlanDto(active) : null,
    previous: plans.filter((p) => p.status !== 'active').map((p) => toPlanDto(p)),
  };
}

/** Active instalments with money still owed, oldest due first: the default allocation order. */
export function openInstalments(tx: DbLike, admissionId: string): { id: string; kind: string; remainingMinor: number }[] {
  return tx
    .select(instalmentColumns(instituteToday()))
    .from(i)
    .where(and(eq(i.admissionId, admissionId), eq(i.state, 'active')))
    .orderBy(asc(i.dueDate), asc(i.sequence))
    .all()
    .map(toInstalmentDto)
    .filter((row) => row.remainingMinor > 0)
    .map((row) => ({ id: row.id, kind: row.kind, remainingMinor: row.remainingMinor }));
}

/* ------------------------------------------------------------------ *
 * Creating and restructuring
 * ------------------------------------------------------------------ */

function insertPlan(tx: Tx, ctx: RequestContext, admission: Admission, plan: PlanInput, summary: string): FeePlan {
  const finance = getAdmission(admission.id, tx);
  const total = finance.outstandingMinor;
  if (total <= 0) {
    throw ApiError.unprocessable('Nothing is outstanding on this admission, so there is nothing to schedule.', 'NOTHING_TO_SCHEDULE');
  }
  // The admission fee is only scheduled while it is still awaited.
  const admissionFee =
    admission.status === 'pending_payment' ? Math.max(0, admission.admissionFeeRequiredMinor - finance.netPaidMinor) : 0;
  if (plan.startDate < admission.admissionDate) {
    throw ApiError.validation([{ path: 'feePlan.startDate', message: 'The plan cannot start before the admission date' }]);
  }

  const rows = buildSchedule(plan, total, admissionFee);
  const created = tx
    .insert(feePlans)
    .values({
      admissionId: admission.id,
      planType: plan.planType,
      totalMinor: total,
      admissionFeeMinor: Math.min(admissionFee, total),
      instalmentCount: rows.length,
      startDate: plan.startDate,
      notes: plan.notes ?? null,
      createdById: ctx.actorId || null,
    })
    .returning()
    .get();

  rows.forEach((row, index) => {
    tx.insert(instalments)
      .values({ feePlanId: created.id, admissionId: admission.id, sequence: index + 1, kind: row.kind, dueDate: row.dueDate, amountMinor: row.amountMinor })
      .run();
  });

  recordAudit(tx, ctx, {
    action: 'create',
    entityType: 'fee_plan',
    entityId: created.id,
    summary: `${summary} for ${admission.admissionNumber}: ${rows.length} instalment(s) totalling ${formatMoney(total)}`,
    after: { planType: plan.planType, totalMinor: total, schedule: rows },
  });
  return created;
}

export function createFeePlan(ctx: RequestContext, admissionId: string, raw: unknown): FeePlanDto {
  const plan = feePlanSchema.parse(raw);
  const admission = getAdmissionRow(admissionId);
  if (admission.status === 'cancelled') throw ApiError.unprocessable('This admission is cancelled.', 'ADMISSION_CANCELLED');

  const created = db.transaction((tx) => {
    const existing = tx.select({ id: feePlans.id }).from(feePlans).where(and(eq(feePlans.admissionId, admissionId), eq(feePlans.status, 'active'))).get();
    if (existing) {
      throw ApiError.conflict('This admission already has a payment plan. Restructure it instead.', 'PLAN_EXISTS');
    }
    return insertPlan(tx, ctx, admission, plan, 'Created payment plan');
  });
  return toPlanDto(created);
}

export function restructureFeePlan(ctx: RequestContext, admissionId: string, raw: unknown): FeePlanDto {
  const plan = feePlanSchema.parse(raw);
  const admission = getAdmissionRow(admissionId);
  if (admission.status === 'cancelled') throw ApiError.unprocessable('This admission is cancelled.', 'ADMISSION_CANCELLED');

  const created = db.transaction((tx) => {
    const current = tx.select().from(feePlans).where(and(eq(feePlans.admissionId, admissionId), eq(feePlans.status, 'active'))).get();
    if (current) {
      // Close what was unpaid on the old schedule; paid rows stay as history.
      for (const row of instalmentsForPlan(current.id, tx)) {
        if (row.state === 'active' && row.remainingMinor > 0) {
          tx.update(instalments).set({ state: 'cancelled', stateReason: 'Superseded by a restructured plan' }).where(eq(instalments.id, row.id)).run();
        }
      }
      tx.update(feePlans).set({ status: 'superseded', supersededAt: new Date() }).where(eq(feePlans.id, current.id)).run();
    }
    return insertPlan(tx, ctx, admission, plan, current ? 'Restructured payment plan' : 'Created payment plan');
  });
  return toPlanDto(created);
}

/* ------------------------------------------------------------------ *
 * Reacting to the admission lifecycle
 * ------------------------------------------------------------------ */

function closeOpenInstalments(tx: Tx, admissionId: string, state: 'cancelled' | 'waived', reason: string): void {
  for (const row of openInstalments(tx, admissionId)) {
    tx.update(instalments).set({ state, stateReason: reason }).where(eq(instalments.id, row.id)).run();
  }
}

admissionHooks.registerOnCreated((tx, ctx, admission, rawInput) => {
  const plan = (rawInput as { feePlan?: unknown } | null)?.feePlan;
  if (plan) insertPlan(tx, ctx, admission, feePlanSchema.parse(plan), 'Created payment plan');
});

admissionHooks.registerOnStatusChanged((tx, _ctx, _before, after) => {
  if (after.status === 'cancelled') {
    closeOpenInstalments(tx, after.id, 'cancelled', 'Admission cancelled');
  }
  if (after.status === 'withdrawn' && getAdmission(after.id, tx).outstandingMinor === 0) {
    // Balance written off: nothing remains to chase.
    closeOpenInstalments(tx, after.id, 'waived', 'Balance written off on withdrawal');
  }
});

