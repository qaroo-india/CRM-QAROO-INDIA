/**
 * Sign-in, session refresh, sign-out and password changes.
 */

import { DEFAULT_FACULTY_PERMISSIONS, type ChangePasswordInput, type LoginInput } from '@ims/shared';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db';
import { students, trainers, users, type User } from '../../db/schema';
import { recordAudit } from '../../services/audit';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { PORTAL_BLOCKED_STUDENT_STATUSES, studentPortalBlocked } from '../users/serialize';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password';
import { issueRefreshToken, revokeAllForUser, rotateRefreshToken, signAccessToken } from './tokens';

/** Failed attempts before a temporary lockout, and how long it lasts. */
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

const INVALID_CREDENTIALS = () =>
  new ApiError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');

export interface IssuedSession {
  user: User;
  accessToken: string;
  refresh: { token: string; expiresAt: Date };
}

interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

export async function login(input: LoginInput, meta: ClientMeta): Promise<IssuedSession> {
  const cleanEmail = input.email.trim().toLowerCase();
  let user = await db.select().from(users).where(eq(users.email, cleanEmail)).get();

  // If no user record exists, check if email belongs to an existing trainer or student
  if (!user) {
    const trainer = await db.select().from(trainers).where(sql`lower(${trainers.email}) = ${cleanEmail}`).get();
    if (trainer && trainer.isActive) {
      const passwordHash = await hashPassword(input.password);
      user = await db.transaction(async (tx) => {
        const created = await tx
          .insert(users)
          .values({
            name: trainer.name,
            email: cleanEmail,
            phone: trainer.phone,
            passwordHash,
            role: 'staff',
            accountType: 'faculty',
            permissions: [...DEFAULT_FACULTY_PERMISSIONS],
            mustChangePassword: false,
            isActive: true,
          })
          .returning()
          .get();
        await tx.update(trainers).set({ userId: created.id }).where(eq(trainers.id, trainer.id)).run();
        return created;
      });
    } else {
      const student = await db.select().from(students).where(sql`lower(${students.email}) = ${cleanEmail}`).get();
      if (student && !PORTAL_BLOCKED_STUDENT_STATUSES.includes(student.status)) {
        const passwordHash = await hashPassword(input.password);
        user = await db.transaction(async (tx) => {
          const created = await tx
            .insert(users)
            .values({
              name: student.fullName,
              email: cleanEmail,
              phone: student.phone,
              passwordHash,
              role: 'staff',
              accountType: 'student',
              permissions: [],
              mustChangePassword: false,
              isActive: true,
            })
            .returning()
            .get();
          await tx.update(students).set({ userId: created.id }).where(eq(students.id, student.id)).run();
          return created;
        });
      }
    }
  }

  if (!user) {
    await verifyAgainstDummy(input.password);
    throw INVALID_CREDENTIALS();
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new ApiError(
      429,
      'ACCOUNT_LOCKED',
      `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask the owner to reset your password.`,
    );
  }

  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) {
    const failures = user.failedLoginCount + 1;
    const lock = failures >= MAX_FAILED_LOGINS;
    await db.update(users)
      .set({
        failedLoginCount: lock ? 0 : failures,
        lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : user.lockedUntil,
      })
      .where(eq(users.id, user.id))
      .run();
    throw INVALID_CREDENTIALS();
  }

  // Ensure trainer/student links are established if missing
  if (user.accountType === 'faculty') {
    const linked = await db.select({ id: trainers.id }).from(trainers).where(eq(trainers.userId, user.id)).get();
    if (!linked) {
      const match = await db.select().from(trainers).where(sql`lower(${trainers.email}) = ${cleanEmail}`).get();
      if (match) {
        await db.update(trainers).set({ userId: user.id }).where(eq(trainers.id, match.id)).run();
      }
    }
  } else if (user.accountType === 'student') {
    const linked = await db.select({ id: students.id }).from(students).where(eq(students.userId, user.id)).get();
    if (!linked) {
      const match = await db.select().from(students).where(sql`lower(${students.email}) = ${cleanEmail}`).get();
      if (match) {
        await db.update(students).set({ userId: user.id }).where(eq(students.id, match.id)).run();
      }
    }
  }

  // Revealed only after a correct password, so it leaks nothing to a guesser.
  if (!user.isActive) {
    throw new ApiError(403, 'ACCOUNT_DISABLED', 'This account has been deactivated. Contact the institute owner.');
  }
  if (user.accountType === 'student' && await studentPortalBlocked(user.id)) {
    throw new ApiError(403, 'ACCOUNT_DISABLED', 'Your student account is not active at the moment. Please contact the institute office.');
  }

  return await db.transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), mustChangePassword: false })
      .where(eq(users.id, user.id))
      .returning()
      .get();
    const refresh = await issueRefreshToken(tx, user.id, meta);
    await recordAudit(
      tx,
      { actorId: user.id, actorName: user.name, permissions: [], isOwner: false, accountType: user.accountType, ip: meta.ip },
      { action: 'login', entityType: 'user', entityId: user.id, summary: `${user.name} signed in` },
    );
    return { user: updated, accessToken: '', refresh };
  });
}

/** Finish a session issue by signing the access token (async, outside the sync transaction). */
export async function withAccessToken(session: IssuedSession): Promise<IssuedSession> {
  return { ...session, accessToken: await signAccessToken(session.user) };
}

export async function refreshSession(presented: string, meta: ClientMeta): Promise<IssuedSession> {
  const rotation = await rotateRefreshToken(presented, meta);
  if (!rotation.ok) {
    throw rotation.reason === 'reused'
      ? new ApiError(401, 'SESSION_REVOKED', 'This session was ended for your security. Please sign in again.')
      : new ApiError(401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
  }

  const user = await db.select().from(users).where(eq(users.id, rotation.userId)).get();
  if (!user || !user.isActive || (user.accountType === 'student' && await studentPortalBlocked(user.id))) {
    throw new ApiError(401, 'SESSION_REVOKED', 'Your session has ended. Please sign in again.');
  }
  return {
    user,
    accessToken: await signAccessToken(user),
    refresh: { token: rotation.token, expiresAt: rotation.expiresAt },
  };
}

export async function changePassword(
  ctx: RequestContext,
  input: ChangePasswordInput,
  meta: ClientMeta,
): Promise<IssuedSession> {
  const user = await db.select().from(users).where(eq(users.id, ctx.actorId)).get();
  if (!user) throw ApiError.unauthorized();

  // Only require current password verification if not already in forced password change mode
  if (!user.mustChangePassword) {
    if (!input.currentPassword || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw ApiError.validation([{ path: 'currentPassword', message: 'Current password is incorrect' }]);
    }
  }

  const passwordHash = await hashPassword(input.newPassword);

  const session = await db.transaction(async (tx) => {
    // Bumping the token version ends every other session for this account.
    const updated = await tx
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
        tokenVersion: sql`${users.tokenVersion} + 1`,
      })
      .where(eq(users.id, user.id))
      .returning()
      .get();
    await revokeAllForUser(tx, user.id);
    const refresh = await issueRefreshToken(tx, user.id, meta);
    await recordAudit(tx, ctx, {
      action: 'password_change',
      entityType: 'user',
      entityId: user.id,
      summary: `${user.name} changed their password`,
    });
    return { user: updated, accessToken: '', refresh };
  });

  return await withAccessToken(session);
}
