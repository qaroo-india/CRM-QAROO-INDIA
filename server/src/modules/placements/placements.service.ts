/**
 * Placement profiles, applications, interviews and analytics.
 *
 * Definitions (docs/ARCHITECTURE.md §4):
 *   - PLACED means an application reached 'joined'. Applying, interviewing,
 *     selection and offers are tracked but are never placement.
 *   - Rates are over a COHORT: students who became eligible in the period.
 *     Students who withdrew or are not seeking placement leave the
 *     denominator. Each student counts once however many offers they hold.
 *   - Stages advance automatically with real events and never move backwards
 *     by themselves; a coordinator can still set any stage by hand.
 */

import {
  applicationListQuerySchema,
  applicationOutcomeSchema,
  applicationSchema,
  companySchema,
  eachBucket,
  zonedDayBounds,
  interviewResultSchema,
  interviewSchema,
  placementAnalyticsQuerySchema,
  placementProfileSchema,
  placementProfileUpdateSchema,
  profileListQuerySchema,
  profileStageSchema,
  type ApplicationDto,
  type CompanyDto,
  type InterviewDto,
  type PlacementAnalytics,
  type PlacementFunnel,
  type PlacementProfileDetail,
  type PlacementProfileDto,
  type PlacementStage,
} from '@ims/shared';
import { and, asc, count, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';
import { db } from '../../db';
import { qualified } from '../../db/dialect';
import {
  admissions,
  companies,
  courses,
  interviews,
  jobCategories,
  placementApplications,
  placementProfiles,
  students,
  users,
  type Admission,
  type PlacementProfile,
} from '../../db/schema';
import type { DbLike, Tx } from '../../db/types';
import { diff, recordAudit } from '../../services/audit';
import { getSettings } from '../../services/settings';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { containsText, pageWindow, paginated } from '../../utils/pagination';
import { admissionHooks } from '../admissions/hooks';
import { notifyPermission, safely } from '../notifications/notifications.service';

const coordinator = alias(users, 'coordinator');
const P_ID = qualified('placement_profiles', 'id');

/** The happy-path order; a stage only auto-advances to one later in this list. */
const PROGRESSION: PlacementStage[] = ['eligible', 'resume_preparation', 'ready', 'applied', 'interview_scheduled', 'interviewing', 'selected', 'offer_received', 'joined'];

export async function advance(tx: DbLike, profile: PlacementProfile, to: PlacementStage): Promise<void> {
  const from = PROGRESSION.indexOf(profile.stage);
  const target = PROGRESSION.indexOf(to);
  // Off-path stages (on hold, withdrawn, not seeking, rejected) are a coordinator's call.
  if (from === -1 || target <= from) return;
  await tx.update(placementProfiles).set({ stage: to, stageChangedAt: new Date() }).where(eq(placementProfiles.id, profile.id)).run();
}

/* ------------------------------------------------------------------ *
 * Profiles
 * ------------------------------------------------------------------ */

function profileQuery(database: DbLike = db) {
  return database
    .select({
      p: placementProfiles,
      studentName: students.fullName,
      studentCode: students.studentCode,
      studentPhone: students.phone,
      admissionNumber: admissions.admissionNumber,
      courseName: courses.name,
      coordinatorName: coordinator.name,
      applications: sql<number>`(select count(*) from placement_applications pa where pa.profile_id = ${P_ID})`.mapWith(Number),
      interviewsUpcoming: sql<number>`(select count(*) from interviews i join placement_applications pa on pa.id = i.application_id where pa.profile_id = ${P_ID} and i.result = 'scheduled' and i.scheduled_at >= ${Date.now()})`.mapWith(Number),
      placed: sql<number>`exists (select 1 from placement_applications pa where pa.profile_id = ${P_ID} and pa.outcome = 'joined')`.mapWith((v) => Boolean(Number(v))),
    })
    .from(placementProfiles)
    .innerJoin(students, eq(students.id, placementProfiles.studentId))
    .innerJoin(admissions, eq(admissions.id, placementProfiles.admissionId))
    .innerJoin(courses, eq(courses.id, admissions.courseId))
    .leftJoin(coordinator, eq(coordinator.id, placementProfiles.coordinatorId));
}

type ProfileRow = Awaited<ReturnType<ReturnType<typeof profileQuery>['all']>>[number];

function toProfileDto(r: ProfileRow): PlacementProfileDto {
  const p = r.p;
  return {
    id: p.id,
    studentId: p.studentId,
    studentName: r.studentName,
    studentCode: r.studentCode,
    studentPhone: r.studentPhone,
    admissionId: p.admissionId,
    admissionNumber: r.admissionNumber,
    courseName: r.courseName,
    track: p.track,
    stage: p.stage,
    eligibleOn: p.eligibleOn,
    resumeStatus: p.resumeStatus,
    skills: p.skills,
    readinessScore: p.readinessScore,
    coordinatorId: p.coordinatorId,
    coordinatorName: r.coordinatorName,
    notes: p.notes,
    applications: r.applications,
    interviewsUpcoming: r.interviewsUpcoming,
    placed: r.placed,
    stageChangedAt: p.stageChangedAt?.toISOString() ?? null,
  };
}

export async function listProfiles(q: z.output<typeof profileListQuerySchema>) {
  const conditions: SQL[] = [];
  if (q.q) conditions.push(or(containsText(students.fullName, q.q), containsText(students.studentCode, q.q), containsText(admissions.admissionNumber, q.q))!);
  if (q.track) conditions.push(eq(placementProfiles.track, q.track));
  if (q.stage?.length) conditions.push(inArray(placementProfiles.stage, q.stage));
  if (q.courseId) conditions.push(eq(admissions.courseId, q.courseId));
  if (q.coordinatorId) conditions.push(eq(placementProfiles.coordinatorId, q.coordinatorId));
  if (q.studentId) conditions.push(eq(placementProfiles.studentId, q.studentId));
  const where = and(...conditions);
  const total = (await db.select({ n: count() }).from(placementProfiles).innerJoin(students, eq(students.id, placementProfiles.studentId)).innerJoin(admissions, eq(admissions.id, placementProfiles.admissionId)).where(where).get())?.n ?? 0;
  const { limit, offset } = pageWindow(q.page, q.limit);
  const rows = await profileQuery().where(where).orderBy(desc(placementProfiles.updatedAt)).limit(limit).offset(offset).all();
  return paginated(rows.map(toProfileDto), total, q.page, q.limit);
}

export async function getProfileRow(id: string, database: DbLike = db): Promise<PlacementProfile> {
  const row = await database.select().from(placementProfiles).where(eq(placementProfiles.id, id)).get();
  if (!row) throw ApiError.notFound('Placement profile');
  return row;
}

export async function getProfile(id: string): Promise<PlacementProfileDetail> {
  const row = await profileQuery().where(eq(placementProfiles.id, id)).get();
  if (!row) throw ApiError.notFound('Placement profile');
  return { ...toProfileDto(row), applicationsList: await applicationsWhere(eq(placementApplications.profileId, id)) };
}

async function trackFor(admission: Admission, requested?: 'technical' | 'non_technical'): Promise<'technical' | 'non_technical'> {
  const course = (await db.select({ track: courses.placementTrack, name: courses.name }).from(courses).where(eq(courses.id, admission.courseId)).get())!;
  if (!course.track) throw ApiError.unprocessable(`${course.name} has no placement support.`, 'NO_PLACEMENT_TRACK');
  if (course.track === 'both') return requested ?? 'technical';
  if (requested && requested !== course.track) {
    throw ApiError.validation([{ path: 'track', message: `${course.name} supports ${course.track.replace('_', '-')} placement only` }]);
  }
  return course.track;
}

export async function createProfile(ctx: RequestContext, raw: unknown): Promise<PlacementProfileDetail> {
  const input = placementProfileSchema.parse(raw);
  const admission = await db.select().from(admissions).where(eq(admissions.id, input.admissionId)).get();
  if (!admission) throw ApiError.notFound('Admission');
  if (['cancelled'].includes(admission.status)) throw ApiError.unprocessable('This admission is cancelled.', 'ADMISSION_CANCELLED');
  if (await db.select({ id: placementProfiles.id }).from(placementProfiles).where(eq(placementProfiles.admissionId, admission.id)).get()) {
    throw ApiError.conflict('This admission already has a placement profile.', 'PROFILE_EXISTS');
  }
  const track = await trackFor(admission, input.track);
  const id = await db.transaction(async (tx) => {
    const row = await tx
      .insert(placementProfiles)
      .values({ ...input, track, studentId: admission.studentId, notes: input.notes ?? null, eligibleOn: input.eligibleOn ?? admission.completedOn ?? null, stageChangedAt: new Date() })
      .returning()
      .get();
    await recordAudit(tx, ctx, { action: 'create', entityType: 'placement_profile', entityId: row.id, summary: `Opened ${track.replace('_', '-')} placement profile for ${admission.admissionNumber}`, after: row });
    return row.id;
  });
  return await getProfile(id);
}

export async function updateProfile(ctx: RequestContext, id: string, raw: unknown): Promise<PlacementProfileDetail> {
  const input = placementProfileUpdateSchema.parse(raw);
  const existing = await getProfileRow(id);
  const admission = (await db.select().from(admissions).where(eq(admissions.id, existing.admissionId)).get())!;
  const track = await trackFor(admission, input.track);
  await db.transaction(async (tx) => {
    const updated = await tx.update(placementProfiles).set({ ...input, track, notes: input.notes ?? null }).where(eq(placementProfiles.id, id)).returning().get();
    await recordAudit(tx, ctx, { action: 'update', entityType: 'placement_profile', entityId: id, summary: 'Updated placement profile', ...diff(existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>) });
  });
  return await getProfile(id);
}

export async function setStage(ctx: RequestContext, id: string, raw: unknown): Promise<PlacementProfileDetail> {
  const input = profileStageSchema.parse(raw);
  const existing = await getProfileRow(id);
  if (input.stage === 'joined') {
    const joined = await db.select({ id: placementApplications.id }).from(placementApplications).where(and(eq(placementApplications.profileId, id), eq(placementApplications.outcome, 'joined'))).get();
    if (!joined) throw ApiError.unprocessable('Mark the application the student joined; "joined" comes from an application, not by hand.', 'JOIN_NEEDS_APPLICATION');
  }
  await db.transaction(async (tx) => {
    await tx.update(placementProfiles).set({ stage: input.stage, stageChangedAt: new Date() }).where(eq(placementProfiles.id, id)).run();
    await recordAudit(tx, ctx, { action: 'status_change', entityType: 'placement_profile', entityId: id, summary: `Placement stage: ${existing.stage.replace(/_/g, ' ')} → ${input.stage.replace(/_/g, ' ')}${input.note ? ` (${input.note})` : ''}`, before: { stage: existing.stage }, after: { stage: input.stage } });
  });
  return await getProfile(id);
}

/* ------------------------------------------------------------------ *
 * Companies and applications
 * ------------------------------------------------------------------ */

export async function listCompanies(): Promise<CompanyDto[]> {
  const C_ID = qualified('companies', 'id');
  return (await db
    .select({
      c: companies,
      applications: sql<number>`(select count(*) from placement_applications pa where pa.company_id = ${C_ID})`.mapWith(Number),
      joined: sql<number>`(select count(*) from placement_applications pa where pa.company_id = ${C_ID} and pa.outcome = 'joined')`.mapWith(Number),
    })
    .from(companies)
    .orderBy(asc(companies.name))
    .all())
    .map(({ c, applications, joined }) => ({ id: c.id, name: c.name, website: c.website, industry: c.industry, applications, joined }));
}

export async function ensureCompany(tx: Tx, ctx: RequestContext, companyId: string | null, companyName?: string): Promise<string> {
  if (companyId) {
    if (!await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).get()) throw ApiError.validation([{ path: 'companyId', message: 'Unknown company' }]);
    return companyId;
  }
  const name = companyName!.trim();
  const existing = await tx.select({ id: companies.id }).from(companies).where(sql`lower(${companies.name}) = lower(${name})`).get();
  if (existing) return existing.id;
  const row = await tx.insert(companies).values({ name }).returning().get();
  await recordAudit(tx, ctx, { action: 'create', entityType: 'company', entityId: row.id, summary: `Added company ${name}` });
  return row.id;
}

