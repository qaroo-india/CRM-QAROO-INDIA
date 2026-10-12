/**
 * Placement profiles, job applications and interview rounds.
 *
 * A student counts as PLACED only when an application reaches 'joined'.
 * Applications, interviews, selections and offers are tracked, but none of
 * them is a placement on its own.
 */

import {
  APPLICATION_OUTCOMES,
  DRIVE_STATUSES,
  INTERVIEW_MODES,
  INTERVIEW_RESULTS,
  PLACEMENT_STAGES,
  PROFILE_TRACKS,
  RESUME_STATUSES,
  type ApplicationOutcome,
  type DriveStatus,
  type InterviewMode,
  type InterviewResult,
  type PlacementStage,
  type ProfileTrack,
  type ResumeStatus,
} from '@ims/shared';
import {
  bool,
  check,
  dateOnly,
  enumStr,
  id,
  index,
  inList,
  instant,
  int,
  isDateOnly,
  json,
  money,
  primaryKey,
  ref,
  sql,
  str,
  table,
  timestamps,
  uniqueIndex,
} from '../dialect';
import { companies, jobCategories, students } from './catalog';
import { admissions, batches } from './enrolment';
import { users } from './users';

export const placementProfiles = table(
  'placement_profiles',
  {
    id: id(),
    studentId: ref('student_id')
      .notNull()
      .references(() => students.id),
    admissionId: ref('admission_id')
      .notNull()
      .references(() => admissions.id),
    track: enumStr('track', PROFILE_TRACKS).$type<ProfileTrack>().notNull(),
    stage: enumStr('stage', PLACEMENT_STAGES).$type<PlacementStage>().notNull().default('eligible'),
    /** Defines the cohort a placement rate is measured over. */
    eligibleOn: dateOnly('eligible_on'),
    resumeStatus: enumStr('resume_status', RESUME_STATUSES).$type<ResumeStatus>().notNull().default('not_started'),
    skills: json<string[]>('skills')
      .notNull()
      .$defaultFn(() => []),
    readinessScore: int('readiness_score'),
    coordinatorId: ref('coordinator_id').references(() => users.id),
    notes: str('notes'),
    stageChangedAt: instant('stage_changed_at'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('placement_profiles_admission_unique').on(t.admissionId),
    index('placement_profiles_student_idx').on(t.studentId),
    index('placement_profiles_stage_idx').on(t.track, t.stage),
    index('placement_profiles_eligible_idx').on(t.eligibleOn),
    check('placement_profiles_track_check', inList(t.track, PROFILE_TRACKS)),
    check('placement_profiles_stage_check', inList(t.stage, PLACEMENT_STAGES)),
    check('placement_profiles_resume_check', inList(t.resumeStatus, RESUME_STATUSES)),
    check('placement_profiles_score_range', sql`${t.readinessScore} is null or ${t.readinessScore} between 0 and 100`),
    check('placement_profiles_eligible_format', sql`${t.eligibleOn} is null or ${isDateOnly(t.eligibleOn)}`),
  ],
);

/**
 * A hiring event: one company and role, open to chosen batches. Students
 * apply to the drive; each application is an ordinary placement application
 * carrying the drive id, so interviews, offers and joining work as before.
 */
export const placementDrives = table(
  'placement_drives',
  {
    id: id(),
    companyId: ref('company_id')
      .notNull()
      .references(() => companies.id),
    roleTitle: str('role_title').notNull(),
    description: str('description'),
    track: enumStr('track', PROFILE_TRACKS).$type<ProfileTrack>().notNull(),
    status: enumStr('status', DRIVE_STATUSES).$type<DriveStatus>().notNull().default('planned'),
    driveDate: dateOnly('drive_date').notNull(),
    applyBy: dateOnly('apply_by'),
    /** Annual package (CTC) in minor units. */
    packageMinor: money('package_minor'),
    openings: int('openings').notNull().default(1),
    location: str('location'),
    isRemote: bool('is_remote').notNull().default(false),
    eligibilityNote: str('eligibility_note'),
    coordinatorId: ref('coordinator_id').references(() => users.id),
    createdById: ref('created_by_id').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    index('placement_drives_status_idx').on(t.status, t.driveDate),
    check('placement_drives_status_check', inList(t.status, DRIVE_STATUSES)),
    check('placement_drives_track_check', inList(t.track, PROFILE_TRACKS)),
    check('placement_drives_openings_positive', sql`${t.openings} >= 1`),
    check('placement_drives_package_nonneg', sql`${t.packageMinor} is null or ${t.packageMinor} >= 0`),
    check('placement_drives_apply_before_drive', sql`${t.applyBy} is null or ${t.applyBy} <= ${t.driveDate}`),
  ],
);

/** Batches whose students may apply to a drive. */
export const placementDriveBatches = table(
  'placement_drive_batches',
  {
    driveId: ref('drive_id')
      .notNull()
      .references(() => placementDrives.id),
    batchId: ref('batch_id')
      .notNull()
      .references(() => batches.id),
  },
  (t) => [primaryKey({ columns: [t.driveId, t.batchId] })],
);

export const placementApplications = table(
  'placement_applications',
  {
    id: id(),
    /** Set when the application came through a placement drive. */
    driveId: ref('drive_id'),
    profileId: ref('profile_id')
      .notNull()
      .references(() => placementProfiles.id),
    studentId: ref('student_id')
      .notNull()
      .references(() => students.id),
    companyId: ref('company_id')
      .notNull()
      .references(() => companies.id),
    jobTitle: str('job_title').notNull(),
    jobCategoryId: ref('job_category_id').references(() => jobCategories.id),
    location: str('location'),
    appliedOn: dateOnly('applied_on').notNull(),
    source: str('source'),
    jobDescriptionRef: str('job_description_ref'),
    outcome: enumStr('outcome', APPLICATION_OUTCOMES).$type<ApplicationOutcome>().notNull().default('in_progress'),
    rejectionReason: str('rejection_reason'),
    /** Annual package in minor units, as offered. */
    offerPackageMinor: money('offer_package_minor'),
    offerOn: dateOnly('offer_on'),
    joiningOn: dateOnly('joining_on'),
    notes: str('notes'),
    createdById: ref('created_by_id').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    index('placement_applications_profile_idx').on(t.profileId),
    index('placement_applications_student_idx').on(t.studentId),
    index('placement_applications_company_idx').on(t.companyId),
    index('placement_applications_outcome_idx').on(t.outcome),
    uniqueIndex('placement_applications_drive_unique').on(t.driveId, t.profileId).where(sql`drive_id is not null`),
    check('placement_applications_outcome_check', inList(t.outcome, APPLICATION_OUTCOMES)),
    check('placement_applications_applied_format', isDateOnly(t.appliedOn)),
    check('placement_applications_package_nonneg', sql`${t.offerPackageMinor} is null or ${t.offerPackageMinor} >= 0`),
    // "Joined" needs a joining date; that date is what placement trends count.
    check('placement_applications_joined_dated', sql`${t.outcome} <> 'joined' or ${t.joiningOn} is not null`),
  ],
);

export const interviews = table(
  'interviews',
  {
    id: id(),
    applicationId: ref('application_id')
      .notNull()
      .references(() => placementApplications.id),
    roundNumber: int('round_number').notNull(),
    roundName: str('round_name').notNull(),
    scheduledAt: instant('scheduled_at').notNull(),
    mode: enumStr('mode', INTERVIEW_MODES).$type<InterviewMode>().notNull().default('in_person'),
    result: enumStr('result', INTERVIEW_RESULTS).$type<InterviewResult>().notNull().default('scheduled'),
    feedback: str('feedback'),
    ...timestamps(),
  },
  (t) => [
    index('interviews_application_idx').on(t.applicationId),
    index('interviews_scheduled_idx').on(t.scheduledAt),
    check('interviews_mode_check', inList(t.mode, INTERVIEW_MODES)),
    check('interviews_result_check', inList(t.result, INTERVIEW_RESULTS)),
    check('interviews_round_positive', sql`${t.roundNumber} > 0`),
  ],
);

export type PlacementProfile = typeof placementProfiles.$inferSelect;
export type PlacementApplication = typeof placementApplications.$inferSelect;
export type Interview = typeof interviews.$inferSelect;
