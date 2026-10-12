/**
 * HTTP hardening: security headers, CORS, and baseline rate limiting.
 *
 * CORS here is about which BROWSER origins may read responses while sending
 * cookies. It is not access control -- a script outside a browser ignores CORS
 * entirely. Authentication and per-route authorization (Milestone 2) remain the
 * actual security boundary; CORS only stops other websites from riding along
 * on a logged-in staff member's cookies.
 */

import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';

export const securityHeaders = helmet({
  // The API serves JSON only; a strict policy costs nothing and blocks any
  // response that is somehow rendered as a document from running scripts.
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  // HSTS only makes sense once the API is served over HTTPS.
  strictTransportSecurity: env.NODE_ENV === 'production',
});

const allowedOrigins = new Set(env.CLIENT_URL);

export const corsMiddleware = cors({
  origin(origin, callback) {
    // No Origin header: same-origin requests, curl, server-to-server, health
    // probes. CORS does not apply to them, so there is nothing to allow or deny.
    if (!origin) return callback(null, true);
    // Unknown origins get no CORS headers, so the browser refuses to expose the
    // response. Not an error -- throwing here would turn it into a 500.
    return callback(null, allowedOrigins.has(origin));
  },
  // Required for the HttpOnly session cookies introduced in Milestone 2.
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id', 'Idempotency-Key'],
  // Content-Disposition lets the client read the filename of PDF/Excel downloads.
  exposedHeaders: ['X-Request-Id', 'Content-Disposition', 'RateLimit', 'RateLimit-Policy'],
  maxAge: 600,
});

/**
 * Baseline limit for the whole API. Tighter, per-account limits for login and
 * password reset are added with authentication in Milestone 2.
 */
export const apiRateLimit = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // Liveness probes must never be throttled into a false "service down".
  skip: (req) => req.path === '/health/live',
  handler: (_req, _res, next) => {
    next(ApiError.tooManyRequests());
  },
});
