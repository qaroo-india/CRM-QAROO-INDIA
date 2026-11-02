/**
 * Enquiries and their activity timeline.
 */

import {
  LEAD_ACTIVITY_TYPES,
  LEAD_PRIORITIES,
  LEAD_STATUSES,
  type LeadActivityType,
  type LeadPriority,
  type LeadStatus,
} from '@ims/shared';
import {
  check,
  dateOnly,
  enumStr,
  id,
  index,
  inList,
  instant,
  isDateOnly,
  json,
  ref,
  sql,
  str,
  table,
  timestamps,
  uniqueIndex,
} from '../dialect';
import { courses, leadSources, students } from './catalog';
import { users } from './users';

export const leads = table(
  'leads',
  {
    id: id(),
    leadCode: str('lead_code').notNull(),
    name: str('name').notNull(),
    phone: str('phone').notNull(),
    phoneNormalized: str('phone_normalized').notNull(),
    email: str('email'),
    enquiryDate: dateOnly('enquiry_date').notNull(),

    /**
     * NOT NULL on purpose: the brief forbids attributing an admission to a
     * marketing source without a saved, traceable source record.
     */
    leadSourceId: ref('lead_source_id')
      .notNull()
      .references(() => leadSources.id),
    campaignName: str('campaign_name'),
    adReference: str('ad_reference'),
    utmSource: str('utm_source'),
    utmMedium: str('utm_medium'),
    utmCampaign: str('utm_campaign'),
    utmTerm: str('utm_term'),
    utmContent: str('utm_content'),

    interestedCourseId: ref('interested_course_id').references(() => courses.id),
    counsellorId: ref('counsellor_id').references(() => users.id),
    followUpDate: dateOnly('follow_up_date'),
    priority: enumStr('priority', LEAD_PRIORITIES).$type<LeadPriority>().notNull().default('medium'),
    status: enumStr('status', LEAD_STATUSES).$type<LeadStatus>().notNull().default('new'),
    lostReason: str('lost_reason'),
    notes: str('notes'),

    convertedOn: dateOnly('converted_on'),
    studentId: ref('student_id').references(() => students.id),

    createdById: ref('created_by_id').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('leads_code_unique').on(t.leadCode),
    index('leads_status_idx').on(t.status),
    index('leads_source_idx').on(t.leadSourceId),
    index('leads_counsellor_idx').on(t.counsellorId),
    index('leads_follow_up_idx').on(t.followUpDate),
    index('leads_phone_idx').on(t.phoneNormalized),
    index('leads_email_idx').on(t.email),
    index('leads_enquiry_date_idx').on(t.enquiryDate),
    check('leads_status_check', inList(t.status, LEAD_STATUSES)),
    check('leads_priority_check', inList(t.priority, LEAD_PRIORITIES)),
    check('leads_enquiry_date_format', isDateOnly(t.enquiryDate)),
    check('leads_follow_up_format', sql`${t.followUpDate} is null or ${isDateOnly(t.followUpDate)}`),
    // A converted lead must say when, and must not be marked converted silently.
    check(
      'leads_conversion_consistent',
      sql`(${t.status} = 'converted') = (${t.convertedOn} is not null)`,
    ),
  ],
);

export const leadActivities = table(
  'lead_activities',
  {
    id: id(),
    leadId: ref('lead_id')
      .notNull()
      .references(() => leads.id),
    type: enumStr('type', LEAD_ACTIVITY_TYPES).$type<LeadActivityType>().notNull(),
    fromStatus: str('from_status'),
    toStatus: str('to_status'),
    note: str('note'),
    metadata: json<Record<string, unknown>>('metadata'),
    actorId: ref('actor_id').references(() => users.id),
    occurredAt: instant('occurred_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('lead_activities_lead_idx').on(t.leadId, t.occurredAt),
    check('lead_activities_type_check', inList(t.type, LEAD_ACTIVITY_TYPES)),
  ],
);

export type Lead = typeof leads.$inferSelect;
export type LeadActivity = typeof leadActivities.$inferSelect;
