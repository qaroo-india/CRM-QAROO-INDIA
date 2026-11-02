/**
 * Reusable Zod primitives.
 *
 * These are imported by BOTH sides: the server validates every request with
 * them, and the client drives React Hook Form from the same objects. One
 * definition means a form can never disagree with the endpoint it posts to.
 */

import { z } from 'zod';
import { BASIS_POINTS_PER_WHOLE, MAX_MONEY_MINOR, toMinor } from '../money';

/** A UUID primary key. */
export const idSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'must be a valid record id',
  );

export const nonEmptyString = (max = 200, label = 'value') =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} must be at most ${max} characters`);

export const optionalString = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('must be a valid email address'));

/**
 * Phone numbers are stored as entered but validated loosely: 7-15 digits with
 * an optional country prefix. Over-strict validation rejects real numbers, and
 * duplicate detection normalises separately.
 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[\d\s-]{7,20}$/, 'must be a valid phone number')
  .transform((v) => v.replace(/[\s-]/g, ''));

/** Digits only, for duplicate-lead matching across differently formatted entries. */
export function normalisePhone(value: string): string {
  return value.replace(/\D/g, '').slice(-10);
}

/* ------------------------------------------------------------------ *
 * Money
 * ------------------------------------------------------------------ */

/** An amount already in minor units -- what the API transports and the DB stores. */
export const moneyMinorSchema = z
  .number()
  .int('amount must be a whole number of paise')
  .min(0, 'amount cannot be negative')
  .max(MAX_MONEY_MINOR, 'amount is too large');

/** Signed variant, for reversal and adjustment rows. */
export const signedMoneyMinorSchema = z
  .number()
  .int()
  .min(-MAX_MONEY_MINOR)
  .max(MAX_MONEY_MINOR);

/**
 * Accepts what a human typed ("1,25,000.50" or 125000.5) and converts it to
 * minor units, surfacing the money parser's own message on failure. Use this
 * at form and import boundaries only -- internal APIs take minor units.
 */
export const moneyInputSchema = z.union([z.string(), z.number()]).transform((value, ctx) => {
  try {
    return toMinor(value);
  } catch (error) {
    ctx.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'invalid amount',
    });
    return z.NEVER;
  }
});

/** Form/import field: human amount in, non-negative paise out. */
export const moneyFieldSchema = moneyInputSchema.pipe(moneyMinorSchema);

/** Form/import field for an amount that must be above zero (receipts, expenses). */
export const positiveMoneyFieldSchema = moneyInputSchema.pipe(
  moneyMinorSchema.refine((value) => value > 0, 'amount must be greater than zero'),
);

/** Optional money field: an empty input means "not set". */
export const optionalMoneyFieldSchema = z
  .union([z.literal(''), z.null(), z.undefined(), z.string(), z.number()])
  .optional()
  .transform((value, ctx) => {
    if (value === '' || value === null || value === undefined) return undefined;
    try {
      const minor = toMinor(value);
      if (minor < 0) throw new Error('amount cannot be negative');
      return minor;
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'invalid amount' });
      return z.NEVER;
    }
  });

/** Basis points: 1250 = 12.50%, 10000 = 100%. Keeps fractional percentages exact. */
export const basisPointsSchema = z
  .number()
  .int('percentage must be given in basis points')
  .min(0)
  .max(BASIS_POINTS_PER_WHOLE, 'percentage cannot exceed 100%');

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

/**
 * Calendar day as YYYY-MM-DD. Business dates (admission date, receipt date,
 * due date) are stored as plain days, never as instants, so a report boundary
 * cannot shift because the server and the institute are in different zones.
 */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD format')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, 'must be a real calendar date');

/** An exact instant, for audit and system timestamps. */
export const timestampSchema = z.string().pipe(z.iso.datetime({ offset: true }));

/**
 * Inclusive reporting window. Both ends are calendar days and `from` may equal
 * `to` (a single-day report), which is why the comparison is <= not <.
 */
export const dateRangeSchema = z
  .object({
    from: dateOnlySchema,
    to: dateOnlySchema,
  })
  .refine((range) => range.from <= range.to, {
    message: 'the start date must not be after the end date',
    path: ['from'],
  });


/* ------------------------------------------------------------------ *
 * Collection queries
 * ------------------------------------------------------------------ */

export const SORT_ORDERS = ['asc', 'desc'] as const;

/**
 * Pagination is page-based with a hard ceiling, so no caller can request
 * 100,000 rows and stall the event loop. Query strings arrive as text, hence
 * the coercion.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.string().trim().max(50).optional(),
  order: z.enum(SORT_ORDERS).default('desc'),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;

export const searchSchema = z.object({
  q: z.string().trim().max(200).optional(),
});

/** Comma-separated query values (`?status=active,completed`) into an array. */
export function csvEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      return value
        .split(',')
        .map((v) => v.trim())
        .filter((v): v is T[number] => (values as readonly string[]).includes(v));
    });
}

/* ------------------------------------------------------------------ *
 * Response envelope
 * ------------------------------------------------------------------ */

export interface ApiMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: ApiMeta;
}

export interface ApiFieldError {
  path: string;
  message: string;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    fields?: ApiFieldError[];
    /** Structured context, e.g. the duplicate records behind a 409. */
    details?: unknown;
    requestId?: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
