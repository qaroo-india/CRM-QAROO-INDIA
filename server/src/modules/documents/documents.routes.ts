/**
 * GET  /documents                       documents:read   (restricted ones need documents:restricted)
 * GET  /documents/student/:studentId    documents:read   a student's documents across their records
 * GET  /documents/:id                   documents:read
 * GET  /documents/:id/download          documents:read
 * POST /documents                       documents:write  multipart: file + ownerType, ownerId, kind, title, accessLevel
 * POST /documents/:id/delete            documents:write  soft delete with a reason
 */

import { documentListQuerySchema } from '@ims/shared';
import { Router } from 'express';
import multer from 'multer';
import { env } from '../../config/env';
import { requirePermission } from '../../middleware/auth';
import { contextFrom } from '../../utils/context';
import { created, ok } from '../../utils/respond';
import { sendDownload } from '../../utils/sendFile';
import { paramId, parseQuery } from '../../utils/validate';
import { deleteDocument, downloadDocument, getDocument, listDocuments, studentDocuments, uploadDocument } from './documents.service';

/** Files are held in memory only long enough to validate and store them. */
export const uploadSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 12, fieldSize: 10_000 },
}).single('file');

export const documentsRouter = Router();

documentsRouter.get('/', requirePermission('documents:read'), async (req, res) => {
  ok(res, await listDocuments(contextFrom(req), parseQuery(documentListQuerySchema, req)));
});

documentsRouter.get('/student/:studentId', requirePermission('documents:read'), async (req, res) => {
  ok(res, await studentDocuments(contextFrom(req), paramId(req, 'studentId')));
});

documentsRouter.get('/:id', requirePermission('documents:read'), async (req, res) => {
  ok(res, await getDocument(contextFrom(req), paramId(req)));
});

documentsRouter.get('/:id/download', requirePermission('documents:read'), async (req, res) => {
  sendDownload(res, await downloadDocument(contextFrom(req), paramId(req)));
});

documentsRouter.post('/', requirePermission('documents:write'), uploadSingle, async (req, res) => {
  created(res, await uploadDocument(contextFrom(req), req.file, req.body));
});

documentsRouter.post('/:id/delete', requirePermission('documents:write'), async (req, res) => {
  await deleteDocument(contextFrom(req), paramId(req), req.body);
  ok(res, { deleted: true });
});
