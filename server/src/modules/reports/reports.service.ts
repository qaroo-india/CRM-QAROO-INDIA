/**
 * Business intelligence: one dataset behind the dashboard, the report page,
 * the PDF and Excel exports and the scheduled emails.
 *
 * Counting rules (also in docs/ARCHITECTURE.md §7):
 *   - Leads: enquiries DATED in the period (enquiry_date), each counted once.
 *   - Converted: of those leads, the ones converted by the period's END -- a
 *     cohort rule, so a past month's rate does not drift as old leads convert.
 *   - Admissions: admissions dated in the period, excluding cancelled ones.
 *   - Collected / refunded: succeeded receipts and refunds by payment_date.
 *     A reversed (bounced) receipt never counts -- the money never arrived.
 *   - Outstanding / overdue: as of the end of `asOf` (the period end, capped
 *     at today), using the same ledger expressions as every other screen.
 *   - Expenses: recorded or approved, not voided, by expense_date. They are
 *     institute-wide, so they are withheld (null) while a course, source or
 *     counsellor filter is on rather than shown against the wrong slice.
 *
 * Every figure is an aggregate over one row per fact (one lead, one
 * admission, one payment), joined only to its single parent admission, so
 * nothing can be multiplied by a join.
 */

import {
  addDays,
  addMonths,
  bucketForRange,
  bucketKey,
  eachBucket,
  endOfMonth,
  minDate,
  resolvePeriod,
  resolveReportRange,
  startOfMonth,
  todayInZone,
  type AgeingBucket,
  type DashboardBatchProgress,
  type DashboardData,
  type DateRange,
  type Metric,
  type ReportAdmissionRow,
  type ReportCounsellorRow,
  type ReportCourseRow,
  type ReportDataset,
  type ReportExpenseRow,
  type ReportPaymentRow,
  type ReportQuery,
  type ReportSourceRow,
  type ResolvedPeriod,
} from '@ims/shared';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { instalmentPaidSql, outstandingExpr, overdueExpr, paidExpr, refundedExpr } from '../../services/ledger';
import { getSettings } from '../../services/settings';

/** Row lists in a report are capped; totals always cover everything. */
export const REPORT_ROW_CAP = 2000;

export interface Dimensions {
  courseId?: string | undefined;
  leadSourceId?: string | undefined;
  counsellorId?: string | undefined;
}

const num = (value: unknown): number => Number(value ?? 0);
const rate = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);
const hasDimension = (d: Dimensions) => Boolean(d.courseId || d.leadSourceId || d.counsellorId);

/* ------------------------------------------------------------------ *
 * Period resolution
 * ------------------------------------------------------------------ */

/**
 * `type` gives a complete report period around `reference` (default today);
 * otherwise `period` gives a dashboard-style rolling window (default this
 * month). Throws DateError (mapped to 422) for a bad custom range.
 */
export function resolveReportPeriod(q: ReportQuery, now: Date = new Date()): ResolvedPeriod {
  const { timezone, weekStartsOn } = getSettings();
  if (q.type) {
    return resolveReportRange(q.type, q.reference ?? todayInZone(timezone, now), { weekStartsOn, from: q.from, to: q.to });
  }
  return resolvePeriod(q.period ?? 'this_month', { timeZone: timezone, weekStartsOn, now, from: q.from, to: q.to });
}

/* ------------------------------------------------------------------ *
 * Scopes. Admission-side queries use the bare "admissions" table name, which
 * the ledger expressions correlate on; lead queries use the alias `l`.
 * ------------------------------------------------------------------ */

function admissionScope(d: Dimensions): SQL {
  const parts: SQL[] = [];
  if (d.courseId) parts.push(sql` and admissions.course_id = ${d.courseId}`);
  if (d.leadSourceId) parts.push(sql` and admissions.attributed_source_id = ${d.leadSourceId}`);
  if (d.counsellorId) parts.push(sql` and admissions.counsellor_id = ${d.counsellorId}`);
  return sql.join(parts, sql``);
}

function leadScope(d: Dimensions): SQL {
  const parts: SQL[] = [];
  if (d.courseId) parts.push(sql` and l.interested_course_id = ${d.courseId}`);
  if (d.leadSourceId) parts.push(sql` and l.lead_source_id = ${d.leadSourceId}`);
  if (d.counsellorId) parts.push(sql` and l.counsellor_id = ${d.counsellorId}`);
  return sql.join(parts, sql``);
}

const COUNTED_EXPENSE = sql.raw(`e.voided_at is null and e.approval_status in ('recorded', 'approved')`);
const SUCCEEDED_PAYMENT = sql.raw(`p.status = 'succeeded'`);

