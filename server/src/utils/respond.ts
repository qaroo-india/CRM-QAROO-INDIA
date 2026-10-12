/**
 * Success responses. Every endpoint answers in the same envelope:
 *   { success: true, data, meta? }      -- see ApiSuccess in @ims/shared
 * Errors use the matching { success: false, error } shape from errorHandler.
 */

import type { ApiMeta, ApiSuccess } from '@ims/shared';
import type { Response } from 'express';

export function ok<T>(res: Response, data: T, meta?: ApiMeta, status = 200): Response {
  const body: ApiSuccess<T> = meta ? { success: true, data, meta } : { success: true, data };
  return res.status(status).json(body);
}

export function created<T>(res: Response, data: T): Response {
  return ok(res, data, undefined, 201);
}

export function noContent(res: Response): Response {
  return res.status(204).end();
}

/** Build pagination metadata from a total row count. */
export function pageMeta(page: number, limit: number, total: number): ApiMeta {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
