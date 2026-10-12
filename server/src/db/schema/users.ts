/**
 * Staff and owner accounts.
 *
 * Authentication (Milestone 2) reads this table on every token refresh, so the
 * revocation fields live here rather than in a separate sessions table:
 *   - isActive      : deactivating a user blocks login and refresh immediately
 *   - tokenVersion  : incrementing it invalidates every refresh token ever issued
 *   - lockedUntil   : temporary lockout after repeated failed logins
 *
 * Users are never hard-deleted. Financial rows reference whoever recorded them,
 * and an audit trail that points at a missing user is not an audit trail.
 */

import { ROLES, type AccountType, type EmploymentType, type Role } from '@ims/shared';
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
  json,
  ref,
  sql,
  str,
  table,
  timestamps,
  uniqueIndex,
  type AnyColumn,
} from '../dialect';

export const users = table(
  'users',
  {
    id: id(),
    /** Stored lowercased and trimmed, so the unique index is case-insensitive in effect. */
    email: str('email').notNull(),
    name: str('name').notNull(),
    phone: str('phone'),
    passwordHash: str('password_hash').notNull(),

    role: enumStr('role', ROLES).$type<Role>().notNull().default('staff'),
    /** team | faculty | student -- which application the person uses (see ACCOUNT_TYPES). */
    accountType: str('account_type').$type<AccountType>().notNull().default('team'),
    /**
     * Granted permission strings, e.g. ["leads:read", "payments:write"].
     * Owners hold ["*"]. Checked server-side on every protected request.
     */
    permissions: json<string[]>('permissions')
      .notNull()
      .$defaultFn(() => []),

    isActive: bool('is_active').notNull().default(true),
    /** Set for seeded owners and owner-issued temporary passwords. */
    mustChangePassword: bool('must_change_password').notNull().default(false),
    tokenVersion: int('token_version').notNull().default(0),
    failedLoginCount: int('failed_login_count').notNull().default(0),
    lockedUntil: instant('locked_until'),
    lastLoginAt: instant('last_login_at'),
    passwordChangedAt: instant('password_changed_at'),

    // Staff profile (team and faculty accounts)
    staffCode: str('staff_code'),
    designation: str('designation'),
    department: str('department'),
    employmentType: str('employment_type').$type<EmploymentType>(),
    joinedOn: dateOnly('joined_on'),
    specialisation: str('specialisation'),
    bio: str('bio'),
    /** Storage key of the profile photo (served only through an authorised route). */
    photoKey: str('photo_key'),
    photoMime: str('photo_mime'),

    createdById: ref('created_by_id').references((): AnyColumn => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(t.email),
    uniqueIndex('users_staff_code_unique').on(t.staffCode),
    index('users_account_type_idx').on(t.accountType, t.isActive),
    index('users_role_active_idx').on(t.role, t.isActive),
    check('users_role_check', inList(t.role, ROLES)),
    check('users_email_lowercase', sql`${t.email} = lower(trim(${t.email}))`),
    check('users_failed_login_nonneg', sql`${t.failedLoginCount} >= 0`),
    check('users_token_version_nonneg', sql`${t.tokenVersion} >= 0`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/** The user shape that may leave the server. Never includes the password hash. */
export type PublicUser = Omit<
  User,
  'passwordHash' | 'tokenVersion' | 'failedLoginCount' | 'lockedUntil'
>;
