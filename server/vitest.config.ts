import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Set before any test file is imported, so config/env.ts sees them and the
    // suite never touches the real database file or needs a .env.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: ':memory:',
      LOG_LEVEL: 'silent',
      INSTITUTE_TIMEZONE: 'Asia/Kolkata',
      JOBS_ENABLED: 'false',
      EMAIL_TRANSPORT: 'log',
      STORAGE_DIR: './storage-test',
      LOGIN_RATE_LIMIT_MAX: '1000',
      RATE_LIMIT_MAX: '100000',
      // A placeholder for the cron endpoint tests, not a real secret.
      CRON_SECRET: 'test-only-cron-secret-0123456789',
    },
    // Each test file runs in its own process with its own throwaway database
    // (":memory:" becomes a temporary file; see src/db/index.ts).
    // Forks (not threads) because libSQL is a native module.
    pool: 'forks',
    // One fork per core (12 on a dev laptop), each loading native modules,
    // crashed workers at start-up on an 8 GB machine (exit 0xC0000409), and 4
    // still did right after a memory-hungry typecheck. Two forks cost ~4 s.
    maxWorkers: 2,
  },
});