export async function createCompany(ctx: RequestContext, raw: unknown): Promise<CompanyDto[]> {
  const input = companySchema.parse(raw);
  if (await db.select({ id: companies.id }).from(companies).where(sql`lower(${companies.name}) = lower(${input.name})`).get()) {
    throw ApiError.conflict(`${input.name} already exists.`);
  }
  await db.transaction(async (tx) => {
    const row = await tx.insert(companies).values({ name: input.name, website: input.website ?? null, industry: input.industry ?? null, notes: input.notes ?? null }).returning().get();
    await recordAudit(tx, ctx, { action: 'create', entityType: 'company', entityId: row.id, summary: `Added company ${row.name}` });
  });
  return await listCompanies();
}

async function interviewsFor(applicationIds: string[]): Promise<InterviewDto[]> {
  if (!applicationIds.length) return [];
  return (await db
    .select()
    .from(interviews)
    .where(inArray(interviews.applicationId, applicationIds))
    .orderBy(asc(interviews.roundNumber), asc(interviews.scheduledAt))
    .all())
    .map((i) => ({ id: i.id, applicationId: i.applicationId, roundNumber: i.roundNumber, roundName: i.roundName, scheduledAt: i.scheduledAt.toISOString(), mode: i.mode, result: i.result, feedback: i.feedback }));
}

