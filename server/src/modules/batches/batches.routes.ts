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
trainersRouter.get('/', requirePermission('batches:read'), (_req, res) => ok(res, listTrainers()));
trainersRouter.post('/', requirePermission('batches:write'), (req, res) => created(res, saveTrainer(contextFrom(req), req.body)));
trainersRouter.put('/:id', requirePermission('batches:write'), (req, res) => ok(res, saveTrainer(contextFrom(req), req.body, paramId(req))));

export const batchesRouter = Router();
// Faculty see only the batches they teach; the assignment queue is office work.
const teamOnly: RequestHandler = (req, _res, next) => {
  if (req.auth?.accountType === 'faculty') throw ApiError.forbidden('This list is for the office team.');
  next();
};

batchesRouter.get('/', requirePermission('batches:read'), (req, res) => ok(res, listBatches(parseQuery(batchListQuerySchema, req), batchScope(contextFrom(req), batches.id))));
batchesRouter.get('/queue', requirePermission('batches:read'), teamOnly, (req, res) => ok(res, batchQueue(parseQuery(queueQuerySchema, req))));
batchesRouter.get('/:id', requirePermission('batches:read'), (req, res) => {
  assertBatchInScope(contextFrom(req), paramId(req));
  ok(res, getBatch(paramId(req)));
});
batchesRouter.post('/', requirePermission('batches:write'), (req, res) => created(res, saveBatch(contextFrom(req), req.body)));
batchesRouter.put('/:id', requirePermission('batches:write'), (req, res) => ok(res, saveBatch(contextFrom(req), req.body, paramId(req))));

export const assignmentsRouter = Router();
const idsQuery = z.object({ admissionIds: z.string().trim().max(4000) });
assignmentsRouter.get('/', requirePermission('batches:read'), teamOnly, (req, res) => {
  const { admissionIds } = parseQuery(idsQuery, req);
  ok(res, assignmentsForAdmissions(admissionIds.split(',').filter(Boolean).slice(0, 100)));
});
assignmentsRouter.post('/', requirePermission('batches:assign'), (req, res) => created(res, assignToBatch(contextFrom(req), req.body)));
assignmentsRouter.post('/:id/transfer', requirePermission('batches:assign'), (req, res) => {
  ok(res, transferAssignment(contextFrom(req), paramId(req), req.body, req.body?.allowOverCapacity === true));
});

export const admissionBatchRouter = Router();
admissionBatchRouter.post('/:id/batch-status', requirePermission('batches:assign'), (req, res) => {
  setQueueStatus(contextFrom(req), paramId(req), req.body);
  ok(res, { updated: true });
});
