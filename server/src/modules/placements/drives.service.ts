/**
 * Placement drives: one company and role, open to chosen batches.
 *
 * An application to a drive is an ordinary placement application carrying
 * the drive id, so interviews, offers, joining and the placement analytics
 * all work unchanged. A student can apply to a drive once.
 *
 * Who may apply: a student with a placement profile on the drive's track,
 * whose admission is (or was) in one of the drive's batches -- or any batch
 * when the drive names none -- while the drive is open and before apply-by.
 */

import { driveApplicantsSchema, driveSchema, type DriveApplicantDto, type DriveDto, type driveListQuerySchema } from '@ims/shared';
import { and, asc, count, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';
import { db } from '../../db';
import { admissions, batches, companies, courses, placementApplications, placementDriveBatches, placementDrives, placementProfiles, students, users, type PlacementProfile } from '../../db/schema';
import type { Tx } from '../../db/types';
import { recordAudit } from '../../services/audit';
import { instituteToday } from '../../services/clock';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { containsText, pageWindow, paginated } from '../../utils/pagination';
import { notifyUsers, safely } from '../notifications/notifications.service';
import { advance, ensureCompany } from './placements.service';

const coordinator = alias(users, 'coordinator');

function query() {
  const D = sql.raw('"placement_drives"."id"');
  return db
    .select({
      d: placementDrives,
      companyName: companies.name,
      coordinatorName: coordinator.name,
      applicants: sql<number>`(select count(*) from placement_applications pa where pa.drive_id = ${D})`.mapWith(Number),
      offers: sql<number>`(select count(*) from placement_applications pa where pa.drive_id = ${D} and pa.outcome in ('offer_received', 'offer_declined', 'joined'))`.mapWith(Number),
      joined: sql<number>`(select count(*) from placement_applications pa where pa.drive_id = ${D} and pa.outcome = 'joined')`.mapWith(Number),
    })
    .from(placementDrives)
    .innerJoin(companies, eq(companies.id, placementDrives.companyId))
    .leftJoin(coordinator, eq(coordinator.id, placementDrives.coordinatorId));
}

type Row = Awaited<ReturnType<ReturnType<typeof query>['all']>>[number];

function batchesFor(driveIds: string[]) {
  if (driveIds.length === 0) return new Map<string, DriveDto['batches']>();
  const rows = db
    .select({ driveId: placementDriveBatches.driveId, id: batches.id, batchCode: batches.batchCode, name: batches.name })
    .from(placementDriveBatches)
    .innerJoin(batches, eq(batches.id, placementDriveBatches.batchId))
    .where(inArray(placementDriveBatches.driveId, driveIds))
    .orderBy(asc(batches.batchCode))
    .all();
  const map = new Map<string, DriveDto['batches']>();
  for (const r of rows) map.set(r.driveId, [...(map.get(r.driveId) ?? []), { id: r.id, batchCode: r.batchCode, name: r.name }]);
  return map;
}

function toDtos(rows: Row[]): DriveDto[] {
  const linked = batchesFor(rows.map((r) => r.d.id));
  return rows.map((r) => ({
    id: r.d.id,
    companyId: r.d.companyId,
    companyName: r.companyName,
    roleTitle: r.d.roleTitle,
    description: r.d.description,
    track: r.d.track,
    status: r.d.status,
    driveDate: r.d.driveDate,
    applyBy: r.d.applyBy,
    packageMinor: r.d.packageMinor,
    openings: r.d.openings,
    location: r.d.location,
    isRemote: r.d.isRemote,
    eligibilityNote: r.d.eligibilityNote,
    coordinatorId: r.d.coordinatorId,
    coordinatorName: r.coordinatorName,
    batches: linked.get(r.d.id) ?? [],
    applicants: r.applicants,
    offers: r.offers,
    joined: r.joined,
  }));
}

export function listDrives(q: z.output<typeof driveListQuerySchema>) {
  const conditions: (SQL | undefined)[] = [];
  if (q.q) conditions.push(or(containsText(placementDrives.roleTitle, q.q), containsText(companies.name, q.q)));
  if (q.status?.length) conditions.push(inArray(placementDrives.status, q.status));
  if (q.track) conditions.push(eq(placementDrives.track, q.track));
  const where = and(...conditions);
  const total = db.select({ n: count() }).from(placementDrives).innerJoin(companies, eq(companies.id, placementDrives.companyId)).where(where).get()?.n ?? 0;
  const { limit, offset } = pageWindow(q.page, q.limit);
  return paginated(toDtos(query().where(where).orderBy(desc(placementDrives.driveDate)).limit(limit).offset(offset).all()), total, q.page, q.limit);
}

export function getDrive(id: string): DriveDto {
  const row = query().where(eq(placementDrives.id, id)).get();
  if (!row) throw ApiError.notFound('Placement drive');
  return toDtos([row])[0]!;
}

function saveBatches(tx: Tx, driveId: string, batchIds: string[]): void {
  const unique = [...new Set(batchIds)];
  if (unique.length) {
    const found = tx.select({ id: batches.id }).from(batches).where(inArray(batches.id, unique)).all();
    if (found.length !== unique.length) throw ApiError.validation([{ path: 'batchIds', message: 'One of the batches does not exist' }]);
  }
  tx.delete(placementDriveBatches).where(eq(placementDriveBatches.driveId, driveId)).run();
  for (const batchId of unique) tx.insert(placementDriveBatches).values({ driveId, batchId }).run();
}

function values(tx: Tx, ctx: RequestContext, input: z.output<typeof driveSchema>) {
  return {
    companyId: ensureCompany(tx, ctx, input.companyId ?? null, input.companyName),
    roleTitle: input.roleTitle,
    description: input.description ?? null,
    track: input.track,
    status: input.status,
    driveDate: input.driveDate,
    applyBy: input.applyBy ?? null,
    packageMinor: input.packageMinor ?? null,
    openings: input.openings,
    location: input.location ?? null,
    isRemote: input.isRemote,
    eligibilityNote: input.eligibilityNote ?? null,
    coordinatorId: input.coordinatorId ?? null,
  };
}

export function createDrive(ctx: RequestContext, raw: unknown): DriveDto {
  const input = driveSchema.parse(raw);
  const id = db.transaction((tx) => {
    const row = tx.insert(placementDrives).values({ ...values(tx, ctx, input), createdById: ctx.actorId || null }).returning().get();
    saveBatches(tx, row.id, input.batchIds);
    recordAudit(tx, ctx, { action: 'create', entityType: 'placement_drive', entityId: row.id, summary: `Created placement drive: ${input.roleTitle}`, after: input });
    return row.id;
  });
  if (input.status === 'open') announce(id);
  return getDrive(id);
}

export function updateDrive(ctx: RequestContext, id: string, raw: unknown): DriveDto {
  const existing = db.select().from(placementDrives).where(eq(placementDrives.id, id)).get();
  if (!existing) throw ApiError.notFound('Placement drive');
  const input = driveSchema.parse(raw);
  if (existing.track !== input.track && (db.select({ n: count() }).from(placementApplications).where(eq(placementApplications.driveId, id)).get()?.n ?? 0) > 0) {
    throw ApiError.conflict('Students have applied, so the track cannot change.', 'HAS_APPLICANTS');
  }
  db.transaction((tx) => {
    tx.update(placementDrives).set(values(tx, ctx, input)).where(eq(placementDrives.id, id)).run();
    saveBatches(tx, id, input.batchIds);
    recordAudit(tx, ctx, { action: 'update', entityType: 'placement_drive', entityId: id, summary: `Updated placement drive: ${input.roleTitle}${existing.status !== input.status ? ` (${existing.status} → ${input.status})` : ''}` });
  });
  if (existing.status !== 'open' && input.status === 'open') announce(id);
  return getDrive(id);
}

/** Tell eligible students (with a portal login) that a drive has opened. */
function announce(driveId: string): void {
  safely('drive_open', () => {
    const drive = getDrive(driveId);
    const profiles = eligibleProfiles(drive);
    const userIds = db
      .select({ userId: students.userId })
      .from(students)
      .innerJoin(users, eq(users.id, students.userId))
      .where(and(eq(users.isActive, true), inArray(students.id, profiles.length ? profiles.map((p) => p.studentId) : ['-'])))
      .all()
      .map((r) => r.userId!)
      .filter(Boolean);
    notifyUsers(userIds, { type: 'drive_open', severity: 'success', title: `Placement drive: ${drive.companyName} is hiring a ${drive.roleTitle}`, body: drive.applyBy ? `Apply by ${drive.applyBy}` : null, link: '/portal/placements', entityType: 'placement_drive', entityId: driveId, dedupeKey: `drive_open:${driveId}` });
  });
}

/** Profiles that may apply: track matches and (if the drive names batches) the admission was in one. */
function eligibleProfiles(drive: Pick<DriveDto, 'track' | 'batches'>): PlacementProfile[] {
  const batchIds = drive.batches.map((b) => b.id);
  return db
    .select()
    .from(placementProfiles)
    .where(
      and(
        eq(placementProfiles.track, drive.track),
        sql`${placementProfiles.stage} not in ('withdrawn', 'not_seeking', 'joined')`,
        batchIds.length ? sql`${placementProfiles.admissionId} in (select ba.admission_id from batch_assignments ba where ba.batch_id in (${sql.join(batchIds.map((b) => sql`${b}`), sql`, `)}))` : undefined,
      ),
    )
    .all();
}

/** Why this profile cannot apply to this drive now, or null when it can. */
export function applyBlocker(drive: DriveDto, profile: PlacementProfile | null, today = instituteToday()): string | null {
  if (drive.status !== 'open') return drive.status === 'planned' ? 'Applications have not opened yet.' : 'Applications are closed.';
  if (drive.applyBy && today > drive.applyBy) return 'The last date to apply has passed.';
  if (!profile) return 'You need a placement profile first. Ask your placement coordinator.';
  if (profile.track !== drive.track) return `This drive is for the ${drive.track.replace('_', '-')} track.`;
  if (['withdrawn', 'not_seeking'].includes(profile.stage)) return 'Your placement profile is not active.';
  if (profile.stage === 'joined') return 'You have already been placed.';
  if (drive.batches.length && !eligibleProfiles(drive).some((p) => p.id === profile.id)) return 'This drive is not open to your batch.';
  return null;
}

/** Create the drive application for one profile (inside a transaction). */
function applyProfile(tx: Tx, ctx: RequestContext, drive: DriveDto, profile: PlacementProfile, source: string): string | null {
  const existing = tx.select({ id: placementApplications.id }).from(placementApplications).where(and(eq(placementApplications.driveId, drive.id), eq(placementApplications.profileId, profile.id))).get();
  if (existing) return null;
  const row = tx
    .insert(placementApplications)
    .values({ driveId: drive.id, profileId: profile.id, studentId: profile.studentId, companyId: drive.companyId, jobTitle: drive.roleTitle, location: drive.location, appliedOn: instituteToday(), source, createdById: ctx.actorId || null })
    .returning()
    .get();
  advance(tx, profile, 'applied');
  recordAudit(tx, ctx, { action: 'create', entityType: 'placement_application', entityId: row.id, summary: `Applied to the ${drive.companyName} drive (${drive.roleTitle})` });
  return row.id;
}

/** Staff add students to a drive. Ineligible or duplicate profiles are reported, not forced. */
export function addApplicants(ctx: RequestContext, driveId: string, raw: unknown): { added: number; skipped: { profileId: string; reason: string }[] } {
  const drive = getDrive(driveId);
  const { profileIds } = driveApplicantsSchema.parse(raw);
  const skipped: { profileId: string; reason: string }[] = [];
  let added = 0;
  db.transaction((tx) => {
    for (const profileId of [...new Set(profileIds)]) {
      const profile = tx.select().from(placementProfiles).where(eq(placementProfiles.id, profileId)).get() ?? null;
      // Staff may add before the drive opens or after apply-by closes.
      const reason = applyBlocker({ ...drive, status: 'open', applyBy: null }, profile);
      if (reason) {
        skipped.push({ profileId, reason });
        continue;
      }
      if (applyProfile(tx, ctx, drive, profile!, 'Placement drive (added by staff)')) added += 1;
      else skipped.push({ profileId, reason: 'Already applied' });
    }
  });
  return { added, skipped };
}

/** A student applies themselves. */
export function applyAsStudent(ctx: RequestContext, studentId: string, driveId: string): { applicationId: string } {
  const drive = getDrive(driveId);
  const profile = db.select().from(placementProfiles).where(and(eq(placementProfiles.studentId, studentId), eq(placementProfiles.track, drive.track))).orderBy(desc(placementProfiles.createdAt)).get() ?? null;
  const reason = applyBlocker(drive, profile);
  if (reason) throw ApiError.unprocessable(reason, 'CANNOT_APPLY');
  const id = db.transaction((tx) => applyProfile(tx, ctx, drive, profile!, 'Placement drive (student)'));
  if (!id) throw ApiError.conflict('You have already applied to this drive.', 'ALREADY_APPLIED');
  return { applicationId: id };
}

export function driveApplicants(driveId: string): DriveApplicantDto[] {
  getDrive(driveId);
  const A = sql.raw('"placement_applications"."id"');
  return db
    .select({
      a: placementApplications,
      studentName: students.fullName,
      studentCode: students.studentCode,
      courseName: courses.name,
      interviews: sql<number>`(select count(*) from interviews i where i.application_id = ${A})`.mapWith(Number),
    })
    .from(placementApplications)
    .innerJoin(students, eq(students.id, placementApplications.studentId))
    .innerJoin(placementProfiles, eq(placementProfiles.id, placementApplications.profileId))
    .innerJoin(admissions, eq(admissions.id, placementProfiles.admissionId))
    .innerJoin(courses, eq(courses.id, admissions.courseId))
    .where(eq(placementApplications.driveId, driveId))
    .orderBy(asc(students.fullName))
    .all()
    .map((r) => ({ applicationId: r.a.id, profileId: r.a.profileId, studentId: r.a.studentId, studentName: r.studentName, studentCode: r.studentCode, courseName: r.courseName, appliedOn: r.a.appliedOn, outcome: r.a.outcome, interviews: r.interviews }));
}

/** Drives a student can see: open ones on their tracks (closed ones they applied to stay visible). */
export function drivesForStudent(studentId: string): (DriveDto & { applied: boolean; canApply: boolean; blockedReason: string | null })[] {
  const profiles = db.select().from(placementProfiles).where(eq(placementProfiles.studentId, studentId)).all();
  const applied = new Set(db.select({ driveId: placementApplications.driveId }).from(placementApplications).where(and(eq(placementApplications.studentId, studentId), sql`${placementApplications.driveId} is not null`)).all().map((r) => r.driveId!));
  const tracks = [...new Set(profiles.map((p) => p.track))];
  if (tracks.length === 0 && applied.size === 0) return [];
  const visible: SQL[] = [];
  if (tracks.length) visible.push(and(eq(placementDrives.status, 'open'), inArray(placementDrives.track, tracks))!);
  if (applied.size) visible.push(inArray(placementDrives.id, [...applied]));
  const rows = query().where(or(...visible)).orderBy(asc(placementDrives.driveDate)).all();
  return toDtos(rows).map((d) => {
    const profile = profiles.filter((p) => p.track === d.track).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
    const isApplied = applied.has(d.id);
    const blockedReason = isApplied ? null : applyBlocker(d, profile);
    return { ...d, applied: isApplied, canApply: !isApplied && blockedReason === null, blockedReason };
  });
}