async function applicationsWhere(where: SQL | undefined, limit?: number, offset?: number): Promise<ApplicationDto[]> {
  let query = db
    .select({ a: placementApplications, companyName: companies.name, categoryName: jobCategories.name, studentName: students.fullName, track: placementProfiles.track })
    .from(placementApplications)
    .innerJoin(companies, eq(companies.id, placementApplications.companyId))
    .innerJoin(students, eq(students.id, placementApplications.studentId))
    .innerJoin(placementProfiles, eq(placementProfiles.id, placementApplications.profileId))
    .leftJoin(jobCategories, eq(jobCategories.id, placementApplications.jobCategoryId))
    .where(where)
    .orderBy(desc(placementApplications.appliedOn), desc(placementApplications.createdAt))
    .$dynamic();
  if (limit !== undefined) query = query.limit(limit).offset(offset ?? 0);
  const rows = await query.all();
  const all = await interviewsFor(rows.map((r) => r.a.id));
  return rows.map(({ a, companyName, categoryName, studentName, track }) => ({
    id: a.id,
    profileId: a.profileId,
    studentId: a.studentId,
    studentName,
    track,
    companyId: a.companyId,
    companyName,
    jobTitle: a.jobTitle,
    jobCategoryId: a.jobCategoryId,
    jobCategoryName: categoryName,
    location: a.location,
    appliedOn: a.appliedOn,
    source: a.source,
    jobDescriptionRef: a.jobDescriptionRef,
    outcome: a.outcome,
    rejectionReason: a.rejectionReason,
    offerPackageMinor: a.offerPackageMinor,
    offerOn: a.offerOn,
    joiningOn: a.joiningOn,
    notes: a.notes,
    interviews: all.filter((i) => i.applicationId === a.id),
  }));
}

