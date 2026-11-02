/**
 * Shapes users take on the way out. Every response goes through one of these,
 * so a password hash or token version can never reach the network.
 */

import { ALL_PERMISSIONS, type InstituteInfo, type JobRole, type SessionUser, type UserSummary } from '@ims/shared';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db';
import { students, trainers, type InstituteSettings, type PublicUser, type User } from '../../db/schema';
import type { DbLike } from '../../db/types';

/**
 * Owners always hold the wildcard, whatever their stored list says. Student
 * logins hold nothing: the portal is reached by account type, never by
 * back-office permissions, so a mis-granted permission cannot open staff data.
 */
export function effectivePermissions(user: Pick<User, 'role' | 'permissions' | 'accountType'>): string[] {
  if (user.accountType === 'student') return [];
  return user.role === 'owner' ? [ALL_PERMISSIONS] : [...user.permissions];
}

export interface AccountLinks {
  studentId: string | null;
  trainerId: string | null;
}

/**
 * Student records in these states may not use the portal (graduated students
 * still may: they download certificates and receipts).
 */
export const PORTAL_BLOCKED_STUDENT_STATUSES: readonly string[] = ['inactive', 'suspended'];

/** True when the student record behind a student login is inactive or suspended. */
export async function studentPortalBlocked(userId: string, database: DbLike = db): Promise<boolean> {
  const record = await database.select({ status: students.status }).from(students).where(eq(students.userId, userId)).get();
  return Boolean(record && PORTAL_BLOCKED_STUDENT_STATUSES.includes(record.status));
}

/** The student or trainer record a portal login belongs to. */
export async function accountLinks(user: Pick<User, 'id' | 'accountType'> & { email?: string }, database: DbLike = db): Promise<AccountLinks> {
  if (user.accountType === 'student') {
    let studentId = (await database.select({ id: students.id }).from(students).where(eq(students.userId, user.id)).get())?.id ?? null;
    if (!studentId && user.email) {
      const match = await database.select({ id: students.id }).from(students).where(sql`lower(${students.email}) = ${user.email.toLowerCase()}`).get();
      if (match) {
        studentId = match.id;
        try {
          await database.update(students).set({ userId: user.id }).where(eq(students.id, match.id)).run();
        } catch {
          // ignore unique constraint if already linked elsewhere
        }
      }
    }
    return { studentId, trainerId: null };
  }
  if (user.accountType === 'faculty') {
    let trainerId = (await database.select({ id: trainers.id }).from(trainers).where(eq(trainers.userId, user.id)).get())?.id ?? null;
    if (!trainerId && user.email) {
      const match = await database.select({ id: trainers.id }).from(trainers).where(sql`lower(${trainers.email}) = ${user.email.toLowerCase()}`).get();
      if (match) {
        trainerId = match.id;
        try {
          await database.update(trainers).set({ userId: user.id }).where(eq(trainers.id, match.id)).run();
        } catch {
          // ignore unique constraint if already linked elsewhere
        }
      }
    }
    return { studentId: null, trainerId };
  }
  return { studentId: null, trainerId: null };
}

/** Only office staff have a job role; the owner is the admin. */
function jobRoleOf(user: Pick<User, 'role' | 'accountType' | 'jobRole'>): JobRole | null {
  return user.role === 'staff' && user.accountType === 'team' ? (user.jobRole ?? null) : null;
}

export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _p, tokenVersion: _t, failedLoginCount: _f, lockedUntil: _l, ...rest } = user;
  return rest;
}

export async function toSessionUser(user: User | PublicUser, given?: AccountLinks): Promise<SessionUser> {
  const links = given ?? (await accountLinks(user));
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    accountType: user.accountType,
    jobRole: jobRoleOf(user),
    studentId: links.studentId,
    trainerId: links.trainerId,
    hasPhoto: Boolean(user.photoKey),
    permissions: effectivePermissions(user),
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

export async function toUserSummary(user: User | PublicUser, given?: AccountLinks): Promise<UserSummary> {
  const links = given ?? (await accountLinks(user));
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    accountType: user.accountType,
    jobRole: jobRoleOf(user),
    permissions: effectivePermissions(user),
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    staffCode: user.staffCode,
    designation: user.designation,
    department: user.department,
    employmentType: user.employmentType,
    joinedOn: user.joinedOn,
    specialisation: user.specialisation,
    bio: user.bio,
    hasPhoto: Boolean(user.photoKey),
    trainerId: links.trainerId,
    studentId: links.studentId,
  };
}

export function toInstituteInfo(settings: InstituteSettings): InstituteInfo {
  return {
    name: settings.name,
    legalName: settings.legalName,
    tagline: settings.tagline,
    logoUrl: settings.logoUrl,
    email: settings.email,
    phone: settings.phone,
    website: settings.website,
    address: settings.address,
    taxId: settings.taxId,
    timezone: settings.timezone,
    currency: settings.currency,
    locale: settings.locale,
    fiscalYearStartMonth: settings.fiscalYearStartMonth,
    weekStartsOn: settings.weekStartsOn,
    studentCodePrefix: settings.studentCodePrefix,
    admissionNumberPrefix: settings.admissionNumberPrefix,
    receiptNumberPrefix: settings.receiptNumberPrefix,
    leadCodePrefix: settings.leadCodePrefix,
    expenseCodePrefix: settings.expenseCodePrefix,
    expenseApprovalRequired: settings.expenseApprovalRequired,
    dueReminderDays: settings.dueReminderDays,
    unassignedAlertDays: settings.unassignedAlertDays,
    reportRecipients: settings.reportRecipients,
  };
}
