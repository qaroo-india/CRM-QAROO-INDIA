import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'client',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['src/shared/**', 'src/server/**'],
        },
        resolve: {
          alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            '@ims/shared': fileURLToPath(new URL('./src/shared/index.ts', import.meta.url)),
          },
        },
      },
      {
        test: {
          name: 'shared',
          environment: 'node',
          include: ['src/shared/**/*.test.ts'],
        },
        resolve: {
          alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            '@ims/shared': fileURLToPath(new URL('./src/shared/index.ts', import.meta.url)),
          },
        },
      },
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
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
            CRON_SECRET: 'test-only-cron-secret-0123456789',
          },
          pool: 'forks',
          maxWorkers: 2,
        },
        resolve: {
          alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            '@ims/shared': fileURLToPath(new URL('./src/shared/index.ts', import.meta.url)),
          },
        },
      },
    ],
  },
});