export async function listApplications(q: z.output<typeof applicationListQuerySchema>) {
  const conditions: SQL[] = [];
  if (q.q) conditions.push(or(containsText(students.fullName, q.q), containsText(companies.name, q.q), containsText(placementApplications.jobTitle, q.q))!);
  if (q.track) conditions.push(eq(placementProfiles.track, q.track));
  if (q.outcome?.length) conditions.push(inArray(placementApplications.outcome, q.outcome));
  if (q.companyId) conditions.push(eq(placementApplications.companyId, q.companyId));
  if (q.profileId) conditions.push(eq(placementApplications.profileId, q.profileId));
  if (q.from) conditions.push(sql`${placementApplications.appliedOn} >= ${q.from}`);
  if (q.to) conditions.push(sql`${placementApplications.appliedOn} <= ${q.to}`);
  const where = and(...conditions);
  const total =
    (await db
      .select({ n: count() })
      .from(placementApplications)
      .innerJoin(companies, eq(companies.id, placementApplications.companyId))
      .innerJoin(students, eq(students.id, placementApplications.studentId))
      .innerJoin(placementProfiles, eq(placementProfiles.id, placementApplications.profileId))
      .where(where)
      .get())?.n ?? 0;
  const { limit, offset } = pageWindow(q.page, q.limit);
  return paginated(await applicationsWhere(where, limit, offset), total, q.page, q.limit);
}

