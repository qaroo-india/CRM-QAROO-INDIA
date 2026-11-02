/**
 * Institute-wide configuration: a single row, enforced by a CHECK constraint.
 *
 * The environment variables INSTITUTE_TIMEZONE / CURRENCY / LOCALE only SEED
 * this row. Once it exists, this row is authoritative and the owner edits it
 * from the Settings screen -- so changing an env var later does not silently
 * re-bucket historical reports into a different time zone.
 */

import {
  bool,
  check,
  int,
  json,
  ref,
  sql,
  str,
  table,
  timestamps,
} from '../dialect';
import { users } from './users';

export const INSTITUTE_SETTINGS_ID = 'default';

export const instituteSettings = table(
  'institute_settings',
  {
    id: str('id').primaryKey().default(INSTITUTE_SETTINGS_ID),

    name: str('name').notNull(),
    legalName: str('legal_name'),
    tagline: str('tagline'),
    logoUrl: str('logo_url'),
    email: str('email'),
    phone: str('phone'),
    website: str('website'),
    address: str('address'),
    /** GSTIN or other tax registration, printed on receipts when present. */
    taxId: str('tax_id'),

    timezone: str('timezone').notNull(),
    currency: str('currency').notNull(),
    locale: str('locale').notNull(),
    /** 1-12. India's financial year starts in April (4). */
    fiscalYearStartMonth: int('fiscal_year_start_month').notNull().default(4),
    /** 0 = Sunday ... 6 = Saturday. Defines "this week" in reports. */
    weekStartsOn: int('week_starts_on').notNull().default(1),

    // Prefixes for human-facing codes, e.g. RCT-2026-00042 on a receipt.
    studentCodePrefix: str('student_code_prefix').notNull().default('STU'),
    admissionNumberPrefix: str('admission_number_prefix').notNull().default('ADM'),
    receiptNumberPrefix: str('receipt_number_prefix').notNull().default('RCT'),
    leadCodePrefix: str('lead_code_prefix').notNull().default('LEAD'),
    expenseCodePrefix: str('expense_code_prefix').notNull().default('EXP'),

    /** When on, new expenses wait as 'pending' until an owner approves them. */
    expenseApprovalRequired: bool('expense_approval_required').notNull().default(false),
    /** Days before a due date that an instalment reminder is raised. */
    dueReminderDays: int('due_reminder_days').notNull().default(3),
    /** Days an active admission may wait without a batch before an alert. */
    unassignedAlertDays: int('unassigned_alert_days').notNull().default(7),
    /** Extra email addresses (beyond staff) allowed to receive reports. */
    // A SQL-level default (not $defaultFn) because SQLite can only add a
    // NOT NULL column to an existing table when the database supplies a value.
    reportRecipients: json<string[]>('report_recipients')
      .notNull()
      .default(sql`'[]'`),

    updatedById: ref('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    check('institute_settings_singleton', sql`${t.id} = 'default'`),
    check('institute_settings_fy_month', sql`${t.fiscalYearStartMonth} between 1 and 12`),
    check('institute_settings_week_start', sql`${t.weekStartsOn} between 0 and 6`),
    check('institute_settings_currency', sql`length(${t.currency}) = 3`),
  ],
);

export type InstituteSettings = typeof instituteSettings.$inferSelect;
export type NewInstituteSettings = typeof instituteSettings.$inferInsert;
