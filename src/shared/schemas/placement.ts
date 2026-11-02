/**
 * Placement profiles, companies, applications and interviews.
 */

import { z } from 'zod';
import {
  APPLICATION_OUTCOMES,
  INTERVIEW_MODES,
  INTERVIEW_RESULTS,
  PLACEMENT_STAGES,
  PROFILE_TRACKS,
  RESUME_STATUSES,
} from '../constants/domain';
import { csvEnum, dateOnlySchema, idSchema, moneyMinorSchema, nonEmptyString, optionalMoneyFieldSchema, optionalString, paginationSchema } from './common';

const optionalId = z
  .union([z.literal(''), z.null(), idSchema])
  .optional()
  .transform((v) => (v ? v : null));
const optionalDate = z
  .union([z.literal(''), z.null(), dateOnlySchema])
  .optional()
  .transform((v) => (v ? v : null));

const profileFields = {
  track: z.enum(PROFILE_TRACKS),
  eligibleOn: optionalDate,
  resumeStatus: z.enum(RESUME_STATUSES).default('not_started'),
  skills: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
  readinessScore: z
    .union([z.literal(''), z.null(), z.coerce.number().int().min(0).max(100)])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  coordinatorId: optionalId,
  notes: optionalString(2000),
};

export const placementProfileSchema = z.object({ admissionId: idSchema, ...profileFields });
export const placementProfileUpdateSchema = z.object(profileFields);

export const profileStageSchema = z.object({
  stage: z.enum(PLACEMENT_STAGES),
  note: optionalString(500),
});

export const companySchema = z.object({
  name: nonEmptyString(160, 'Company name'),
  website: optionalString(200),
  industry: optionalString(120),
  notes: optionalString(1000),
});

const applicationFields = {
  companyId: optionalId,
  /** Creates the company on the fly when no id is given. */
  companyName: optionalString(160),
  jobTitle: nonEmptyString(160, 'Job title'),
  jobCategoryId: optionalId,
  location: optionalString(120),
  appliedOn: dateOnlySchema,
  source: optionalString(120),
  jobDescriptionRef: optionalString(300),
  notes: optionalString(2000),
};

export const applicationSchema = z
  .object({ profileId: idSchema, ...applicationFields })
  .superRefine((v, ctx) => {
    if (!v.companyId && !v.companyName) ctx.addIssue({ code: 'custom', path: ['companyName'], message: 'Choose or enter a company' });
  });

/**
 * Outcome rules: an offer needs its date; "joined" needs the joining date --
 * that date is what placement trends count. Selection, offers and
 * applications are never placement on their own.
 */
const outcomeRules = <T extends { outcome: string; offerOn?: string | null; joiningOn?: string | null; rejectionReason?: string }>(v: T, ctx: z.RefinementCtx) => {
  if (['offer_received', 'offer_declined', 'joined'].includes(v.outcome) && !v.offerOn) {
    ctx.addIssue({ code: 'custom', path: ['offerOn'], message: 'When was the offer made?' });
  }
  if (v.outcome === 'joined' && !v.joiningOn) ctx.addIssue({ code: 'custom', path: ['joiningOn'], message: 'When did the student join?' });
  if (v.outcome === 'rejected' && !v.rejectionReason) ctx.addIssue({ code: 'custom', path: ['rejectionReason'], message: 'Record the reason' });
};

const outcomeBase = z.object({
  outcome: z.enum(APPLICATION_OUTCOMES),
  rejectionReason: optionalString(500),
  offerOn: optionalDate,
  joiningOn: optionalDate,
});

export const applicationOutcomeSchema = outcomeBase.extend({ offerPackageMinor: moneyMinorSchema.nullable().optional() }).superRefine(outcomeRules);
export const applicationOutcomeFormSchema = outcomeBase.extend({ offerPackageMinor: optionalMoneyFieldSchema }).superRefine(outcomeRules);

export const interviewSchema = z.object({
  roundNumber: z.coerce.number().int().min(1).max(20),
  roundName: nonEmptyString(120, 'Round'),
  /** ISO instant, e.g. 2026-10-14T10:30:00+05:30. */
  scheduledAt: z.string().pipe(z.iso.datetime({ offset: true })),
  mode: z.enum(INTERVIEW_MODES).default('in_person'),
  result: z.enum(INTERVIEW_RESULTS).default('scheduled'),
  feedback: optionalString(2000),
});

export const interviewResultSchema = z.object({ result: z.enum(INTERVIEW_RESULTS), feedback: optionalString(2000) });

export const profileListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  track: z.enum(PROFILE_TRACKS).optional(),
  stage: csvEnum(PLACEMENT_STAGES),
  courseId: idSchema.optional(),
  coordinatorId: idSchema.optional(),
  studentId: idSchema.optional(),
});

export const applicationListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  track: z.enum(PROFILE_TRACKS).optional(),
  outcome: csvEnum(APPLICATION_OUTCOMES),
  companyId: idSchema.optional(),
  profileId: idSchema.optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});

export const placementAnalyticsQuerySchema = z.object({
  from: dateOnlySchema,
  to: dateOnlySchema,
  track: z.enum(PROFILE_TRACKS).optional(),
  courseId: idSchema.optional(),
});