async function getApplicationRow(id: string, database: DbLike = db) {
  const row = await database.select().from(placementApplications).where(eq(placementApplications.id, id)).get();
  if (!row) throw ApiError.notFound('Application');
  return row;
}

export async function createApplication(ctx: RequestContext, raw: unknown): Promise<PlacementProfileDetail> {
  const input = applicationSchema.parse(raw);
  const profile = await getProfileRow(input.profileId);
  if (['withdrawn', 'not_seeking'].includes(profile.stage)) {
    throw ApiError.unprocessable('This student is not seeking placement; change their stage first.', 'NOT_SEEKING');
  }
  await db.transaction(async (tx) => {
    const companyId = await ensureCompany(tx, ctx, input.companyId, input.companyName);
    const row = await tx
      .insert(placementApplications)
      .values({
        profileId: profile.id,
        studentId: profile.studentId,
        companyId,
        jobTitle: input.jobTitle,
        jobCategoryId: input.jobCategoryId,
        location: input.location ?? null,
        appliedOn: input.appliedOn,
        source: input.source ?? null,
        jobDescriptionRef: input.jobDescriptionRef ?? null,
        notes: input.notes ?? null,
        createdById: ctx.actorId || null,
      })
      .returning()
      .get();
    await advance(tx, profile, 'applied');
    await recordAudit(tx, ctx, { action: 'create', entityType: 'placement_application', entityId: row.id, summary: `Applied for ${row.jobTitle}`, after: row });
  });
  return await getProfile(profile.id);
}

