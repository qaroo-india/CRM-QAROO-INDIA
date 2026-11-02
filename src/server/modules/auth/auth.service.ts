/**
 * Sign-in, session refresh, sign-out and password changes.
 */

import type { ChangePasswordInput, LoginInput } from '@ims/shared';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db';
import { users, type User } from '../../db/schema';
import { recordAudit } from '../../services/audit';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { studentPortalBlocked } from '../users/serialize';
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
  const user = await db.select().from(users).where(eq(users.email, input.email)).get();

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
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
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

  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw ApiError.validation([{ path: 'currentPassword', message: 'Current password is incorrect' }]);
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