/* ------------------------------------------------------------------ *
 * Period totals
 * ------------------------------------------------------------------ */

interface PeriodTotals {
  leads: number;
  converted: number;
  admissions: number;
  agreedFeeMinor: number;
  collectedMinor: number;
  refundedMinor: number;
  receipts: number;
  expensesMinor: number;
  joined: number;
}

function periodTotals(range: DateRange, d: Dimensions): PeriodTotals {
  const lead = db.get<{ leads: number; converted: number }>(sql`
    select count(*) as leads,
           coalesce(sum(case when l.converted_on is not null and l.converted_on <= ${range.to} then 1 else 0 end), 0) as converted
    from leads l
    where l.enquiry_date between ${range.from} and ${range.to}${leadScope(d)}`);
  const adm = db.get<{ n: number; agreed: number }>(sql`
    select count(*) as n, coalesce(sum(admissions.agreed_fee_minor), 0) as agreed
    from admissions
    where admissions.admission_date between ${range.from} and ${range.to} and admissions.status <> 'cancelled'${admissionScope(d)}`);
  const cash = db.get<{ collected: number; refunded: number; receipts: number }>(sql`
    select coalesce(sum(case when p.direction = 'in' then p.amount_minor else 0 end), 0) as collected,
           coalesce(sum(case when p.direction = 'refund' then p.amount_minor else 0 end), 0) as refunded,
           coalesce(sum(case when p.direction = 'in' then 1 else 0 end), 0) as receipts
    from payments p join admissions on admissions.id = p.admission_id
    where ${SUCCEEDED_PAYMENT} and p.payment_date between ${range.from} and ${range.to}${admissionScope(d)}`);
  const exp = db.get<{ total: number }>(sql`
    select coalesce(sum(e.amount_minor), 0) as total from expenses e
    where ${COUNTED_EXPENSE} and e.expense_date between ${range.from} and ${range.to}`);
  const joined = db.get<{ n: number }>(sql`
    select count(distinct pa.student_id) as n
    from placement_applications pa
    join placement_profiles pp on pp.id = pa.profile_id
    join admissions on admissions.id = pp.admission_id
    where pa.outcome = 'joined' and pa.joining_on between ${range.from} and ${range.to}${admissionScope(d)}`);
  return {
    leads: num(lead?.leads),
    converted: num(lead?.converted),
    admissions: num(adm?.n),
    agreedFeeMinor: num(adm?.agreed),
    collectedMinor: num(cash?.collected),
    refundedMinor: num(cash?.refunded),
    receipts: num(cash?.receipts),
    expensesMinor: num(exp?.total),
    joined: num(joined?.n),
  };
}

/** Receivables at the end of `asOf`: overdue is capped per admission at what is still owed. */
function balancesAsOf(asOf: string, d: Dimensions): { outstandingMinor: number; overdueMinor: number } {
  const row = db.get<{ outstanding: number; overdue: number }>(sql`
    select coalesce(sum(o.outstanding), 0) as outstanding, coalesce(sum(min(o.overdue, o.outstanding)), 0) as overdue
    from (
      select ${outstandingExpr(asOf)} as outstanding, ${overdueExpr(asOf, asOf)} as overdue
      from admissions
      where admissions.admission_date <= ${asOf}${admissionScope(d)}
    ) o`);
  return { outstandingMinor: num(row?.outstanding), overdueMinor: num(row?.overdue) };
}

/**
 * Ageing of what is owed at the end of `asOf`. Unpaid instalments are aged by
 * days past due; an admission's owed amount is attributed to its OLDEST
 * unpaid instalments first (so a later discount never makes debt look
 * younger than it is), and whatever is left is "not yet due".
 */