export async function setOutcome(ctx: RequestContext, applicationId: string, raw: unknown): Promise<PlacementProfileDetail> {
  const input = applicationOutcomeSchema.parse(raw);
  const app = await getApplicationRow(applicationId);
  if (input.offerOn && input.offerOn < app.appliedOn) throw ApiError.validation([{ path: 'offerOn', message: 'Cannot be before the application' }]);
  if (input.joiningOn && input.offerOn && input.joiningOn < input.offerOn) throw ApiError.validation([{ path: 'joiningOn', message: 'Cannot be before the offer' }]);
  await db.transaction(async (tx) => {
    await tx.update(placementApplications)
      .set({
        outcome: input.outcome,
        rejectionReason: input.outcome === 'rejected' ? (input.rejectionReason ?? null) : null,
        offerPackageMinor: input.offerPackageMinor ?? app.offerPackageMinor,
        offerOn: input.offerOn ?? app.offerOn,
        joiningOn: input.outcome === 'joined' ? input.joiningOn : app.joiningOn,
      })
      .where(eq(placementApplications.id, applicationId))
      .run();
    const profile = await getProfileRow(app.profileId, tx);
    const stageFor: Partial<Record<string, PlacementStage>> = { selected: 'selected', offer_received: 'offer_received', offer_declined: 'offer_received', joined: 'joined' };
    const target = stageFor[input.outcome];
    if (target) await advance(tx, profile, target);
    await recordAudit(tx, ctx, { action: 'status_change', entityType: 'placement_application', entityId: applicationId, summary: `Application ${app.jobTitle}: ${app.outcome.replace(/_/g, ' ')} → ${input.outcome.replace(/_/g, ' ')}`, before: { outcome: app.outcome }, after: input });
  });
  const detail = await getProfile(app.profileId);
  if ((input.outcome === 'offer_received' || input.outcome === 'joined') && input.outcome !== app.outcome) {
    await safely('placement_offer', async () => {
      const company = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, app.companyId)).get();
      await notifyPermission(
        'placements:read',
        {
          type: 'placement_offer',
          severity: 'success',
          title: input.outcome === 'joined' ? `${detail.studentName} joined ${company?.name ?? 'a company'}` : `${detail.studentName} received an offer from ${company?.name ?? 'a company'}`,
          body: app.jobTitle,
          link: `/placements/${detail.track === 'technical' ? 'technical' : 'non-technical'}?profile=${detail.id}`,
          entityType: 'placement_application',
          entityId: applicationId,
          dedupeKey: `offer:${applicationId}:${input.outcome}`,
        },
        { except: ctx.actorId },
      );
    });
  }
  return detail;
}

export async function addInterview(ctx: RequestContext, applicationId: string, raw: unknown): Promise<PlacementProfileDetail> {
  const input = interviewSchema.parse(raw);
  const app = await getApplicationRow(applicationId);
  await db.transaction(async (tx) => {
    const row = await tx.insert(interviews).values({ ...input, applicationId, scheduledAt: new Date(input.scheduledAt), feedback: input.feedback ?? null }).returning().get();
    await advance(tx, await getProfileRow(app.profileId, tx), input.result === 'scheduled' ? 'interview_scheduled' : 'interviewing');
    await recordAudit(tx, ctx, { action: 'create', entityType: 'placement_application', entityId: applicationId, summary: `Interview round ${row.roundNumber} (${row.roundName}) for ${app.jobTitle}` });
  });
  return await getProfile(app.profileId);
}

export async function setInterviewResult(ctx: RequestContext, interviewId: string, raw: unknown): Promise<PlacementProfileDetail> {
  const input = interviewResultSchema.parse(raw);
  const interview = await db.select().from(interviews).where(eq(interviews.id, interviewId)).get();
  if (!interview) throw ApiError.notFound('Interview');
  const app = await getApplicationRow(interview.applicationId);
  await db.transaction(async (tx) => {
    await tx.update(interviews).set({ result: input.result, feedback: input.feedback ?? interview.feedback }).where(eq(interviews.id, interviewId)).run();
    if (['passed', 'failed'].includes(input.result)) await advance(tx, await getProfileRow(app.profileId, tx), 'interviewing');
    await recordAudit(tx, ctx, { action: 'update', entityType: 'placement_application', entityId: app.id, summary: `Interview round ${interview.roundNumber}: ${input.result.replace(/_/g, ' ')}` });
  });
  return await getProfile(app.profileId);
}

/* ------------------------------------------------------------------ *
 * Analytics
 * ------------------------------------------------------------------ */

interface CohortRow {
  profileId: string;
  track: 'technical' | 'non_technical';
  courseId: string;
  courseName: string;
  stage: PlacementStage;
  applied: boolean;
  interviewed: boolean;
  offered: boolean;
  joined: boolean;
}

