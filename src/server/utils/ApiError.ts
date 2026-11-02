/**
 * The one error type services throw on purpose.
 *
 * Anything thrown that is NOT an ApiError is treated as a bug: it is logged in
 * full and the client receives a generic 500, so internal details (SQL, file
 * paths, stack traces) never leak into a browser.
 */

import type { ApiFieldError } from '@ims/shared';

export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: ApiFieldError[],
    /** Structured context for the client (e.g. duplicate candidates). */
    readonly details?: unknown,
  ) {
    super(message);
  }

  static badRequest(message: string, fields?: ApiFieldError[]) {
    return new ApiError(400, 'BAD_REQUEST', message, fields);
  }

  static unauthorized(message = 'Authentication is required') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'You do not have permission to perform this action') {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  static notFound(resource = 'Resource') {
    return new ApiError(404, 'NOT_FOUND', `${resource} not found`);
  }

  static conflict(message: string, code = 'CONFLICT', details?: unknown) {
    return new ApiError(409, code, message, undefined, details);
  }

  static unprocessable(message: string, code = 'UNPROCESSABLE') {
    return new ApiError(422, code, message);
  }

  static validation(fields: ApiFieldError[], message = 'Some fields are invalid') {
    return new ApiError(422, 'VALIDATION_ERROR', message, fields);
  }

  static tooManyRequests(message = 'Too many requests, please try again later') {
    return new ApiError(429, 'RATE_LIMITED', message);
  }
}
