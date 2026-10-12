/**
 * Per-request id and access logging.
 *
 * Every request gets an id, echoed back in the X-Request-Id header and included
 * in error responses. When a staff member reports "the payment screen failed",
 * that id finds the exact log lines.
 *
 * An incoming X-Request-Id (set by a proxy or the client) is reused only if it
 * looks like a plain token, so a crafted header cannot inject fake log entries.
 */

import { newId } from '@ims/shared';
import { pinoHttp } from 'pino-http';
import { logger } from '../config/logger';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export const requestLogger = pinoHttp({
  logger,

  genReqId(req, res) {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : newId();
    res.setHeader('X-Request-Id', id);
    return id;
  },

  // 5xx are bugs, 4xx are user mistakes worth seeing, the rest is routine.
  customLogLevel(_req, res, error) {
    if (error || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },

  // Liveness probes fire every few seconds; logging each one buries real traffic.
  autoLogging: {
    ignore: (req) => req.url === '/api/v1/health/live',
  },

  // Log what is needed to trace a request and nothing more. Headers (cookies,
  // tokens) and bodies (personal and financial data) are deliberately omitted.
  serializers: {
    req: (req: { id: unknown; method: string; url: string }) => ({
      id: req.id,
      method: req.method,
      url: req.url,
    }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
  },
});
