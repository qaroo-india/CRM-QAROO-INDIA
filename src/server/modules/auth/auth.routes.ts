/**
 * POST /auth/login      public, rate limited, CSRF-checked
 * POST /auth/refresh    rotates the refresh cookie
 * POST /auth/logout     revokes the session family
 * GET  /auth/csrf       issues the CSRF cookie (call before login)
 * GET  /auth/me         current user + institute settings
 * POST /auth/password   change own password
 * POST /auth/forgot-password   public: email a reset link (same answer whether or not the email exists)
 * POST /auth/activate          public: a student claims a portal login with their registered email
 * POST /auth/reset-password    public: set a password with an emailed token (reset or activation)
 */

import { changePasswordSchema, loginSchema, type SessionResponse } from '@ims/shared';
import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { env } from '../../config/env';
import { authenticate } from '../../middleware/auth';
import { getSettings } from '../../services/settings';
import { ApiError } from '../../utils/ApiError';
import { contextFrom } from '../../utils/context';
import { ok } from '../../utils/respond';
import { parseBody } from '../../utils/validate';
import { toInstituteInfo, toSessionUser } from '../users/serialize';
import { requestPasswordReset, requestStudentActivation, setPasswordWithToken } from '../accounts/accounts.service';
import { changePassword, login, refreshSession, withAccessToken, type IssuedSession } from './auth.service';
import { clearSessionCookies, ensureCsrfToken, REFRESH_COOKIE, revokeRefreshFamily, setSessionCookies } from './tokens';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.LOGIN_RATE_LIMIT_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (_req, _res, next) => {
    next(new ApiError(429, 'RATE_LIMITED', 'Too many sign-in attempts. Please wait a few minutes.'));
  },
});

/**
 * Emailed-link requests always answer "sent" (so they cannot reveal which
 * emails exist), which means every request counts, not just failures.
 */
const selfServiceLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: Math.max(5, Math.floor(env.LOGIN_RATE_LIMIT_MAX / 2)),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please wait a few minutes.'));
  },
});

function meta(req: Request) {
  return { ip: req.ip, userAgent: req.get('user-agent') ?? undefined };
}

async function sessionBody(req: Request, res: Response, session: IssuedSession): Promise<SessionResponse> {
  return {
    user: await toSessionUser(session.user),
    institute: toInstituteInfo(getSettings()),
    csrfToken: ensureCsrfToken(req, res),
  };
}

authRouter.get('/csrf', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  ok(res, { csrfToken: ensureCsrfToken(req, res) });
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const input = parseBody(loginSchema, req);
  const session = await withAccessToken(await login(input, meta(req)));
  setSessionCookies(res, session.accessToken, session.refresh);
  ok(res, await sessionBody(req, res, session));
});

authRouter.post('/refresh', async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (typeof presented !== 'string' || !presented) {
    clearSessionCookies(res);
    throw new ApiError(401, 'SESSION_EXPIRED', 'Please sign in again.');
  }
  try {
    const session = await refreshSession(presented, meta(req));
    setSessionCookies(res, session.accessToken, session.refresh);
    ok(res, await sessionBody(req, res, session));
  } catch (error) {
    clearSessionCookies(res);
    throw error;
  }
});

authRouter.post('/logout', async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (typeof presented === 'string' && presented) await revokeRefreshFamily(presented);
  clearSessionCookies(res);
  ok(res, { signedOut: true });
});

authRouter.get('/me', authenticate, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = req.auth!.user;
  ok(res, {
    user: await toSessionUser(user),
    institute: toInstituteInfo(getSettings()),
    csrfToken: ensureCsrfToken(req, res),
  } satisfies SessionResponse);
});

authRouter.post('/password', authenticate, async (req, res) => {
  const input = parseBody(changePasswordSchema, req);
  const session = await changePassword(contextFrom(req), input, meta(req));
  setSessionCookies(res, session.accessToken, session.refresh);
  ok(res, await sessionBody(req, res, session));
});

authRouter.post('/forgot-password', selfServiceLimiter, async (req, res) => {
  await requestPasswordReset(req.body, meta(req));
  ok(res, { sent: true });
});

authRouter.post('/activate', selfServiceLimiter, async (req, res) => {
  await requestStudentActivation(req.body, meta(req));
  ok(res, { sent: true });
});

authRouter.post('/reset-password', selfServiceLimiter, async (req, res) => {
  ok(res, await setPasswordWithToken(req.body, meta(req)));
});
