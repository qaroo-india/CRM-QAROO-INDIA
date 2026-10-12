/**
 * Environment configuration.
 *
 * Every variable the server reads is declared and validated here, once, at
 * startup. A missing or malformed value stops the process immediately with a
 * readable list of problems, instead of surfacing hours later as a mysterious
 * failure inside a payment or report request.
 *
 * No other file reads process.env directly -- import `env` from here.
 */

import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Load server/.env when present. Real environment variables always win, which
// is what lets the test runner and the hosting platform override file values.
loadDotenv({ path: resolve(process.cwd(), '.env'), quiet: true });

const NODE_ENVS = ['development', 'test', 'production'] as const;

/** Development-only placeholders. Production startup rejects both. */
const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-change-me-0123456789';
const DEV_OWNER_PASSWORD = 'ChangeMe-Owner-2026';

/** "true"/"false"/"1"/"0" -> boolean. z.coerce.boolean() would read "false" as true. */
const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])])
  .transform((value) => value === true || value === 'true' || value === '1' || value === 'yes');
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function isValidLocale(locale: string): boolean {
  try {
    return Intl.NumberFormat.supportedLocalesOf([locale]).length > 0;
  } catch {
    return false;
  }
}

/** "http://a.com, http://b.com" -> ["http://a.com", "http://b.com"], each a bare origin. */
const originListSchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  )
  .pipe(
    z
      .array(
        z.string().refine((origin) => {
          try {
            const url = new URL(origin);
            return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === origin;
          } catch {
            return false;
          }
        }, 'each origin must look like https://example.com with no path'),
      )
      .min(1, 'at least one client origin is required'),
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).default('development'),

    // Loopback by default so a dev server is not exposed to the local network.
    // Hosting platforms such as Render require 0.0.0.0 -- set HOST there.
    HOST: z.string().trim().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),

    /** Browser origins allowed to call the API with credentials. */
    CLIENT_URL: originListSchema.default(['http://localhost:5173']),

    /**
     * Number of reverse proxies in front of the app. Must be accurate: rate
     * limiting keys on the client IP, and a wrong value either trusts spoofed
     * X-Forwarded-For headers or rate-limits every user as the proxy's IP.
     */
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),

    /**
     * SQLite database file, relative to the server directory, or ":memory:"
     * for an ephemeral database (used by the automated tests).
     */
    DATABASE_URL: z.string().trim().min(1).default('./data/institute.db'),

    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),

    /**
     * Institute defaults. These only SEED the institute_settings row on first
     * run; afterwards that row is authoritative and is edited in the app.
     */
    INSTITUTE_NAME: z.string().trim().min(1).max(200).default('Course Institute'),
    /** IANA zone used to decide which calendar day a transaction belongs to. */
    INSTITUTE_TIMEZONE: z
      .string()
      .trim()
      .default('Asia/Kolkata')
      .refine(isValidTimeZone, 'must be an IANA time zone such as Asia/Kolkata'),
    INSTITUTE_CURRENCY: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'must be a 3-letter ISO 4217 code such as INR')
      .default('INR'),
    INSTITUTE_LOCALE: z
      .string()
      .trim()
      .default('en-IN')
      .refine(isValidLocale, 'must be a supported locale such as en-IN'),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    /** Login attempts per IP per window, on top of per-account lockout. */
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),

    /* ---------------- Authentication (Milestone 2) ---------------- */

    /**
     * Signs access tokens. Development falls back to a fixed placeholder so
     * sessions survive tsx restarts; production refuses that placeholder.
     */
    JWT_ACCESS_SECRET: z.string().trim().min(32, 'must be at least 32 characters').default(DEV_JWT_SECRET),
    ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    /** Secure cookies need HTTPS; defaults to on in production only. */
    COOKIE_SECURE: booleanish.optional(),

    /** First owner account, created by `npm run db:seed` when no owner exists. */
    OWNER_EMAIL: z.string().trim().toLowerCase().pipe(z.email()).default('owner@institute.local'),
    OWNER_NAME: z.string().trim().min(1).default('Institute Owner'),
    OWNER_INITIAL_PASSWORD: z.string().min(10).default(DEV_OWNER_PASSWORD),

    /* ---------------- Files ---------------- */

    /** Uploaded documents, relative to the server directory. */
    STORAGE_DIR: z.string().trim().min(1).default('./storage'),
    MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(50).default(10),

    /* ---------------- Email (Milestone 8) ---------------- */

    /**
     * smtp     -- send through SMTP_* below
     * log      -- development: build the email and log it, send nothing
     * disabled -- email features answer "not configured"
     */
    EMAIL_TRANSPORT: z.enum(['smtp', 'log', 'disabled']).default('log'),
    SMTP_HOST: z.string().trim().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: booleanish.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().trim().default('Institute OS <reports@institute.local>'),
    /** Public URL of the web app, used for links inside emails. */
    APP_URL: z.url().default('http://localhost:5173'),

    /** Background jobs (reminder sweep, scheduled reports). Off in tests. */
    JOBS_ENABLED: booleanish.default(true),
  })
  .superRefine((value, ctx) => {
    if (value.EMAIL_TRANSPORT === 'smtp' && !value.SMTP_HOST) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'is required when EMAIL_TRANSPORT=smtp' });
    }

    if (value.NODE_ENV !== 'production') return;

    if (value.JWT_ACCESS_SECRET === DEV_JWT_SECRET || value.JWT_ACCESS_SECRET.includes('dev-only')) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message: 'set a unique random secret in production (see server/.env.example)',
      });
    }
    if (value.OWNER_INITIAL_PASSWORD === DEV_OWNER_PASSWORD) {
      ctx.addIssue({
        code: 'custom',
        path: ['OWNER_INITIAL_PASSWORD'],
        message: 'set a private initial owner password in production',
      });
    }
    if (value.EMAIL_TRANSPORT === 'log') {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_TRANSPORT'],
        message: 'use "smtp" (or "disabled") in production; "log" sends nothing',
      });
    }

    if (value.DATABASE_URL === ':memory:') {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'an in-memory database would lose every record on restart in production',
      });
    }
    for (const origin of value.CLIENT_URL) {
      if (origin.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        ctx.addIssue({
          code: 'custom',
          path: ['CLIENT_URL'],
          message: `production origin ${origin} must use https`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (result.success) return result.data;

  const problems = result.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');

  throw new Error(
    `Invalid server environment configuration:\n${problems}\n\n` +
      'Copy server/.env.example to server/.env and correct the values above.',
  );
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const isDevelopment = env.NODE_ENV === 'development';

/** Cookies carry the Secure flag in production unless explicitly overridden. */
export const cookieSecure = env.COOKIE_SECURE ?? isProduction;

/** True while the seeded owner still uses the published development password. */
export const usingDevOwnerPassword = env.OWNER_INITIAL_PASSWORD === DEV_OWNER_PASSWORD;
