/**
 * Express application factory.
 *
 * Builds the app without binding a port, so the integration tests can drive it
 * in-process with Supertest and server.ts alone decides how to listen.
 *
 * Middleware order matters and is deliberate:
 *   1. request id + logging   -- so every later failure is traceable
 *   2. security headers, CORS -- applied even to requests that fail early
 *   3. body/cookie parsing    -- with a size cap against oversized payloads
 *   4. rate limiting          -- before any route does real work
 *   5. institute settings     -- cached, re-read once a minute
 *   6. routes
 *   7. 404, then the error handler, which must be registered last
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import { env, onVercel } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { apiRateLimit, corsMiddleware, securityHeaders } from './middleware/security';
import { v1Router } from './routes/v1';
import { ensureSettings } from './services/settings';

export function createApp(): Express {
  const app = express();

  // Behind Vercel/Render/a load balancer, the client IP arrives in X-Forwarded-For.
  // The hop count must be exact -- see TRUST_PROXY in config/env.ts.
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(requestLogger);
  app.use(securityHeaders);
  app.use(corsMiddleware);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());

  app.get(['/api', '/api/v1'], (_req, res) => res.json({ name: 'CRM QAROO INDIA API', status: 'ok', version: '1.0.0' }));
  app.use(['/api/v1', '/v1'], apiRateLimit, ensureSettings, v1Router);
  app.get(['/api/health', '/health'], (_req, res) => res.redirect('/api/v1/health'));

  // Standalone production: if dist/ exists and not on Vercel, serve client static files
  const distDir = resolve(process.cwd(), 'dist');
  if (env.NODE_ENV === 'production' && !onVercel && existsSync(resolve(distDir, 'index.html'))) {
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(resolve(distDir, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
