/**
 * CLI: fill an EMPTY development database with DEMO data.   npm run db:demo
 *
 * DEMO DATA ONLY -- for trying the app, never for a real institute:
 *   - every person has an @demo.invalid email and a 90000xxxxx phone number;
 *   - every lead, student, course, batch and expense note says [DEMO DATA];
 *   - it refuses to run in production, and refuses if any admission exists,
 *     so it can never mix invented records into real ones.
 *
 * It also loads the campus and portal demo (see campusDemo.ts).
 *
 * It goes through the same services as the API (codes, fee schedules,
 * allocations, audit trail, hooks), so the demo obeys every business rule.
 * The random generator is seeded, so two runs on empty databases match.
 */

import { randomBytes } from 'node:crypto';
import { addDays, addMonths, DEFAULT_ROLE_PERMISSIONS, minDate, type Permission } from '@ims/shared';
import { and, asc, count, eq } from 'drizzle-orm';
import { isProduction } from '../config/env';
import { logger } from '../config/logger';
import { changeAdmissionStatus, createAdmission, getAdmission } from '../modules/admissions/admissions.service';
import { hashPassword } from '../modules/auth/password';
import { assignToBatch, saveBatch, saveTrainer } from '../modules/batches/batches.service';
import { createCourse } from '../modules/courses/courses.routes';
import { createExpense } from '../modules/expenses/expenses.routes';
import { addAdjustment } from '../modules/finance/adjustments.service';
import { changeLoanStatus, createLoan, recordDisbursement } from '../modules/finance/loans.service';
import { recordPayment, refundPayment, reversePayment } from '../modules/finance/payments.service';
import { changeLeadStatus, createLead } from '../modules/leads/leads.service';
import { runNotificationSweep } from '../modules/notifications/notifications.service';
import { addInterview, createApplication, setInterviewResult, setOutcome, setStage, updateProfile } from '../modules/placements/placements.service';
import { createSchedule } from '../modules/reports/delivery.service';
import { instituteToday } from '../services/clock';
import type { RequestContext } from '../utils/context';
import { loadCampusDemo } from './campusDemo';
import { closeDatabase, databaseLocation, db, sqlite } from './index';
import { getMigrationStatus } from './migrator';
import { admissions, expenseCategories, instalments, leadSources, placementProfiles, users } from './schema';

const MARK = '[DEMO DATA]';

