/**
 * The ledger: every balance in the system is computed here, from receipts and
 * adjustments, never stored. See docs/ARCHITECTURE.md §4 for the definitions.
 *
 * Each figure is a CORRELATED SUBQUERY per admission rather than a join. A
 * join from admissions to payments and adjustments multiplies rows (two
 * payments x three adjustments = six rows) and silently double-counts; a
 * subquery can only ever return one number per admission.
 *
 * Correlations use fully qualified "admissions".<column> references (see
 * qualified() in db/dialect.ts), so these expressions are correct both in an
 * outer query over admissions and nested inside a subquery over admissions.
 *
 * All expressions take an optional `asOf` calendar day for historical reports:
 * "what was outstanding at the end of 31 March" counts only receipts and
 * adjustments dated on or before that day, and treats an admission cancelled
 * later as still live on that date.
 */

import { sql, type SQL } from 'drizzle-orm';
import { qualified } from '../db/dialect';

const A = {
  id: qualified('admissions', 'id'),
  status: qualified('admissions', 'status'),
  agreedFeeMinor: qualified('admissions', 'agreed_fee_minor'),
  cancelledOn: qualified('admissions', 'cancelled_on'),
};

/** " and <column> <= ?" with the date bound as a parameter. `column` is always a literal from this file. */
const onOrBefore = (column: string, asOf?: string): SQL =>
  asOf ? sql`${sql.raw(` and ${column} <= `)}${asOf}` : sql``;

/** Σ succeeded incoming receipts for the admission. */
export function paidExpr(asOf?: string): SQL<number> {
  return sql<number>`coalesce((select sum(p.amount_minor) from payments p where p.admission_id = ${A.id} and p.status = 'succeeded' and p.direction = 'in'${onOrBefore('p.payment_date', asOf)}), 0)`;
}

/** Σ succeeded refunds paid back to the student. */
export function refundedExpr(asOf?: string): SQL<number> {
  return sql<number>`coalesce((select sum(p.amount_minor) from payments p where p.admission_id = ${A.id} and p.status = 'succeeded' and p.direction = 'refund'${onOrBefore('p.payment_date', asOf)}), 0)`;
}

/** Σ approved, non-voided discounts / waivers / write-offs after admission. */
export function adjustmentsExpr(asOf?: string): SQL<number> {
  return sql<number>`coalesce((select sum(f.amount_minor) from fee_adjustments f where f.admission_id = ${A.id} and f.voided_at is null${onOrBefore('f.effective_date', asOf)}), 0)`;
}

/** True when the admission no longer owes anything because it was cancelled (by `asOf`). */
function cancelledExpr(asOf?: string): SQL<boolean> {
  return asOf
    ? sql<boolean>`(${A.cancelledOn} is not null and ${A.cancelledOn} <= ${asOf})`
    : sql<boolean>`(${A.status} = 'cancelled')`;
}

/** max(0, agreed - adjustments - (paid - refunded)); zero once cancelled. */
export function outstandingExpr(asOf?: string): SQL<number> {
  return sql<number>`case when ${cancelledExpr(asOf)} then 0 else max(0, ${A.agreedFeeMinor} - ${adjustmentsExpr(asOf)} - (${paidExpr(asOf)} - ${refundedExpr(asOf)})) end`;
}

/**
 * Allocated to one instalment from succeeded incoming receipts. Correlated on
 * an outer alias `i` (instalments) -- used inside overdueExpr and the
 * instalment queries.
 */
export function instalmentPaidSql(asOf?: string): SQL<number> {
  return sql<number>`coalesce((select sum(pa.amount_minor) from payment_allocations pa join payments p on p.id = pa.payment_id where pa.instalment_id = i.id and p.status = 'succeeded' and p.direction = 'in'${onOrBefore('p.payment_date', asOf)}), 0)`;
}

/**
 * Σ unpaid amounts of active instalments due BEFORE `day` (an instalment is
 * due on its date and overdue from the next day).
 */
export function overdueExpr(day: string, asOf?: string): SQL<number> {
  return sql<number>`case when ${cancelledExpr(asOf)} then 0 else coalesce((select sum(max(0, i.amount_minor - ${instalmentPaidSql(asOf)})) from instalments i where i.admission_id = ${A.id} and i.state = 'active' and i.due_date < ${day}), 0) end`;
}

/** Whether the admission has a live fee plan. */
export function hasActivePlanExpr(): SQL<number> {
  return sql<number>`exists (select 1 from fee_plans fp where fp.admission_id = ${A.id} and fp.status = 'active')`;
}

/** Everything the AdmissionFinance DTO needs, as one select fragment. */
export function financeColumns(today: string, asOf?: string) {
  return {
    adjustmentsMinor: adjustmentsExpr(asOf).mapWith(Number),
    paidMinor: paidExpr(asOf).mapWith(Number),
    refundedMinor: refundedExpr(asOf).mapWith(Number),
    outstandingMinor: outstandingExpr(asOf).mapWith(Number),
    overdueMinor: overdueExpr(today, asOf).mapWith(Number),
    hasActivePlan: hasActivePlanExpr().mapWith((v) => Boolean(Number(v))),
  };
}
