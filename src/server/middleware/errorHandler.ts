/**
 * Centralised error translation.
 *
 * Express 5 forwards rejected promises from async handlers here automatically,
 * so controllers simply throw -- no try/catch boilerplate in every route.
 *
 * Expected failures (ApiError, validation, constraint violations) become
 * precise 4xx responses. Anything else is a bug: it is logged with its stack
 * and the request id, and the client gets a generic message plus that request
 * id to quote when reporting the problem.
 */

import { DateError, type ApiFailure, type ApiFieldError } from '@ims/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { isProduction } from '../config/env';
import { ApiError } from '../utils/ApiError';

interface SqliteLikeError {
  code: string;
  extendedCode?: string;
  message: string;
}

/** Drizzle may wrap the driver error; walk the cause chain to find it. */
function findSqliteError(error: unknown): SqliteLikeError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (
      typeof current === 'object' &&
      current !== null &&
      'code' in current &&
      typeof (current as { code: unknown }).code === 'string' &&
      (current as { code: string }).code.startsWith('SQLITE_')
    ) {
      return current as SqliteLikeError;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

const CONSTRAINT_KINDS: [RegExp, string][] = [
  [/UNIQUE constraint failed/i, 'SQLITE_CONSTRAINT_UNIQUE'],
  [/FOREIGN KEY constraint failed/i, 'SQLITE_CONSTRAINT_FOREIGNKEY'],
  [/CHECK constraint failed/i, 'SQLITE_CONSTRAINT_CHECK'],
  [/NOT NULL constraint failed/i, 'SQLITE_CONSTRAINT_NOTNULL'],
];

/**
 * The precise SQLite code. A local libSQL database reports it as
 * `extendedCode`; a hosted (Turso) one only sends the base SQLITE_CONSTRAINT,
 * so the kind of constraint is read from SQLite's standard message.
 */
function sqliteCode(error: SqliteLikeError): string {
  if (error.extendedCode?.startsWith('SQLITE_')) return error.extendedCode;
  if (error.code === 'SQLITE_CONSTRAINT') {
    for (const [pattern, code] of CONSTRAINT_KINDS) if (pattern.test(error.message)) return code;
  }
  return error.code;
}

function zodFields(error: ZodError): ApiFieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || '(root)',
    message: issue.message,
  }));
}

/** Map an error to an ApiError, or null if it is unexpected. Exported for tests. */
export function toApiError(error: unknown): ApiError | null {
  if (error instanceof ApiError) return error;

  if (error instanceof ZodError) {
    return ApiError.validation(zodFields(error));
  }

  // Upload limits and malformed multipart bodies (multer).
  if (typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'MulterError') {
    const code = (error as { code?: string }).code;
    if (code === 'LIMIT_FILE_SIZE') return new ApiError(413, 'FILE_TOO_LARGE', 'The file is larger than the upload limit');
    return ApiError.badRequest(code === 'LIMIT_UNEXPECTED_FILE' ? 'Upload one file in the "file" field' : 'The upload could not be read');
  }

  // An impossible or reversed date range in a report or filter.
  if (error instanceof DateError) {
    return ApiError.unprocessable(error.message, 'INVALID_DATE_RANGE');
  }

  // Errors raised by Express's own body parser carry a `type` and `status`.
  if (typeof error === 'object' && error !== null && 'type' in error) {
    const type = (error as { type: unknown }).type;
    if (type === 'entity.parse.failed') {
      return ApiError.badRequest('Request body is not valid JSON');
    }
    if (type === 'entity.too.large') {
      return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    }
  }

  const sqliteError = findSqliteError(error);
  if (sqliteError) {
    switch (sqliteCode(sqliteError)) {
      case 'SQLITE_CONSTRAINT_UNIQUE':
      case 'SQLITE_CONSTRAINT_PRIMARYKEY':
        return ApiError.conflict('A record with the same unique value already exists');
      case 'SQLITE_CONSTRAINT_FOREIGNKEY':
        return ApiError.conflict(
          'This change refers to a record that does not exist, or would orphan related records',
        );
      case 'SQLITE_CONSTRAINT_CHECK':
      case 'SQLITE_CONSTRAINT_NOTNULL':
        return new ApiError(
          422,
          'CONSTRAINT_VIOLATION',
          'The data breaks a database rule and was not saved',
        );
      default:
        // SQLITE_BUSY and its extended forms (SQLITE_BUSY_SNAPSHOT, ...).
        if (sqliteError.code === 'SQLITE_BUSY') {
          return new ApiError(503, 'DATABASE_BUSY', 'The database is busy, please retry');
        }
        return null;
    }
  }

  return null;
}

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  // A response is already streaming (e.g. a large export failed mid-way).
  // Hand off to Express's default handler, which aborts the connection.
  if (res.headersSent) {
    next(error);
    return;
  }

  const requestId = typeof req.id === 'string' ? req.id : undefined;
  const apiError = toApiError(error);

  if (apiError) {
    // Expected 4xx: log quietly for traceability without alarming anyone.
    req.log?.warn({ code: apiError.code, status: apiError.status }, apiError.message);
  } else {
    req.log?.error({ err: error }, 'Unhandled error while processing request');
  }

  const status = apiError?.status ?? 500;
  const body: ApiFailure = {
    success: false,
    error: {
      code: apiError?.code ?? 'INTERNAL_ERROR',
      message:
        apiError?.message ??
        (isProduction
          ? 'Something went wrong. Please try again or contact support.'
          : `Unhandled error: ${error instanceof Error ? error.message : String(error)}`),
      ...(apiError?.fields && { fields: apiError.fields }),
      ...(apiError?.details !== undefined && { details: apiError.details }),
      ...(requestId && { requestId }),
    },
  };

  res.status(status).json(body);
};

/** Terminal handler for unmatched routes. Registered after every router. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new ApiError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`));
};