/* Deterministic randomness (mulberry32). */
let seed = 20261012;
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const chance = (p: number) => rand() < p;
function pick<T>(items: readonly T[], weights?: readonly number[]): T {
  if (!weights) return items[Math.floor(rand() * items.length)]!;
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i += 1) {
    r -= weights[i]!;
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

const FIRST = ['Aarav', 'Diya', 'Ishaan', 'Ananya', 'Vihaan', 'Saanvi', 'Arjun', 'Meera', 'Kabir', 'Riya', 'Rohan', 'Priya', 'Aditya', 'Kavya', 'Siddharth', 'Nisha', 'Karthik', 'Lakshmi', 'Rahul', 'Sneha', 'Vikram', 'Pooja', 'Harish', 'Divya', 'Manoj', 'Swathi', 'Naveen', 'Keerthana', 'Suresh', 'Anjali', 'Farhan', 'Zoya', 'Gurpreet', 'Tanvi', 'Joel', 'Ayesha'];
const LAST = ['Sharma', 'Iyer', 'Reddy', 'Nair', 'Patel', 'Gupta', 'Menon', 'Rao', 'Kumar', 'Singh', 'Das', 'Pillai', 'Joshi', 'Krishnan', 'Bose', 'Khan', 'Fernandes', 'Verma'];
const COMPANIES = ['Infotech Solutions', 'Bluewave Analytics', 'CloudNest Systems', 'Brightpath Digital', 'Nimbus Retail', 'Greenleaf Finance', 'Pixel Forge Studios', 'Orbit Logistics'];

let phoneCounter = 0;
const person = () => {
  phoneCounter += 1;
  const first = pick(FIRST);
  const last = pick(LAST);
  return { name: `${first} ${last}`, phone: `9000${String(phoneCounter).padStart(6, '0')}`, email: `${first}.${last}.${phoneCounter}@demo.invalid`.toLowerCase() };
};

function method(): { method: string; referenceNumber?: string } {
  const m = pick(['upi', 'cash', 'bank_transfer', 'debit_card', 'cheque'] as const, [50, 20, 15, 10, 5]);
  return m === 'bank_transfer' || m === 'cheque' ? { method: m, referenceNumber: `DEMO${between(100000, 999999)}` } : { method: m };
}

async function main(): Promise<void> {
  if (isProduction) throw new Error('Refusing to load demo data in production.');
  const status = getMigrationStatus(sqlite);
  if (status.applied === 0 || status.pending.length > 0) throw new Error('Run "npm run db:migrate" and "npm run db:seed" first.');
  const existing = db.select({ n: count() }).from(admissions).get()?.n ?? 0;
  if (existing > 0) throw new Error(`This database already has ${existing} admission(s). Demo data is only loaded into an empty database, so it can never mix with real records.`);
  const owner = db.select().from(users).where(and(eq(users.role, 'owner'), eq(users.isActive, true))).get();
  if (!owner) throw new Error('No owner account. Run "npm run db:seed" first.');

  const ctx: RequestContext = { actorId: owner.id, actorName: owner.name, permissions: ['*'], isOwner: true, accountType: 'team' };
  const today = instituteToday();
  const start = addDays(today, -210);
  const failures: string[] = [];
  const attempt = <T>(label: string, fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  };

  /* Staff ------------------------------------------------------------ */
  const password = `Demo-${randomBytes(6).toString('base64url')}`;
  const hash = await hashPassword(password);
  const staffSpec: { name: string; email: string; extra: Permission[] }[] = [
    { name: 'Neha Counsellor (Demo)', email: 'neha.counsellor@demo.invalid', extra: [] },
    { name: 'Imran Counsellor (Demo)', email: 'imran.counsellor@demo.invalid', extra: [] },
    { name: 'Asha Accounts (Demo)', email: 'asha.accounts@demo.invalid', extra: ['payments:refund', 'feePlans:write', 'reports:financial', 'reports:export', 'expenses:write'] },
  ];
  const staff = staffSpec.map((s) =>
    db
      .insert(users)
      .values({ name: s.name, email: s.email, passwordHash: hash, role: 'staff', permissions: [...DEFAULT_ROLE_PERMISSIONS.staff, ...s.extra], mustChangePassword: true })
      .returning()
      .get(),
  );
  const counsellors = staff.slice(0, 2).map((u) => u.id);

  /* Courses, trainers, batches ----------------------------------------- */
  const courseSpec = [
    { code: 'FSD', name: 'Full Stack Web Development', fee: 8_500_000, adm: 1_500_000, n: 4, weeks: 24, track: 'technical', weight: 30 },
    { code: 'DAP', name: 'Data Analytics with Python', fee: 6_500_000, adm: 1_000_000, n: 3, weeks: 16, track: 'technical', weight: 28 },
    { code: 'CDO', name: 'Cloud & DevOps', fee: 7_500_000, adm: 1_500_000, n: 3, weeks: 20, track: 'technical', weight: 12 },
    { code: 'DMK', name: 'Digital Marketing', fee: 3_500_000, adm: 500_000, n: 2, weeks: 12, track: 'non_technical', weight: 20 },
    { code: 'BAT', name: 'Business Accounting & Tally', fee: 2_500_000, adm: 500_000, n: 2, weeks: 10, track: 'non_technical', weight: 10 },
  ] as const;
  const courses = courseSpec.map((c) => ({
    ...c,
    id: createCourse(ctx, { code: c.code, name: c.name, description: `${MARK} Sample course.`, durationWeeks: c.weeks, standardFeeMinor: c.fee, defaultAdmissionFeeMinor: c.adm, defaultInstalmentCount: c.n, placementTrack: c.track, modules: [] }).id,
  }));

  const trainerIds = ['Ramesh Trainer', 'Fatima Trainer', 'George Trainer', 'Lata Trainer'].map((name, i) => {
    const list = saveTrainer(ctx, { name: `${name} (Demo)`, email: `trainer${i + 1}@demo.invalid`, expertise: MARK });
    return list.find((t) => t.name === `${name} (Demo)`)!.id;
  });

  const batchPlan = courses.slice(0, 4).flatMap((c, i) => {
    const oldStart = addDays(today, -(c.weeks * 7 + 45));
    const runStart = addDays(today, -between(35, 60));
    return [
      { course: c, code: `${c.code}-DEMO-1`, name: `${c.name} · Batch 1`, start: oldStart, end: addDays(oldStart, c.weeks * 7), status: 'running', finalStatus: 'completed', trainer: trainerIds[i % 4]! },
      { course: c, code: `${c.code}-DEMO-2`, name: `${c.name} · Batch 2`, start: runStart, end: addDays(runStart, c.weeks * 7), status: 'running', finalStatus: 'running', trainer: trainerIds[(i + 1) % 4]! },
      { course: c, code: `${c.code}-DEMO-3`, name: `${c.name} · Batch 3`, start: addDays(today, between(7, 20)), end: addDays(today, c.weeks * 7 + 20), status: 'enrolling', finalStatus: 'enrolling', trainer: trainerIds[(i + 2) % 4]! },
    ];
  });
  const batches = batchPlan.map((b) => ({
    ...b,
    id: saveBatch(ctx, { batchCode: b.code, name: b.name, courseId: b.course.id, trainerId: b.trainer, startDate: b.start, endDate: b.end, capacity: 30, schedule: pick(['Mon–Fri 10:00–12:00', 'Mon–Fri 18:00–20:00', 'Sat–Sun 09:00–13:00']), status: b.status, notes: MARK }).id,
  }));

  /* Leads and admissions ------------------------------------------------ */
  const sources = db.select().from(leadSources).where(eq(leadSources.isActive, true)).all();
  const sourceWeights = sources.map((s) => (/google|facebook|instagram|meta/i.test(s.name) ? 5 : /walk|referral|website/i.test(s.name) ? 4 : 2));
  type Made = { id: string; courseIndex: number; admissionDate: string; studentName: string };
  const made: Made[] = [];

  for (let i = 0; i < 170; i += 1) {
    const p = person();
    const enquiryDate = addDays(start, Math.floor(210 * Math.sqrt(rand())));
    const courseIndex = courses.indexOf(pick(courses, courses.map((c) => c.weight)));
    const course = courses[courseIndex]!;
    const counsellorId = chance(0.9) ? pick(counsellors) : undefined;
    const lead = attempt('lead', () =>
      createLead(ctx, {
        name: p.name,
        phone: p.phone,
        email: chance(0.8) ? p.email : undefined,
        enquiryDate,
        leadSourceId: pick(sources, sourceWeights).id,
        interestedCourseId: course.id,
        counsellorId,
        priority: pick(['low', 'medium', 'high'] as const, [2, 5, 3]),
        campaignName: chance(0.3) ? pick(['Diwali offer', 'Weekend batch', 'Placement drive']) : undefined,
        notes: `${MARK} Sample enquiry.`,
      }),
    );
    if (!lead) continue;

    const age = Math.round((Date.parse(today) - Date.parse(enquiryDate)) / 86_400_000);
    const admissionDate = minDate(today, addDays(enquiryDate, between(2, 25)));
    if (age > 5 && chance(0.38) && admissionDate <= today) {
      const discount = chance(0.3) ? Math.round((course.fee * pick([5, 10])) / 100 / 100) * 100 : 0;
      const full = chance(0.25);
      const created = attempt('admission', () =>
        createAdmission(ctx, {
          leadId: lead.id,
          newStudent: { fullName: p.name, phone: p.phone, email: p.email, city: pick(['Chennai', 'Bengaluru', 'Coimbatore', 'Hyderabad', 'Kochi']), notes: `${MARK} Sample student.` },
          courseId: course.id,
          admissionDate,
          listFeeMinor: course.fee,
          discountMinor: discount,
          admissionFeeRequiredMinor: full ? 0 : course.adm,
          counsellorId: counsellorId ?? counsellors[0],
          notes: MARK,
          feePlan: full
            ? { planType: 'full_payment', startDate: admissionDate }
            : { planType: 'admission_plus_monthly', startDate: admissionDate, instalmentCount: course.n, firstDueDate: addMonths(admissionDate, 1) },
        }),
      );
      if (!created) continue;
      const admissionId = created.admission.id;
      made.push({ id: admissionId, courseIndex, admissionDate, studentName: p.name });

      // Pay instalments that have fallen due, mostly on time, some late, some not at all.
      const rows = db.select().from(instalments).where(and(eq(instalments.admissionId, admissionId), eq(instalments.state, 'active'))).orderBy(asc(instalments.dueDate)).all();
      for (const row of rows) {
        if (row.dueDate > today) break;
        const first = row.sequence === 1;
        if (!chance(first ? 0.93 : 0.8)) break;
        const paidOn = minDate(today, first ? row.dueDate : addDays(row.dueDate, between(-3, 12)));
        attempt('payment', () => recordPayment(ctx, { admissionId, paymentDate: paidOn < admissionDate ? admissionDate : paidOn, amountMinor: row.amountMinor, ...method(), notes: MARK }));
      }
    } else if (age > 2) {
      const status = pick(['contacted', 'counselling_scheduled', 'follow_up', 'interested', 'not_interested', 'lost', 'unreachable'] as const, [3, 2, 4, 3, 2, 2, 1]);
      const closed = status === 'not_interested' || status === 'lost';
      attempt('lead status', () =>
        changeLeadStatus(ctx, lead.id, {
          status,
          lostReason: closed ? pick(['Fee too high', 'Chose another institute', 'Timing does not suit', 'Not reachable after 3 calls']) : undefined,
          followUpDate: !closed && status !== 'unreachable' ? addDays(today, between(-4, 7)) : undefined,
          note: MARK,
        }),
      );
    }
  }

  /* Batches: older admissions into batch 1, recent ones into batch 2 ------ */
  for (const b of batches) {
    const window = made.filter((m) => courses[m.courseIndex]!.id === b.course.id);
    const forThis = b.code.endsWith('-1')
      ? window.filter((m) => m.admissionDate <= addDays(b.start, 14))
      : b.code.endsWith('-2')
        ? window.filter((m) => m.admissionDate > addDays(batches.find((x) => x.code === `${b.course.code}-DEMO-1`)!.start, 14) && m.admissionDate <= addDays(today, -12))
        : [];
    const eligible = forThis.filter((m) => db.select({ s: admissions.status }).from(admissions).where(eq(admissions.id, m.id)).get()?.s === 'active').slice(0, 28);
    if (eligible.length) attempt('assign', () => assignToBatch(ctx, { batchId: b.id, admissionIds: eligible.map((m) => m.id), assignedOn: b.code.endsWith('-1') ? b.start : minDate(today, addDays(b.start, 3)) }));
  }

  // Complete admissions whose course has run its length; this opens placement profiles.
  for (const m of made) {
    const course = courses[m.courseIndex]!;
    const doneOn = addDays(m.admissionDate, course.weeks * 7 + 7);
    const row = db.select({ s: admissions.status }).from(admissions).where(eq(admissions.id, m.id)).get();
    if (doneOn <= today && row?.s === 'active') attempt('complete', () => changeAdmissionStatus(ctx, m.id, { action: 'complete', date: doneOn }));
  }
  for (const b of batches.filter((x) => x.finalStatus === 'completed')) {
    attempt('batch status', () => saveBatch(ctx, { batchCode: b.code, name: b.name, courseId: b.course.id, trainerId: b.trainer, startDate: b.start, endDate: b.end, capacity: 30, status: 'completed', notes: MARK }, b.id));
  }

  /* Placement ------------------------------------------------------------ */
  const profiles = db.select().from(placementProfiles).all();
  for (const profile of profiles) {
    const eligibleOn = profile.eligibleOn ?? today;
    attempt('profile', () => updateProfile(ctx, profile.id, { track: profile.track, eligibleOn, resumeStatus: pick(['in_progress', 'ready', 'ready'] as const), skills: profile.track === 'technical' ? ['JavaScript', 'SQL', 'Git'] : ['Communication', 'Excel'], readinessScore: between(55, 95), coordinatorId: counsellors[1], notes: MARK }));
    if (chance(0.15)) continue; // still preparing
    attempt('stage', () => setStage(ctx, profile.id, { stage: 'ready' }));
    const apps = between(1, 3);
    let joined = false;
    for (let a = 0; a < apps; a += 1) {
      const appliedOn = minDate(today, addDays(eligibleOn, between(3, 25)));
      const detail = attempt('application', () => createApplication(ctx, { profileId: profile.id, companyName: pick(COMPANIES), jobTitle: profile.track === 'technical' ? pick(['Junior Developer', 'Data Analyst', 'Support Engineer']) : pick(['Marketing Executive', 'Accounts Assistant', 'Sales Associate']), appliedOn, location: pick(['Chennai', 'Bengaluru', 'Remote']), notes: MARK }));
      const app = detail?.applicationsList.find((x) => x.appliedOn === appliedOn && x.interviews.length === 0 && x.outcome === 'in_progress');
      if (!app) continue;
      const interviewDay = addDays(appliedOn, between(3, 10));
      if (interviewDay <= today) {
        const withRound = attempt('interview', () => addInterview(ctx, app.id, { roundNumber: 1, roundName: 'Technical / HR round', scheduledAt: `${interviewDay}T11:00:00+05:30`, mode: pick(['in_person', 'video'] as const) }));
        const interview = withRound?.applicationsList.find((x) => x.id === app.id)?.interviews[0];
        const passed = chance(0.6);
        if (interview) attempt('interview result', () => setInterviewResult(ctx, interview.id, { result: passed ? 'passed' : 'failed', feedback: MARK }));
        const offerOn = addDays(interviewDay, between(2, 7));
        if (passed && !joined && offerOn <= today && chance(0.75)) {
          const joiningOn = addDays(offerOn, between(7, 20));
          const joins = joiningOn <= today && chance(0.7);
          attempt('outcome', () => setOutcome(ctx, app.id, { outcome: joins ? 'joined' : 'offer_received', offerOn, joiningOn: joins ? joiningOn : null, offerPackageMinor: between(22, 60) * 1_000_000 }));
          joined = joins;
        } else if (!passed) {
          attempt('outcome', () => setOutcome(ctx, app.id, { outcome: 'rejected', rejectionReason: 'Not shortlisted after interview' }));
        }
      } else if (chance(0.5)) {
        attempt('upcoming interview', () => addInterview(ctx, app.id, { roundNumber: 1, roundName: 'First round', scheduledAt: `${addDays(today, between(1, 5))}T10:30:00+05:30`, mode: 'video' }));
      }
    }
  }

  /* Money events: refund, bounced cheque, discount, loans, withdrawal ------- */
  const paidAdmissions = made.filter((m) => db.select({ s: admissions.status }).from(admissions).where(eq(admissions.id, m.id)).get()?.s !== 'pending_payment');
  const refundTarget = paidAdmissions[3];
  if (refundTarget) attempt('refund', () => refundPayment(ctx, refundTarget.id, { amountMinor: 200_000, paymentDate: minDate(today, addDays(refundTarget.admissionDate, 10)), method: 'upi', reason: `${MARK} Partial refund for a duplicated charge` }));
  const chequeTarget = paidAdmissions[6];
  if (chequeTarget) {
    const bounced = attempt('cheque', () => recordPayment(ctx, { admissionId: chequeTarget.id, paymentDate: minDate(today, addDays(chequeTarget.admissionDate, 5)), amountMinor: 300_000, method: 'cheque', referenceNumber: 'DEMO-CHQ-1', notes: MARK }));
    if (bounced) attempt('reversal', () => reversePayment(ctx, bounced.payment.id, { reason: `${MARK} Cheque returned unpaid` }));
  }
  for (const m of paidAdmissions.slice(10, 12)) {
    attempt('discount', () => addAdjustment(ctx, m.id, { type: 'discount', amountMinor: 250_000, effectiveDate: minDate(today, addDays(m.admissionDate, 20)), reason: `${MARK} Merit scholarship` }));
  }
  // Loans go to students who still owe enough for a disbursement to make sense.
  const loanTargets = made.filter((m) => courses[m.courseIndex]!.fee >= 6_500_000 && getAdmission(m.id).outstandingMinor >= 3_000_000).slice(-3);
  loanTargets.forEach((m, i) => {
    const loan = attempt('loan', () => createLoan(ctx, { admissionId: m.id, financeType: 'external_loan', providerName: pick(['EduFin Bank (Demo)', 'StudyCredit NBFC (Demo)']), requestedMinor: 4_000_000, notes: MARK }));
    if (!loan) return;
    const applied = minDate(today, addDays(m.admissionDate, 2));
    attempt('loan applied', () => changeLoanStatus(ctx, loan.id, { status: 'applied', date: applied }));
    if (i === 0) {
      attempt('loan approved', () => changeLoanStatus(ctx, loan.id, { status: 'approved', date: minDate(today, addDays(applied, 6)), approvedMinor: 4_000_000 }));
      attempt('disbursement', () => recordDisbursement(ctx, loan.id, { disbursedOn: minDate(today, addDays(applied, 9)), amountMinor: 2_000_000, reference: 'DEMO-DISB-1', receivedByInstitute: true }));
    } else if (i === 1) attempt('loan review', () => changeLoanStatus(ctx, loan.id, { status: 'under_review', date: minDate(today, addDays(applied, 3)) }));
    else attempt('loan rejected', () => changeLoanStatus(ctx, loan.id, { status: 'rejected', date: minDate(today, addDays(applied, 5)), rejectionReason: `${MARK} Insufficient credit history` }));
  });
  const leaver = paidAdmissions[15];
  if (leaver) attempt('withdraw', () => changeAdmissionStatus(ctx, leaver.id, { action: 'withdraw', date: minDate(today, addDays(leaver.admissionDate, 30)), reason: `${MARK} Relocated to another city` }));

  /* Expenses ---------------------------------------------------------------- */
  const category = (name: string) => db.select().from(expenseCategories).where(eq(expenseCategories.name, name)).get()?.id;
  for (let month = 6; month >= 0; month -= 1) {
    const first = `${addMonths(today, -month).slice(0, 7)}-01`;
    const at = (day: number) => minDate(today, addDays(first, day - 1));
    const add = (name: string, day: number, amountMinor: number, description: string, payee?: string) => {
      const categoryId = category(name);
      if (categoryId && at(day) >= first) attempt('expense', () => createExpense(ctx, { expenseDate: at(day), categoryId, description: `${description} ${MARK}`, amountMinor, paymentMethod: pick(['bank_transfer', 'upi'] as const), referenceNumber: `DEMO-EXP-${month}-${day}`, payee }));
    };
    add('Rent', 1, 4_500_000, 'Office rent', 'Demo Properties');
    add('Internet', 5, 300_000, 'Broadband', 'Demo Telecom');
    add('Electricity', 8, between(600_000, 900_000), 'Electricity bill', 'Demo Power');
    add('Advertising', 10, between(15, 40) * 100_000, 'Google Ads', 'Google (demo)');
    add('Advertising', 20, between(10, 30) * 100_000, 'Meta Ads', 'Meta (demo)');
    add('Training Materials', 14, between(2, 8) * 100_000, 'Lab materials');
    if (chance(0.5)) add('Maintenance', 18, between(2, 6) * 100_000, 'AC servicing');
    if (month > 0 || today.slice(8, 10) >= '28') add('Salaries', 28, 18_000_000, 'Staff salaries');
  }

  /* An example schedule (paused, so it never emails anyone by surprise). */
  attempt('schedule', () => createSchedule(ctx, { name: 'Monthly owner pack (demo, paused)', format: 'pdf', cadence: 'monthly', timeOfDay: '08:00', dayOfMonth: 1, recipients: [owner.email], isActive: false }));

  /* Campus and portals: schedule, attendance, exams, material, certificates, drives, leave, tasks, inventory. */
  const campus = await loadCampusDemo(ctx);
  failures.push(...campus.failures);

  const { created } = runNotificationSweep();
  const counts = { admissions: made.length, staff: staff.length, courses: courses.length, batches: batches.length, placementProfiles: profiles.length, notifications: created, ...campus.counts };
  logger.info({ ...counts, database: databaseLocation }, 'Demo data loaded');
  if (failures.length) logger.warn({ skipped: failures.length, examples: failures.slice(0, 8) }, 'Some demo steps were skipped by business rules (expected occasionally)');
  // Printed once, for the demo staff accounts only. They must change it at first sign-in.
  console.log(`\nDEMO staff sign-in (development only): ${staffSpec.map((s) => s.email).join(', ')}\nTemporary password: ${password}\n`);
  if (campus.logins.password) console.log(`DEMO portal logins (development only)\n  Student: ${campus.logins.student ?? '-'}\n  Faculty: ${campus.logins.faculty ?? '-'}\n  Temporary password: ${campus.logins.password}\n`);
}

main()
  .catch((error) => {
    logger.error({ err: error }, 'Loading demo data failed');
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