function ageingAsOf(asOf: string, d: Dimensions): { bucket: AgeingBucket; amountMinor: number }[] {
  const owed = db.all<{ id: string; outstanding: number }>(sql`
    select o.id, o.outstanding from (
      select admissions.id as id, ${outstandingExpr(asOf)} as outstanding
      from admissions where admissions.admission_date <= ${asOf}${admissionScope(d)}
    ) o where o.outstanding > 0`);
  const totals: Record<AgeingBucket, number> = { not_due: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  if (owed.length === 0) return (Object.keys(totals) as AgeingBucket[]).map((bucket) => ({ bucket, amountMinor: 0 }));

  const unpaid = db.all<{ admissionId: string; days: number; unpaid: number }>(sql`
    select i.admission_id as admissionId,
           cast(julianday(${asOf}) - julianday(i.due_date) as integer) as days,
           max(0, i.amount_minor - ${instalmentPaidSql(asOf)}) as unpaid
    from instalments i join admissions on admissions.id = i.admission_id
    where i.state = 'active' and i.due_date < ${asOf} and admissions.admission_date <= ${asOf}${admissionScope(d)}
    order by i.admission_id, i.due_date`);
  const byAdmission = new Map<string, { days: number; unpaid: number }[]>();
  for (const row of unpaid) {
    if (num(row.unpaid) <= 0) continue;
    const list = byAdmission.get(row.admissionId) ?? [];
    list.push({ days: num(row.days), unpaid: num(row.unpaid) });
    byAdmission.set(row.admissionId, list);
  }

  const bucketFor = (days: number): AgeingBucket => (days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90_plus');
  for (const { id, outstanding } of owed) {
    let remaining = num(outstanding);
    // Oldest first (largest days).
    const items = (byAdmission.get(id) ?? []).sort((a, b) => b.days - a.days);
    for (const item of items) {
      if (remaining <= 0) break;
      const take = Math.min(item.unpaid, remaining);
      totals[bucketFor(item.days)] += take;
      remaining -= take;
    }
    totals.not_due += remaining;
  }
  return (Object.keys(totals) as AgeingBucket[]).map((bucket) => ({ bucket, amountMinor: totals[bucket] }));
}

/* ------------------------------------------------------------------ *
 * Trends
 * ------------------------------------------------------------------ */

function dailyCounts(query: SQL): Map<string, number> {
  return new Map(db.all<{ d: string; n: number }>(query).map((r) => [r.d, num(r.n)]));
}

function bucketise(keys: string[], daily: Map<string, number>, bucket: 'day' | 'week' | 'month', weekStartsOn: number): Map<string, number> {
  const out = new Map(keys.map((k) => [k, 0]));
  for (const [day, value] of daily) {
    const key = bucketKey(day, bucket, weekStartsOn);
    if (out.has(key)) out.set(key, (out.get(key) ?? 0) + value);
  }
  return out;
}

function trendSeries(range: DateRange, d: Dimensions, bucket: 'day' | 'week' | 'month', finance: boolean) {
  const { weekStartsOn } = getSettings();
  const keys = eachBucket(range, bucket, weekStartsOn);
  const leads = bucketise(keys, dailyCounts(sql`select l.enquiry_date as d, count(*) as n from leads l where l.enquiry_date between ${range.from} and ${range.to}${leadScope(d)} group by d`), bucket, weekStartsOn);
  const adms = bucketise(keys, dailyCounts(sql`select admissions.admission_date as d, count(*) as n from admissions where admissions.admission_date between ${range.from} and ${range.to} and admissions.status <> 'cancelled'${admissionScope(d)} group by d`), bucket, weekStartsOn);
  const trend = keys.map((key) => ({ key, leads: leads.get(key) ?? 0, admissions: adms.get(key) ?? 0 }));
  if (!finance) return { trend, cashTrend: null };

  const cashFor = (direction: 'in' | 'refund') =>
    bucketise(keys, dailyCounts(sql`select p.payment_date as d, sum(p.amount_minor) as n from payments p join admissions on admissions.id = p.admission_id where ${SUCCEEDED_PAYMENT} and p.direction = ${direction} and p.payment_date between ${range.from} and ${range.to}${admissionScope(d)} group by d`), bucket, weekStartsOn);
  const collected = cashFor('in');
  const refunded = cashFor('refund');
  const expenses = hasDimension(d)
    ? null
    : bucketise(keys, dailyCounts(sql`select e.expense_date as d, sum(e.amount_minor) as n from expenses e where ${COUNTED_EXPENSE} and e.expense_date between ${range.from} and ${range.to} group by d`), bucket, weekStartsOn);
  const cashTrend = keys.map((key) => ({
    key,
    collectedMinor: collected.get(key) ?? 0,
    refundedMinor: refunded.get(key) ?? 0,
    expensesMinor: expenses ? (expenses.get(key) ?? 0) : null,
  }));
  return { trend, cashTrend };
}

/* ------------------------------------------------------------------ *
 * Breakdowns
 * ------------------------------------------------------------------ */

function sourceRows(range: DateRange, d: Dimensions, finance: boolean): ReportSourceRow[] {
  const leads = db.all<{ id: string; leads: number; converted: number }>(sql`
    select l.lead_source_id as id, count(*) as leads,
           coalesce(sum(case when l.converted_on is not null and l.converted_on <= ${range.to} then 1 else 0 end), 0) as converted
    from leads l where l.enquiry_date between ${range.from} and ${range.to}${leadScope(d)} group by l.lead_source_id`);
  const adms = db.all<{ id: string; n: number }>(sql`
    select admissions.attributed_source_id as id, count(*) as n from admissions
    where admissions.admission_date between ${range.from} and ${range.to} and admissions.status <> 'cancelled' and admissions.attributed_source_id is not null${admissionScope(d)}
    group by admissions.attributed_source_id`);
  const cash = finance
    ? db.all<{ id: string; net: number }>(sql`
        select admissions.attributed_source_id as id,
               sum(case when p.direction = 'in' then p.amount_minor else -p.amount_minor end) as net
        from payments p join admissions on admissions.id = p.admission_id
        where ${SUCCEEDED_PAYMENT} and p.payment_date between ${range.from} and ${range.to} and admissions.attributed_source_id is not null${admissionScope(d)}
        group by admissions.attributed_source_id`)
    : [];
  const ids = new Set([...leads.map((r) => r.id), ...adms.map((r) => r.id), ...cash.map((r) => r.id)]);
  if (ids.size === 0) return [];
  const names = new Map(db.all<{ id: string; name: string }>(sql`select id, name from lead_sources`).map((r) => [r.id, r.name]));
  return [...ids]
    .map((id) => {
      const l = leads.find((r) => r.id === id);
      const n = num(l?.leads);
      const c = num(l?.converted);
      return {
        leadSourceId: id,
        name: names.get(id) ?? 'Unknown source',
        leads: n,
        converted: c,
        conversionRate: rate(c, n),
        admissions: num(adms.find((r) => r.id === id)?.n),
        collectedMinor: finance ? num(cash.find((r) => r.id === id)?.net) : null,
      };
    })
    .sort((a, b) => b.admissions - a.admissions || b.leads - a.leads || a.name.localeCompare(b.name));
}

function courseRows(range: DateRange, asOf: string, d: Dimensions, finance: boolean): ReportCourseRow[] {
  const leads = db.all<{ id: string; n: number }>(sql`
    select l.interested_course_id as id, count(*) as n from leads l
    where l.enquiry_date between ${range.from} and ${range.to} and l.interested_course_id is not null${leadScope(d)}
    group by l.interested_course_id`);
  const adms = db.all<{ id: string; n: number; agreed: number }>(sql`
    select admissions.course_id as id, count(*) as n, sum(admissions.agreed_fee_minor) as agreed from admissions
    where admissions.admission_date between ${range.from} and ${range.to} and admissions.status <> 'cancelled'${admissionScope(d)}
    group by admissions.course_id`);
  const cash = finance
    ? db.all<{ id: string; net: number }>(sql`
        select admissions.course_id as id, sum(case when p.direction = 'in' then p.amount_minor else -p.amount_minor end) as net
        from payments p join admissions on admissions.id = p.admission_id
        where ${SUCCEEDED_PAYMENT} and p.payment_date between ${range.from} and ${range.to}${admissionScope(d)}
        group by admissions.course_id`)
    : [];
  const owed = finance
    ? db.all<{ id: string; owed: number }>(sql`
        select o.id, sum(o.owed) as owed from (
          select admissions.course_id as id, ${outstandingExpr(asOf)} as owed from admissions
          where admissions.admission_date <= ${asOf}${admissionScope(d)}
        ) o group by o.id having sum(o.owed) > 0`)
    : [];
  const ids = new Set([...leads.map((r) => r.id), ...adms.map((r) => r.id), ...cash.map((r) => r.id), ...owed.map((r) => r.id)]);
  if (ids.size === 0) return [];
  const names = new Map(db.all<{ id: string; name: string }>(sql`select id, name from courses`).map((r) => [r.id, r.name]));
  return [...ids]
    .map((id) => {
      const a = adms.find((r) => r.id === id);
      return {
        courseId: id,
        name: names.get(id) ?? 'Unknown course',
        leads: num(leads.find((r) => r.id === id)?.n),
        admissions: num(a?.n),
        agreedFeeMinor: finance ? num(a?.agreed) : null,
        collectedMinor: finance ? num(cash.find((r) => r.id === id)?.net) : null,
        outstandingMinor: finance ? num(owed.find((r) => r.id === id)?.owed) : null,
      };
    })
    .sort((a, b) => b.admissions - a.admissions || b.leads - a.leads || a.name.localeCompare(b.name));
}

function counsellorRows(range: DateRange, d: Dimensions, finance: boolean): ReportCounsellorRow[] {
  const leads = db.all<{ id: string | null; leads: number; converted: number }>(sql`
    select l.counsellor_id as id, count(*) as leads,
           coalesce(sum(case when l.converted_on is not null and l.converted_on <= ${range.to} then 1 else 0 end), 0) as converted
    from leads l where l.enquiry_date between ${range.from} and ${range.to}${leadScope(d)} group by l.counsellor_id`);
  const adms = db.all<{ id: string | null; n: number }>(sql`
    select admissions.counsellor_id as id, count(*) as n from admissions
    where admissions.admission_date between ${range.from} and ${range.to} and admissions.status <> 'cancelled'${admissionScope(d)}
    group by admissions.counsellor_id`);
  const cash = finance
    ? db.all<{ id: string | null; net: number }>(sql`
        select admissions.counsellor_id as id, sum(case when p.direction = 'in' then p.amount_minor else -p.amount_minor end) as net
        from payments p join admissions on admissions.id = p.admission_id
        where ${SUCCEEDED_PAYMENT} and p.payment_date between ${range.from} and ${range.to}${admissionScope(d)}
        group by admissions.counsellor_id`)
    : [];
  const ids = new Set<string | null>([...leads.map((r) => r.id), ...adms.map((r) => r.id), ...cash.map((r) => r.id)]);
  if (ids.size === 0) return [];
  const names = new Map(db.all<{ id: string; name: string }>(sql`select id, name from users`).map((r) => [r.id, r.name]));
  return [...ids]
    .map((id) => {
      const l = leads.find((r) => r.id === id);
      const n = num(l?.leads);
      const c = num(l?.converted);
      return {
        userId: id,
        name: id ? (names.get(id) ?? 'Former user') : 'Unassigned',
        leads: n,
        converted: c,
        conversionRate: rate(c, n),
        admissions: num(adms.find((r) => r.id === id)?.n),
        collectedMinor: finance ? num(cash.find((r) => r.id === id)?.net) : null,
      };
    })
    .sort((a, b) => b.admissions - a.admissions || b.leads - a.leads || a.name.localeCompare(b.name));
}

function placementRows(range: DateRange, d: Dimensions): ReportDataset['placements'] {
  const rows = db.all<{ track: 'technical' | 'non_technical'; eligible: number; excluded: number; offered: number; joined: number }>(sql`
    select pp.track as track, count(*) as eligible,
           coalesce(sum(case when pp.stage in ('withdrawn', 'not_seeking') then 1 else 0 end), 0) as excluded,
           coalesce(sum(case when exists (select 1 from placement_applications pa where pa.profile_id = pp.id and pa.outcome in ('offer_received', 'offer_declined', 'joined')) then 1 else 0 end), 0) as offered,
           coalesce(sum(case when exists (select 1 from placement_applications pa where pa.profile_id = pp.id and pa.outcome = 'joined') then 1 else 0 end), 0) as joined
    from placement_profiles pp join admissions on admissions.id = pp.admission_id
    where pp.eligible_on between ${range.from} and ${range.to}${admissionScope(d)}
    group by pp.track`);
  return (['technical', 'non_technical'] as const).map((track) => {
    const r = rows.find((x) => x.track === track);
    const eligible = num(r?.eligible);
    const joined = num(r?.joined);
    return { track, eligible, offered: num(r?.offered), joined, placementRate: rate(joined, eligible - num(r?.excluded)) };
  });
}

/* ------------------------------------------------------------------ *
 * Row lists
 * ------------------------------------------------------------------ */

function admissionList(range: DateRange, asOf: string, d: Dimensions, finance: boolean): { rows: ReportAdmissionRow[]; truncated: boolean } {
  const rows = db.all<{
    admissionNumber: string; admissionDate: string; studentName: string; studentPhone: string; courseName: string;
    sourceName: string | null; counsellorName: string | null; status: string; agreed: number; paid: number; refunded: number; outstanding: number;
  }>(sql`
    select admissions.admission_number as admissionNumber, admissions.admission_date as admissionDate,
           s.full_name as studentName, s.phone as studentPhone, c.name as courseName,
           ls.name as sourceName, u.name as counsellorName, admissions.status as status,
           admissions.agreed_fee_minor as agreed, ${paidExpr(asOf)} as paid, ${refundedExpr(asOf)} as refunded, ${outstandingExpr(asOf)} as outstanding
    from admissions
    join students s on s.id = admissions.student_id
    join courses c on c.id = admissions.course_id
    left join lead_sources ls on ls.id = admissions.attributed_source_id
    left join users u on u.id = admissions.counsellor_id
    where admissions.admission_date between ${range.from} and ${range.to} and admissions.status <> 'cancelled'${admissionScope(d)}
    order by admissions.admission_date, admissions.admission_number
    limit ${REPORT_ROW_CAP + 1}`);
  return {
    truncated: rows.length > REPORT_ROW_CAP,
    rows: rows.slice(0, REPORT_ROW_CAP).map((r) => ({
      admissionNumber: r.admissionNumber,
      admissionDate: r.admissionDate,
      studentName: r.studentName,
      studentPhone: r.studentPhone,
      courseName: r.courseName,
      sourceName: r.sourceName,
      counsellorName: r.counsellorName,
      status: r.status,
      agreedFeeMinor: finance ? num(r.agreed) : null,
      paidMinor: finance ? num(r.paid) - num(r.refunded) : null,
      outstandingMinor: finance ? num(r.outstanding) : null,
    })),
  };
}

function paymentList(range: DateRange, d: Dimensions): { rows: ReportPaymentRow[]; truncated: boolean } {
  const rows = db.all<ReportPaymentRow>(sql`
    select p.receipt_number as receiptNumber, p.payment_date as paymentDate, s.full_name as studentName,
           admissions.admission_number as admissionNumber, c.name as courseName, p.direction as direction,
           p.method as method, p.payment_type as paymentType,
           case when p.direction = 'refund' then -p.amount_minor else p.amount_minor end as amountMinor
    from payments p
    join admissions on admissions.id = p.admission_id
    join students s on s.id = p.student_id
    join courses c on c.id = admissions.course_id
    where ${SUCCEEDED_PAYMENT} and p.payment_date between ${range.from} and ${range.to}${admissionScope(d)}
    order by p.payment_date, p.receipt_number
    limit ${REPORT_ROW_CAP + 1}`);
  return { truncated: rows.length > REPORT_ROW_CAP, rows: rows.slice(0, REPORT_ROW_CAP).map((r) => ({ ...r, amountMinor: num(r.amountMinor) })) };
}

function expenseList(range: DateRange): { rows: ReportExpenseRow[]; truncated: boolean } {
  const rows = db.all<ReportExpenseRow>(sql`
    select e.expense_code as expenseCode, e.expense_date as expenseDate, ec.name as categoryName, e.description as description,
           e.payee as payee, e.payment_method as method, e.amount_minor as amountMinor
    from expenses e join expense_categories ec on ec.id = e.category_id
    where ${COUNTED_EXPENSE} and e.expense_date between ${range.from} and ${range.to}
    order by e.expense_date, e.expense_code
    limit ${REPORT_ROW_CAP + 1}`);
  return { truncated: rows.length > REPORT_ROW_CAP, rows: rows.slice(0, REPORT_ROW_CAP).map((r) => ({ ...r, amountMinor: num(r.amountMinor) })) };
}

/* ------------------------------------------------------------------ *
 * Public builders
 * ------------------------------------------------------------------ */

function metric(current: number, previous: number): Metric {
  return { current, previous };
}

function filterEcho(d: Dimensions): ReportDataset['filters'] {
  const lookup = (table: string, id: string | undefined) =>
    id ? (db.get<{ name: string }>(sql`select name from ${sql.identifier(table)} where id = ${id}`)?.name ?? null) : null;
  return {
    courseId: d.courseId ?? null,
    courseName: lookup('courses', d.courseId),
    leadSourceId: d.leadSourceId ?? null,
    leadSourceName: lookup('lead_sources', d.leadSourceId),
    counsellorId: d.counsellorId ?? null,
    counsellorName: lookup('users', d.counsellorId),
  };
}

export interface BuildOptions {
  includeFinance: boolean;
  now?: Date;
  /** Row lists (admissions, payments, expenses); the dashboard skips them. */
  withRows?: boolean;
}

export function buildReport(q: ReportQuery, options: BuildOptions): ReportDataset {
  const now = options.now ?? new Date();
  const finance = options.includeFinance;
  const { timezone } = getSettings();
  const resolved = resolveReportPeriod(q, now);
  const { range, previous } = resolved;
  const today = todayInZone(timezone, now);
  const asOf = minDate(range.to, today);
  const d: Dimensions = { courseId: q.courseId, leadSourceId: q.leadSourceId, counsellorId: q.counsellorId };
  const dimensioned = hasDimension(d);

  const cur = periodTotals(range, d);
  const prev = periodTotals(previous, d);
  const bucket = bucketForRange(range);
  const { trend, cashTrend } = trendSeries(range, d, bucket, finance);

  const withRows = options.withRows ?? true;
  const admissionsList = withRows ? admissionList(range, asOf, d, finance) : { rows: [], truncated: false };
  const payments = finance ? (withRows ? paymentList(range, d) : { rows: [], truncated: false }) : null;
  const expenses = finance && !dimensioned ? (withRows ? expenseList(range) : { rows: [], truncated: false }) : null;

  const finSummary = finance
    ? (() => {
        const balances = balancesAsOf(asOf, d);
        const net = (t: PeriodTotals) => t.collectedMinor - t.refundedMinor;
        return {
          collectedMinor: metric(cur.collectedMinor, prev.collectedMinor),
          refundedMinor: metric(cur.refundedMinor, prev.refundedMinor),
          netCollectedMinor: metric(net(cur), net(prev)),
          receipts: metric(cur.receipts, prev.receipts),
          expensesMinor: dimensioned ? null : metric(cur.expensesMinor, prev.expensesMinor),
          netCashFlowMinor: dimensioned ? null : metric(net(cur) - cur.expensesMinor, net(prev) - prev.expensesMinor),
          outstandingMinor: balances.outstandingMinor,
          overdueMinor: balances.overdueMinor,
          agreedFeeMinor: metric(cur.agreedFeeMinor, prev.agreedFeeMinor),
        };
      })()
    : null;

  return {
    generatedAt: now.toISOString(),
    timeZone: timezone,
    label: resolved.label,
    range,
    previous,
    asOf,
    bucket,
    filters: filterEcho(d),
    includesFinance: finance,
    summary: {
      leads: metric(cur.leads, prev.leads),
      convertedLeads: metric(cur.converted, prev.converted),
      conversionRate: { current: rate(cur.converted, cur.leads), previous: rate(prev.converted, prev.leads) },
      admissions: metric(cur.admissions, prev.admissions),
      placementsJoined: metric(cur.joined, prev.joined),
      finance: finSummary,
    },
    trend,
    cashTrend,
    sources: sourceRows(range, d, finance),
    courses: courseRows(range, asOf, d, finance),
    counsellors: counsellorRows(range, d, finance),
    paymentMethods: finance
      ? db
          .all<{ method: string; receipts: number; amountMinor: number }>(sql`
            select p.method as method, count(*) as receipts, sum(p.amount_minor) as amountMinor
            from payments p join admissions on admissions.id = p.admission_id
            where ${SUCCEEDED_PAYMENT} and p.direction = 'in' and p.payment_date between ${range.from} and ${range.to}${admissionScope(d)}
            group by p.method order by amountMinor desc`)
          .map((r) => ({ method: r.method, receipts: num(r.receipts), amountMinor: num(r.amountMinor) }))
      : null,
    expenseCategories:
      finance && !dimensioned
        ? db
            .all<{ categoryId: string; name: string; count: number; amountMinor: number }>(sql`
              select ec.id as categoryId, ec.name as name, count(*) as count, sum(e.amount_minor) as amountMinor
              from expenses e join expense_categories ec on ec.id = e.category_id
              where ${COUNTED_EXPENSE} and e.expense_date between ${range.from} and ${range.to}
              group by ec.id, ec.name order by amountMinor desc`)
            .map((r) => ({ ...r, count: num(r.count), amountMinor: num(r.amountMinor) }))
        : null,
    ageing: finance ? ageingAsOf(asOf, d) : null,
    placements: placementRows(range, d),
    admissionRows: admissionsList.rows,
    paymentRows: payments?.rows ?? null,
    expenseRows: expenses?.rows ?? null,
    truncated: { admissions: admissionsList.truncated, payments: payments?.truncated ?? false, expenses: expenses?.truncated ?? false },
  };
}

/* ------------------------------------------------------------------ *
 * Dashboard = the period report + live operational counts
 * ------------------------------------------------------------------ */

function liveCounts(today: string, d: Dimensions, finance: boolean): DashboardData['live'] {
  const scope = admissionScope(d);
  const count = (query: SQL) => num(db.get<{ n: number }>(query)?.n);
  const openLead = sql.raw(`l.status not in ('converted', 'not_interested', 'lost', 'unreachable')`);
  const weekEnd = addDays(today, 6);
  return {
    activeStudents: count(sql`select count(distinct admissions.student_id) as n from admissions where admissions.status = 'active'${scope}`),
    pendingPaymentAdmissions: count(sql`select count(*) as n from admissions where admissions.status = 'pending_payment'${scope}`),
    unassignedStudents: count(sql`
      select count(*) as n from admissions
      where admissions.status in ('pending_payment', 'active')
        and not exists (select 1 from batch_assignments ba where ba.admission_id = admissions.id and ba.status = 'active')${scope}`),
    followUpsDueToday: count(sql`select count(*) as n from leads l where ${openLead} and l.follow_up_date = ${today}${leadScope(d)}`),
    overdueFollowUps: count(sql`select count(*) as n from leads l where ${openLead} and l.follow_up_date < ${today}${leadScope(d)}`),
    openLeads: count(sql`select count(*) as n from leads l where ${openLead}${leadScope(d)}`),
    instalmentsDueThisWeek: finance
      ? count(sql`
          select count(*) as n from instalments i join admissions on admissions.id = i.admission_id
          where i.state = 'active' and admissions.status <> 'cancelled' and i.due_date between ${today} and ${weekEnd}
            and i.amount_minor > ${instalmentPaidSql()}${scope}`)
      : null,
    overdueInstalments: finance
      ? count(sql`
          select count(*) as n from instalments i join admissions on admissions.id = i.admission_id
          where i.state = 'active' and admissions.status <> 'cancelled' and i.due_date < ${today}
            and i.amount_minor > ${instalmentPaidSql()}${scope}`)
      : null,
    pendingExpenseApprovals: finance ? count(sql`select count(*) as n from expenses e where e.voided_at is null and e.approval_status = 'pending'`) : null,
    activeLoans: finance
      ? count(sql`select count(*) as n from loans join admissions on admissions.id = loans.admission_id where loans.status in ('applied', 'under_review', 'approved')${scope}`)
      : null,
  };
}

function monthlySeries(to: string, d: Dimensions, finance: boolean): DashboardData['monthly'] {
  const from = startOfMonth(addMonths(startOfMonth(to), -11));
  const end = endOfMonth(to);
  const months = eachBucket({ from, to: end }, 'month');
  const group = (query: SQL) => new Map(db.all<{ m: string; n: number }>(query).map((r) => [r.m, num(r.n)]));
  const leads = group(sql`select substr(l.enquiry_date, 1, 7) as m, count(*) as n from leads l where l.enquiry_date between ${from} and ${end}${leadScope(d)} group by m`);
  const adms = group(sql`select substr(admissions.admission_date, 1, 7) as m, count(*) as n from admissions where admissions.admission_date between ${from} and ${end} and admissions.status <> 'cancelled'${admissionScope(d)} group by m`);
  const cash = finance
    ? group(sql`
        select substr(p.payment_date, 1, 7) as m, sum(case when p.direction = 'in' then p.amount_minor else -p.amount_minor end) as n
        from payments p join admissions on admissions.id = p.admission_id
        where ${SUCCEEDED_PAYMENT} and p.payment_date between ${from} and ${end}${admissionScope(d)} group by m`)
    : null;
  return months.map((month) => ({ month, leads: leads.get(month) ?? 0, admissions: adms.get(month) ?? 0, netCollectedMinor: cash ? (cash.get(month) ?? 0) : null }));
}

function batchProgress(today: string, d: Dimensions): DashboardBatchProgress[] {
  const course = d.courseId ? sql` and b.course_id = ${d.courseId}` : sql``;
  const rows = db.all<{ id: string; batchCode: string; name: string; courseName: string; status: string; startDate: string; endDate: string | null; capacity: number; enrolled: number }>(sql`
    select b.id, b.batch_code as batchCode, b.name, c.name as courseName, b.status, b.start_date as startDate, b.end_date as endDate, b.capacity,
           (select count(*) from batch_assignments ba where ba.batch_id = b.id and ba.status = 'active') as enrolled
    from batches b join courses c on c.id = b.course_id
    where b.status in ('planned', 'enrolling', 'running')${course}
    order by case b.status when 'running' then 0 when 'enrolling' then 1 else 2 end, b.start_date
    limit 8`);
  return rows.map((r) => {
    let progress: number | null = null;
    if (r.endDate) {
      const total = (Date.parse(r.endDate) - Date.parse(r.startDate)) / 86_400_000 + 1;
      const elapsed = (Date.parse(today) - Date.parse(r.startDate)) / 86_400_000 + 1;
      progress = Math.min(1, Math.max(0, elapsed / total));
    }
    return { ...r, capacity: num(r.capacity), enrolled: num(r.enrolled), progress };
  });
}

export function buildDashboard(q: ReportQuery, options: BuildOptions): DashboardData {
  const now = options.now ?? new Date();
  const report = buildReport(q, { ...options, now, withRows: false });
  const d: Dimensions = { courseId: q.courseId, leadSourceId: q.leadSourceId, counsellorId: q.counsellorId };
  const today = todayInZone(report.timeZone, now);
  return {
    ...report,
    live: liveCounts(today, d, options.includeFinance),
    monthly: monthlySeries(report.range.to, d, options.includeFinance),
    batches: batchProgress(today, d),
  };
}
