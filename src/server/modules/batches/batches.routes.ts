/**
 * GET  /trainers                       batches:read
 * POST /trainers, PUT /trainers/:id    batches:write
 * GET  /batches                        batches:read
 * GET  /batches/queue                  batches:read     admissions waiting for a batch
 * GET  /batches/:id                    batches:read     roster + history
 * POST /batches, PUT /batches/:id      batches:write
 * POST /batch-assignments              batches:assign   assign one or many
 * POST /batch-assignments/:id/transfer batches:assign
 * GET  /batch-assignments?admissionIds batches:read
 * POST /admissions/:id/batch-status    batches:assign   queue status
 */

import { batchListQuerySchema, queueQuerySchema } from '@ims/shared';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { batches } from '../../db/schema';
import { requirePermission } from '../../middleware/auth';
import { ApiError } from '../../utils/ApiError';
import { contextFrom } from '../../utils/context';
import { assertBatchInScope, batchScope } from '../../utils/scope';
import { created, ok } from '../../utils/respond';
import { paramId, parseQuery } from '../../utils/validate';
import {
  assignmentsForAdmissions,
  assignToBatch,
  batchQueue,
  getBatch,
  listBatches,
  listTrainers,
  saveBatch,
  saveTrainer,
  setQueueStatus,
  transferAssignment,
} from './batches.service';

export const trainersRouter = Router();
trainersRouter.get('/', requirePermission('batches:read'), async (_req, res) => ok(res, await listTrainers()));
trainersRouter.post('/', requirePermission('batches:write'), async (req, res) => created(res, await saveTrainer(contextFrom(req), req.body)));
trainersRouter.put('/:id', requirePermission('batches:write'), async (req, res) => ok(res, await saveTrainer(contextFrom(req), req.body, paramId(req))));

export const batchesRouter = Router();
// Faculty see only the batches they teach; the assignment queue is office work.
const teamOnly: RequestHandler = (req, _res, next) => {
  if (req.auth?.accountType === 'faculty') throw ApiError.forbidden('This list is for the office team.');
  next();
};

batchesRouter.get('/', requirePermission('batches:read'), async (req, res) => ok(res, await listBatches(parseQuery(batchListQuerySchema, req), await batchScope(contextFrom(req), batches.id))));
batchesRouter.get('/queue', requirePermission('batches:read'), teamOnly, async (req, res) => ok(res, await batchQueue(parseQuery(queueQuerySchema, req))));
batchesRouter.get('/:id', requirePermission('batches:read'), async (req, res) => {
  await assertBatchInScope(contextFrom(req), paramId(req));
  ok(res, await getBatch(paramId(req)));
});
batchesRouter.post('/', requirePermission('batches:write'), async (req, res) => created(res, await saveBatch(contextFrom(req), req.body)));
batchesRouter.put('/:id', requirePermission('batches:write'), async (req, res) => ok(res, await saveBatch(contextFrom(req), req.body, paramId(req))));

export const assignmentsRouter = Router();
const idsQuery = z.object({ admissionIds: z.string().trim().max(4000) });
assignmentsRouter.get('/', requirePermission('batches:read'), teamOnly, async (req, res) => {
  const { admissionIds } = parseQuery(idsQuery, req);
  ok(res, await assignmentsForAdmissions(admissionIds.split(',').filter(Boolean).slice(0, 100)));
});
assignmentsRouter.post('/', requirePermission('batches:assign'), async (req, res) => created(res, await assignToBatch(contextFrom(req), req.body)));
assignmentsRouter.post('/:id/transfer', requirePermission('batches:assign'), async (req, res) => {
  ok(res, await transferAssignment(contextFrom(req), paramId(req), req.body, req.body?.allowOverCapacity === true));
});

export const admissionBatchRouter = Router();
admissionBatchRouter.post('/:id/batch-status', requirePermission('batches:assign'), async (req, res) => {
  await setQueueStatus(contextFrom(req), paramId(req), req.body);
  ok(res, { updated: true });
});
