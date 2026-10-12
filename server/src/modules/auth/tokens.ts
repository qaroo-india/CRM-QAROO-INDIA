/**
 * Session tokens and their cookies.
 *
 *   ims_at   access token: a 15-minute HS256 JWT. HttpOnly, sent to /api.
 *   ims_rt   refresh token: 256 random bits, stored only as a SHA-256 hash.
 *            HttpOnly, sent only to /api/v1/auth, rotated on every use.
 *   ims_csrf CSRF token: readable by the app's own JavaScript, echoed in the
 *            X-CSRF-Token header (double-submit) on every state change.
 *
 * All three are SameSite=Strict, so a third-party site cannot make the browser
 * attach them at all. The CSRF token is defence in depth on top of that.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { newId } from '@ims/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { CookieOptions, Request, Response } from 'express';
import { errors as joseErrors, jwtVerify, SignJWT } from 'jose';
import { cookieSecure, env } from '../../config/env';
import { db } from '../../db';
import { refreshTokens, type User } from '../../db/schema';
import type { DbLike } from '../../db/types';

export const ACCESS_COOKIE = 'ims_at';
export const REFRESH_COOKIE = 'ims_rt';
export const CSRF_COOKIE = 'ims_csrf';

const ISSUER = 'institute-os';
const AUDIENCE = 'institute-os-api';
const accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

/**
 * A refresh token replaced within this window may be presented again without
 * being treated as theft: two tabs refreshing at the same moment both send
 * the same (about to be replaced) token.
 */
const ROTATION_GRACE_MS = 20_000;

const baseCookie: CookieOptions = {
  httpOnly: true,
  secure: cookieSecure,
  sameSite: 'strict',
};

/* ------------------------------------------------------------------ *
 * Access tokens
 * ------------------------------------------------------------------ */

export interface AccessClaims {
  sub: string;
  /** Token version: bumping users.token_version invalidates every live token. */
  tv: number;
}

export async function signAccessToken(user: Pick<User, 'id' | 'tokenVersion'>): Promise<string> {
  return new SignJWT({ tv: user.tokenVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_MINUTES}m`)
    .sign(accessKey);
}

export type AccessVerification =
  | { ok: true; claims: AccessClaims }
  | { ok: false; reason: 'expired' | 'invalid' };

export async function verifyAccessToken(token: string): Promise<AccessVerification> {
  try {
    const { payload } = await jwtVerify(token, accessKey, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.tv !== 'number') {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, claims: { sub: payload.sub, tv: payload.tv } };
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'invalid' };
  }
}

/* ------------------------------------------------------------------ *
 * Refresh tokens
 * ------------------------------------------------------------------ */

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

interface IssueOptions {
  familyId?: string;
  userAgent?: string;
  ip?: string;
}

export function issueRefreshToken(
  database: DbLike,
  userId: string,
  options: IssueOptions = {},
): { token: string; id: string; expiresAt: Date } {
  const token = randomBytes(32).toString('base64url');
  const id = newId();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  database
    .insert(refreshTokens)
    .values({
      id,
      userId,
      tokenHash: hashToken(token),
      familyId: options.familyId ?? newId(),
      expiresAt,
      userAgent: options.userAgent?.slice(0, 300) ?? null,
      ip: options.ip ?? null,
    })
    .run();
  return { token, id, expiresAt };
}

export type RotationResult =
  | { ok: true; userId: string; token: string; expiresAt: Date }
  | { ok: false; reason: 'missing' | 'expired' | 'revoked' | 'reused' };

/**
 * Exchange a refresh token for a new one in the same family. Runs in one
 * synchronous transaction, so two concurrent refreshes cannot both rotate.
 */
export function rotateRefreshToken(presented: string, meta: IssueOptions = {}): RotationResult {
  return db.transaction((tx) => {
    const row = tx.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hashToken(presented))).get();
    if (!row) return { ok: false, reason: 'missing' } as const;
    if (row.revokedAt) return { ok: false, reason: 'revoked' } as const;
    if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' } as const;

    if (row.replacedById) {
      const replacement = tx.select().from(refreshTokens).where(eq(refreshTokens.id, row.replacedById)).get();
      const withinGrace = replacement && Date.now() - replacement.createdAt.getTime() < ROTATION_GRACE_MS;
      if (!withinGrace) {
        // A token that was already exchanged is being replayed: assume theft
        // and end every session descended from the same login.
        tx.update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)))
          .run();
        return { ok: false, reason: 'reused' } as const;
      }
    }

    const next = issueRefreshToken(tx, row.userId, { ...meta, familyId: row.familyId });
    tx.update(refreshTokens).set({ replacedById: next.id }).where(eq(refreshTokens.id, row.id)).run();
    return { ok: true, userId: row.userId, token: next.token, expiresAt: next.expiresAt } as const;
  });
}

/** Revoke the family a presented token belongs to (logout). */
export function revokeRefreshFamily(presented: string): void {
  const row = db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hashToken(presented))).get();
  if (!row) return;
  db.update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)))
    .run();
}

/** Revoke every refresh token a user holds (password change, deactivation). */
export function revokeAllForUser(database: DbLike, userId: string): void {
  database
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
    .run();
}

/* ------------------------------------------------------------------ *
 * Cookies
 * ------------------------------------------------------------------ */

export function setSessionCookies(res: Response, access: string, refresh: { token: string; expiresAt: Date }): void {
  res.cookie(ACCESS_COOKIE, access, {
    ...baseCookie,
    path: '/api',
    maxAge: env.ACCESS_TOKEN_TTL_MINUTES * 60_000,
  });
  res.cookie(REFRESH_COOKIE, refresh.token, {
    ...baseCookie,
    path: '/api/v1/auth',
    expires: refresh.expiresAt,
  });
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...baseCookie, path: '/api' });
  res.clearCookie(REFRESH_COOKIE, { ...baseCookie, path: '/api/v1/auth' });
}

/** Return the existing CSRF token or mint one, setting the readable cookie. */
export function ensureCsrfToken(req: Request, res: Response): string {
  const existing = req.cookies?.[CSRF_COOKIE];
  if (typeof existing === 'string' && /^[A-Za-z0-9_-]{32,64}$/.test(existing)) return existing;
  const token = randomBytes(32).toString('base64url');
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: cookieSecure,
    sameSite: 'strict',
    path: '/',
  });
  return token;
}

export function csrfMatches(cookieValue: unknown, headerValue: unknown): boolean {
  if (typeof cookieValue !== 'string' || typeof headerValue !== 'string') return false;
  const a = Buffer.from(cookieValue);
  const b = Buffer.from(headerValue);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
