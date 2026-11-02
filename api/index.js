/**
 * Vercel Serverless Function entry point.
 *
 * Automatically detected by Vercel for /api requests.
 * Exports the pre-bundled Express application (dist/vercel.js).
 */

import 'express';
import app from '../dist/vercel.js';

export default app;
