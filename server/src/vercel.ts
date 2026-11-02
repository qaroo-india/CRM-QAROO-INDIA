/**
 * Vercel Function entry point (vercel.json, service "server").
 *
 * Vercel runs the Express app as one function and sends it every request
 * under /api, path unchanged. Unlike src/server.ts there is no listen(), no
 * in-process timers (Vercel Cron calls /api/v1/cron/tick) and no shutdown
 * handling. Settings are loaded per instance by the ensureSettings
 * middleware; migrations run during the build (scripts/vercel-build.mjs).
 */

import './config/vercelDefaults';
import { createApp } from './app';

export default createApp();
