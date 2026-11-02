/**
 * GET   /admissions             admissions:read   paginated, filtered
 * GET   /admissions/:id         admissions:read
 * POST  /admissions             admissions:write  Idempotency-Key header honoured
 * PATCH /admissions/:id         admissions:write  counsellor, notes
 * POST  /admissions/:id/status  admissions:write  activate / complete / withdraw
 *                               admissions:cancel cancel
 */

import { admissionListQuerySchema, hasPermission } from '@ims/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/auth';
import { ApiError } from '../../utils/ApiError';
import { contextFrom } from '../../utils/context';
import { created, ok } from '../../utils/respond';
import { paramId, parseQuery } from '../../utils/validate';
import { changeAdmissionStatus, createAdmission, getAdmission, listAdmissions, updateAdmission } from './admissions.service';

export const admissionsRouter = Router();

const idempotencyKey = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{8,100}$/, 'Idempotency-Key must be 8-100 letters, digits, dashes or underscores')
  .optional();

admissionsRouter.get('/', requirePermission('admissions:read'), async (req, res) => {
  ok(res, await listAdmissions(parseQuery(admissionListQuerySchema, req)));
});

admissionsRouter.get('/:id', requirePermission('admissions:read'), async (req, res) => {
  ok(res, await getAdmission(paramId(req)));
});

admissionsRouter.post('/', requirePermission('admissions:write'), async (req, res) => {
  const key = idempotencyKey.parse(req.get('idempotency-key') ?? undefined);
  const result = await createAdmission(contextFrom(req), req.body, key);
  if (result.created) created(res, result.admission);
  else ok(res, result.admission);
});

admissionsRouter.patch('/:id', requirePermission('admissions:write'), async (req, res) => {
  ok(res, await updateAdmission(contextFrom(req), paramId(req), req.body));
});

admissionsRouter.post('/:id/status', requirePermission('admissions:write'), async (req, res) => {
  const ctx = contextFrom(req);
  if (req.body?.action === 'cancel' && !hasPermission(ctx.permissions, 'admissions:cancel')) {
    throw ApiError.forbidden('Cancelling an admission needs the "admissions:cancel" permission.');
  }
  ok(res, await changeAdmissionStatus(ctx, paramId(req), req.body));
});
