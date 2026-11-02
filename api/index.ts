/**
 * Vercel Serverless Function entry point.
 *
 * Automatically detected by Vercel for /api requests.
 * Exports the Express app instance as the default handler.
 */

import '../src/server/config/vercelDefaults';
import { createApp } from '../src/server/app';

const app = createApp();

export default app;
