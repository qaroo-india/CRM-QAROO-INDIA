/**
 * drizzle-kit configuration: generates SQL migrations from the schema.
 *
 *   npm run db:generate   -- diff the schema, write a new migration to ./drizzle
 *   npm run db:studio     -- browse the database in a local web UI
 */

import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

loadDotenv({ path: resolve(process.cwd(), '.env'), quiet: true });

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? './data/institute.db',
  },
  // Ask before any destructive statement (dropping a column, recreating a table).
  strict: true,
  verbose: true,
});
