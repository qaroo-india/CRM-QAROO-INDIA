/**
 * Reference entities that other tables point at: configurable lookups,
 * courses, students, trainers and companies. Nothing here references a
 * transactional table, which keeps the schema import graph acyclic.
 */

import { PROFILE_TRACKS, PLACEMENT_TRACKS, type Gender, type PlacementTrack, type ProfileTrack, type StudentStatus } from '@ims/shared';
import {
  bool,
  check,
  dateOnly,
  enumStr,
  id,
  index,
  inList,
  int,
  isDateOnly,
  json,
  money,
  ref,
  sql,
  str,
  table,
  timestamps,
  uniqueIndex,
} from '../dialect';
import { users } from './users';

/** Owner-curated marketing sources. Deactivated, never deleted, once used. */
export const leadSources = table(
  'lead_sources',
  {
    id: id(),
    name: str('name').notNull(),
    isActive: bool('is_active').notNull().default(true),
    sortOrder: int('sort_order').notNull().default(0),
    ...timestamps(),
  },
  (t) => [uniqueIndex('lead_sources_name_unique').on(sql`lower(${t.name})`)],
);

export const expenseCategories = table(
  'expense_categories',
  {
    id: id(),
    name: str('name').notNull(),
    isActive: bool('is_active').notNull().default(true),
    sortOrder: int('sort_order').notNull().default(0),
    ...timestamps(),
  },
  (t) => [uniqueIndex('expense_categories_name_unique').on(sql`lower(${t.name})`)],
);

export const jobCategories = table(
  'job_categories',
  {
    id: id(),
    track: enumStr('track', PROFILE_TRACKS).$type<ProfileTrack>().notNull(),
    name: str('name').notNull(),
    isActive: bool('is_active').notNull().default(true),
    sortOrder: int('sort_order').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('job_categories_track_name_unique').on(t.track, sql`lower(${t.name})`),
    check('job_categories_track_check', inList(t.track, PROFILE_TRACKS)),
  ],
);

export const courses = table(
  'courses',
  {
    id: id(),
    code: str('code').notNull(),
    name: str('name').notNull(),
    description: str('description'),
    durationWeeks: int('duration_weeks'),
    standardFeeMinor: money('standard_fee_minor').notNull(),
    modules: json<string[]>('modules')
      .notNull()
      .$defaultFn(() => []),
    /** Null when the course carries no placement support. */
    placementTrack: enumStr('placement_track', PLACEMENT_TRACKS).$type<PlacementTrack>(),
    defaultAdmissionFeeMinor: money('default_admission_fee_minor'),
    defaultInstalmentCount: int('default_instalment_count'),
    isActive: bool('is_active').notNull().default(true),
    createdById: ref('created_by_id').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('courses_code_unique').on(sql`upper(${t.code})`),
    index('courses_active_idx').on(t.isActive),
    check('courses_fee_nonneg', sql`${t.standardFeeMinor} >= 0`),
    check('courses_admission_fee_range', sql`${t.defaultAdmissionFeeMinor} is null or (${t.defaultAdmissionFeeMinor} >= 0 and ${t.defaultAdmissionFeeMinor} <= ${t.standardFeeMinor})`),
    check('courses_instalments_range', sql`${t.defaultInstalmentCount} is null or ${t.defaultInstalmentCount} between 0 and 60`),
    check('courses_duration_positive', sql`${t.durationWeeks} is null or ${t.durationWeeks} > 0`),
    check('courses_track_check', sql`${t.placementTrack} is null or ${inList(t.placementTrack, PLACEMENT_TRACKS)}`),
  ],
);

/**
 * One row per real person. A returning student gets a second admission, not a
 * second student, which is why phone and email are indexed for duplicate checks.
 */
export const students = table(
  'students',
  {
    id: id(),
    studentCode: str('student_code').notNull(),
    fullName: str('full_name').notNull(),
    phone: str('phone').notNull(),
    /** Last 10 digits, for matching "+91 98765-43210" against "9876543210". */
    phoneNormalized: str('phone_normalized').notNull(),
    email: str('email'),
    address: str('address'),
    city: str('city'),
    dateOfBirth: dateOnly('date_of_birth'),
    emergencyContactName: str('emergency_contact_name'),
    emergencyContactPhone: str('emergency_contact_phone'),
    notes: str('notes'),
    gender: str('gender').$type<Gender>(),
    qualification: str('qualification'),
    yearOfPassing: int('year_of_passing'),
    state: str('state'),
    pincode: str('pincode'),
    guardianName: str('guardian_name'),
    guardianPhone: str('guardian_phone'),
    status: str('status').$type<StudentStatus>().notNull().default('active'),
    /** The student's portal login, when one has been given. */
    userId: ref('user_id'),
    createdById: ref('created_by_id').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('students_code_unique').on(t.studentCode),
    uniqueIndex('students_user_unique').on(t.userId),
    index('students_status_idx').on(t.status),
    index('students_phone_idx').on(t.phoneNormalized),
    index('students_email_idx').on(t.email),
    index('students_name_idx').on(t.fullName),
    check('students_dob_format', sql`${t.dateOfBirth} is null or ${isDateOnly(t.dateOfBirth)}`),
  ],
);

/** Trainers need not be system users, so they are their own table. */
export const trainers = table(
  'trainers',
  {
    id: id(),
    name: str('name').notNull(),
    email: str('email'),
    phone: str('phone'),
    expertise: str('expertise'),
    isActive: bool('is_active').notNull().default(true),
    userId: ref('user_id').references(() => users.id),
    ...timestamps(),
  },
  (t) => [index('trainers_active_idx').on(t.isActive), uniqueIndex('trainers_user_unique').on(t.userId)],
);

export const companies = table(
  'companies',
  {
    id: id(),
    name: str('name').notNull(),
    website: str('website'),
    industry: str('industry'),
    notes: str('notes'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('companies_name_unique').on(sql`lower(${t.name})`)],
);

export type LeadSource = typeof leadSources.$inferSelect;
export type Course = typeof courses.$inferSelect;
export type Student = typeof students.$inferSelect;
export type Trainer = typeof trainers.$inferSelect;
export type Company = typeof companies.$inferSelect;
