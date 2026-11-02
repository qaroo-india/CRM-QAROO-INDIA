/**
 * Vercel entry when the project is set up as a single Express app with Root
 * Directory "server" (vercel.json "services" point at dist/vercel.js
 * directly). Vercel looks for index.js before src/ and needs the Express app
 * as the default export: that is the bundle `npm run build` writes from
 * src/vercel.ts. Plain JavaScript, so Vercel compiles no TypeScript.
 */

// Marks this file as the Express entry for Vercel's detection; the bundle
// below loads Express itself.
import 'express';

export { default } from './dist/vercel.js';
