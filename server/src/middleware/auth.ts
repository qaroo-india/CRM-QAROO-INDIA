/**
 * Authentication and authorisation.
 *
 * `authenticate` re-reads the user on EVERY request rather than trusting the
 * token's contents. A SQLite primary-key lookup costs microseconds, and in
 * return deactivation, permission changes and "log out everywhere" take
 * effect immediately instead of when the access token happens to expire.
 */

import { hasAllPermissions, hasAnyPermission, type AccountType, type Permission } from '@ims/shared';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import { db } from '../db';
import { users } from '../db/schema';
import { ACCESS_COOKIE, verifyAccessToken } from '../modules/auth/tokens';
import { accountLinks, effectivePermissions, studentPortalBlocked, toPublicUser } from '../modules/users/serialize';
import { ApiError } from '../utils/ApiError';

/** Routes a user with a temporary password may still reach. */
const PASSWORD_CHANGE_ALLOWED = ['/api/v1/auth/'];

export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (typeof token !== 'string' || token.length === 0) {
    throw ApiError.unauthorized();
  }

  const result = await verifyAccessToken(token);
  if (!result.ok) {
    // The client answers TOKEN_EXPIRED by refreshing silently and retrying.
    throw result.reason === 'expired'
      ? new ApiError(401, 'TOKEN_EXPIRED', 'Your session has expired')
      : ApiError.unauthorized('Your session is not valid. Please sign in again.');
  }

  const user = db.select().from(users).where(eq(users.id, result.claims.sub)).get();
  if (!user || !user.isActive || user.tokenVersion !== result.claims.tv) {
    throw new ApiError(401, 'SESSION_REVOKED', 'Your session has ended. Please sign in again.');
  }
  // A student made inactive or suspended loses the portal on their next request.
  if (user.accountType === 'student' && studentPortalBlocked(user.id)) {
    throw new ApiError(401, 'SESSION_REVOKED', 'Your session has ended. Please sign in again.');
  }

  if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.some((p) => req.originalUrl.startsWith(p))) {
    throw new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', 'Please set a new password to continue.');
  }

  const links = accountLinks(user);
  req.auth = { user: toPublicUser(user), permissions: effectivePermissions(user), accountType: user.accountType, ...links };
  next();
};

/** Only these kinds of account may continue (e.g. the student portal). */
export function requireAccount(...types: AccountType[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw ApiError.unauthorized();
    if (!types.includes(req.auth.accountType)) throw ApiError.forbidden('This area is not available to your account.');
    if (req.auth.accountType === 'student' && !req.auth.studentId) {
      throw ApiError.forbidden('This login is not linked to a student record. Please contact the institute.');
    }
    if (req.auth.accountType === 'faculty' && !req.auth.trainerId) {
      throw ApiError.forbidden('This login is not linked to a trainer record. Please contact the institute.');
    }
    next();
  };
}

/**
 * The back office: team and faculty accounts only. Mounted in front of every
 * staff router, so a student login can never reach staff data even if a
 * route forgot its permission check.
 */
export const backOffice = requireAccount('team', 'faculty');

/** Require every listed permission. */
export function requirePermission(...required: Permission[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw ApiError.unauthorized();
    if (!hasAllPermissions(req.auth.permissions, required)) {
      throw ApiError.forbidden(`This action needs the "${required.join('", "')}" permission.`);
    }
    next();
  };
}

/** Require at least one of the listed permissions. */
export function requireAnyPermission(...required: Permission[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw ApiError.unauthorized();
    if (!hasAnyPermission(req.auth.permissions, required)) {
      throw ApiError.forbidden();
    }
    next();
  };
}

export const requireOwner: RequestHandler = (req, _res, next) => {
  if (!req.auth) throw ApiError.unauthorized();
  if (req.auth.user.role !== 'owner') throw ApiError.forbidden('Only the institute owner can do this.');
  next();
};