function funnel(rows: CohortRow[]): PlacementFunnel {
  const excluded = rows.filter((r) => r.stage === 'withdrawn' || r.stage === 'not_seeking').length;
  const joined = rows.filter((r) => r.joined).length;
  const denominator = rows.length - excluded;
  const readyIndex = PROGRESSION.indexOf('ready');
  return {
    eligible: rows.length,
    excluded,
    ready: rows.filter((r) => PROGRESSION.indexOf(r.stage) >= readyIndex || r.applied).length,
    applied: rows.filter((r) => r.applied).length,
    interviewed: rows.filter((r) => r.interviewed).length,
    offered: rows.filter((r) => r.offered).length,
    joined,
    placementRate: denominator > 0 ? joined / denominator : null,
  };
}

export async function placementAnalytics(raw: unknown): Promise<PlacementAnalytics> {
  const q = placementAnalyticsQuerySchema.parse(raw);
  const conditions: SQL[] = [sql`${placementProfiles.eligibleOn} >= ${q.from}`, sql`${placementProfiles.eligibleOn} <= ${q.to}`];
  if (q.track) conditions.push(eq(placementProfiles.track, q.track));
  if (q.courseId) conditions.push(eq(admissions.courseId, q.courseId));

  // One row per profile: the per-student flags are EXISTS checks, so a
  // student with three offers is still one "offered", one "joined".
  const cohort: CohortRow[] = await db
    .select({
      profileId: placementProfiles.id,
      track: placementProfiles.track,
      courseId: courses.id,
      courseName: courses.name,
      stage: placementProfiles.stage,
      applied: sql<number>`exists (select 1 from placement_applications pa where pa.profile_id = ${P_ID})`.mapWith((v) => Boolean(Number(v))),
      interviewed: sql<number>`exists (select 1 from interviews i join placement_applications pa on pa.id = i.application_id where pa.profile_id = ${P_ID} and i.result in ('passed', 'failed'))`.mapWith((v) => Boolean(Number(v))),
      offered: sql<number>`exists (select 1 from placement_applications pa where pa.profile_id = ${P_ID} and pa.outcome in ('offer_received', 'offer_declined', 'joined'))`.mapWith((v) => Boolean(Number(v))),
      joined: sql<number>`exists (select 1 from placement_applications pa where pa.profile_id = ${P_ID} and pa.outcome = 'joined')`.mapWith((v) => Boolean(Number(v))),
    })
    .from(placementProfiles)
    .innerJoin(admissions, eq(admissions.id, placementProfiles.admissionId))
    .innerJoin(courses, eq(courses.id, admissions.courseId))
    .where(and(...conditions))
    .all();

  const byCourse = new Map<string, { courseName: string; rows: CohortRow[] }>();
  for (const row of cohort) {
    const entry = byCourse.get(row.courseId) ?? { courseName: row.courseName, rows: [] };
    entry.rows.push(row);
    byCourse.set(row.courseId, entry);
  }

  // Activity inside the window, not limited to the cohort.
  const trackFilter = q.track ? sql` and pp.track = ${q.track}` : sql``;
  const courseFilter = q.courseId ? sql` and a.course_id = ${q.courseId}` : sql``;
  const appScope = sql`from placement_applications pa join placement_profiles pp on pp.id = pa.profile_id join admissions a on a.id = pp.admission_id where 1 = 1${trackFilter}${courseFilter}`;
  // Interview slots are instants; count those inside the institute's calendar days.
  const bounds = zonedDayBounds({ from: q.from, to: q.to }, getSettings().timezone);
  const scalar = async (expr: SQL) => Number((await db.get<{ n: number }>(sql`select ${expr} as n`))?.n ?? 0);
  const activity = {
    applications: await scalar(sql`(select count(*) ${appScope} and pa.applied_on between ${q.from} and ${q.to})`),
    interviews: await scalar(sql`(select count(*) from interviews i join placement_applications pa on pa.id = i.application_id join placement_profiles pp on pp.id = pa.profile_id join admissions a on a.id = pp.admission_id where i.scheduled_at >= ${bounds.start.getTime()} and i.scheduled_at < ${bounds.end.getTime()}${trackFilter}${courseFilter})`),
    offers: await scalar(sql`(select count(*) ${appScope} and pa.offer_on between ${q.from} and ${q.to})`),
    joined: await scalar(sql`(select count(distinct pa.student_id) ${appScope} and pa.outcome = 'joined' and pa.joining_on between ${q.from} and ${q.to})`),
  };

  const companyRows = await db.all<{ companyId: string; companyName: string; applications: number; offers: number; joined: number }>(sql`
    select c.id as companyId, c.name as companyName,
           count(*) as applications,
           sum(case when pa.outcome in ('offer_received', 'offer_declined', 'joined') then 1 else 0 end) as offers,
           sum(case when pa.outcome = 'joined' then 1 else 0 end) as joined
    from placement_applications pa
    join companies c on c.id = pa.company_id
    join placement_profiles pp on pp.id = pa.profile_id
    join admissions a on a.id = pp.admission_id
    where pa.applied_on between ${q.from} and ${q.to}${trackFilter}${courseFilter}
    group by c.id, c.name
    order by joined desc, offers desc, applications desc
    limit 20`);

  const joins = await db.all<{ month: string; track: string; n: number }>(sql`
    select substr(pa.joining_on, 1, 7) as month, pp.track as track, count(distinct pa.student_id) as n
    from placement_applications pa
    join placement_profiles pp on pp.id = pa.profile_id
    join admissions a on a.id = pp.admission_id
    where pa.outcome = 'joined' and pa.joining_on between ${q.from} and ${q.to}${trackFilter}${courseFilter}
    group by month, pp.track`);
  const monthlyJoined = eachBucket({ from: q.from, to: q.to }, 'month').map((month) => ({
    month,
    technical: Number(joins.find((j) => j.month === month && j.track === 'technical')?.n ?? 0),
    nonTechnical: Number(joins.find((j) => j.month === month && j.track === 'non_technical')?.n ?? 0),
  }));

  return {
    range: { from: q.from, to: q.to },
    funnel: funnel(cohort),
    byTrack: (['technical', 'non_technical'] as const).map((track) => ({ track, ...funnel(cohort.filter((r) => r.track === track)) })),
    byCourse: [...byCourse].map(([courseId, v]) => ({ courseId, courseName: v.courseName, ...funnel(v.rows) })).sort((a, b) => b.eligible - a.eligible),
    byCompany: companyRows.map((c) => ({ ...c, applications: Number(c.applications), offers: Number(c.offers), joined: Number(c.joined) })),
    monthlyJoined,
    activity,
  };
}

/* ------------------------------------------------------------------ *
 * Lifecycle: completing a placement course opens a profile
 * ------------------------------------------------------------------ */

admissionHooks.registerOnStatusChanged(async (tx, ctx, _before, after, date) => {
  if (after.status !== 'completed') return;
  const course = await tx.select({ track: courses.placementTrack }).from(courses).where(eq(courses.id, after.courseId)).get();
  if (!course?.track) return;
  const existing = await tx.select().from(placementProfiles).where(eq(placementProfiles.admissionId, after.id)).get();
  if (existing) {
    if (!existing.eligibleOn) await tx.update(placementProfiles).set({ eligibleOn: date }).where(eq(placementProfiles.id, existing.id)).run();
    return;
  }
  const row = await tx
    .insert(placementProfiles)
    .values({ studentId: after.studentId, admissionId: after.id, track: course.track === 'both' ? 'technical' : course.track, stage: 'eligible', eligibleOn: date, stageChangedAt: new Date() })
    .returning()
    .get();
  await recordAudit(tx, ctx, { action: 'create', entityType: 'placement_profile', entityId: row.id, summary: `Eligible for placement: completed ${after.admissionNumber}` });
});

