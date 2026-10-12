/**
 * Request validation. Every route parses its input through a shared Zod
 * schema before touching a service; a failure throws ZodError, which the
 * error handler turns into a 422 listing each invalid field.
 */

import { idSchema } from '@ims/shared';
import type { Request } from 'express';
import type { z } from 'zod';

export function parseBody<T extends z.ZodType>(schema: T, req: Request): z.output<T> {
  return schema.parse(req.body ?? {});
}

export function parseQuery<T extends z.ZodType>(schema: T, req: Request): z.output<T> {
  return schema.parse(req.query);
}

/** Route parameter that must be a record id. */
export function paramId(req: Request, name = 'id'): string {
  return idSchema.parse(req.params[name]);
}
