/**
 * CSRF protection (double-submit). Every state-changing request must echo the
 * readable ims_csrf cookie in an X-CSRF-Token header. Another site can make a
 * browser send cookies, but it cannot read them to forge the matching header.
 */

import type { RequestHandler } from 'express';
import { CSRF_COOKIE, csrfMatches } from '../modules/auth/tokens';
import { ApiError } from '../utils/ApiError';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!csrfMatches(req.cookies?.[CSRF_COOKIE], req.get('x-csrf-token'))) {
    throw new ApiError(403, 'CSRF_FAILED', 'Security check failed. Refresh the page and try again.');
  }
  next();
};
