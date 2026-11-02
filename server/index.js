/**
 * Vercel entry for the API: the "server" service's entrypoint in vercel.json,
 * and the file Vercel finds first if the project is ever set up as a single
 * Express app in server/. Vercel needs the Express app as the default export:
 * that is the bundle `npm run build` writes from src/vercel.ts.
 *
 * It is committed (not built) because Vercel checks that the entrypoint
 * exists before it runs the build, and plain JavaScript so Vercel compiles
 * no TypeScript.
 */

// Marks this file as the Express entry for Vercel's detection; the bundle
// below loads Express itself.
import 'express';

export { default } from './dist/vercel.js';
