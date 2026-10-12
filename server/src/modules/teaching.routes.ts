/**
 * Staff routes for exams, study material and certificates.
 * Faculty logins are limited to their own batches and courses by the services.
 *
 * Exams        exams:read / exams:write
 *   GET  /exams                       list + stats
 *   GET  /exams/:id                   with questions and correct answers
 *   POST /exams, PUT /exams/:id
 *   POST /exams/:id/status            draft | published | closed | archived
 *   POST /exams/:id/questions         PUT/DELETE /exams/questions/:questionId   (drafts only)
 *   GET  /exams/:id/results
 *
 * Material     materials:read / materials:write
 *   GET  /materials, POST /materials (multipart: optional "file" + fields), PUT /materials/:id, DELETE /materials/:id
 *   GET  /materials/:id/open          file download, or { url } for a link   (each open is logged)
 *   GET  /materials/:id/opens         who opened it
 *
 * Certificates certificates:read / certificates:issue
 *   GET  /certificates, POST /certificates (on behalf of a student), POST /certificates/:id/decision
 *   GET  /certificates/:id/file
 *
 * Public
 *   GET  /verify/certificates/:reference
 */

import { certificateListQuerySchema, examListQuerySchema, materialListQuerySchema } from '@ims/shared';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { env } from '../config/env';
import { requirePermission } from '../middleware/auth';
import { ApiError } from '../utils/ApiError';
import { contextFrom } from '../utils/context';
import { created, ok } from '../utils/respond';
import { sendDownload } from '../utils/sendFile';
import { paramId, parseQuery } from '../utils/validate';
import { certificateFile, decideCertificate, listCertificates, requestCertificate, verifyCertificate } from './certificates/certificates.service';
import { addQuestion, createExam, examResults, getExam, listExams, removeQuestion, setExamStatus, updateExam, updateQuestion } from './exams/exams.service';
import { createMaterial, deleteMaterial, listMaterials, materialOpens, openMaterial, updateMaterial } from './materials/materials.service';

/* Exams ---------------------------------------------------------------- */

export const examsRouter = Router();

examsRouter.get('/', requirePermission('exams:read'), (req, res) => {
  ok(res, listExams(contextFrom(req), parseQuery(examListQuerySchema, req)));
});
examsRouter.post('/', requirePermission('exams:write'), (req, res) => {
  created(res, createExam(contextFrom(req), req.body));
});
examsRouter.put('/questions/:questionId', requirePermission('exams:write'), (req, res) => {
  ok(res, updateQuestion(contextFrom(req), paramId(req, 'questionId'), req.body));
});
examsRouter.delete('/questions/:questionId', requirePermission('exams:write'), (req, res) => {
  ok(res, removeQuestion(contextFrom(req), paramId(req, 'questionId')));
});
examsRouter.get('/:id', requirePermission('exams:read'), (req, res) => {
  ok(res, getExam(contextFrom(req), paramId(req)));
});
examsRouter.put('/:id', requirePermission('exams:write'), (req, res) => {
  ok(res, updateExam(contextFrom(req), paramId(req), req.body));
});
examsRouter.post('/:id/status', requirePermission('exams:write'), (req, res) => {
  ok(res, setExamStatus(contextFrom(req), paramId(req), req.body));
});
examsRouter.post('/:id/questions', requirePermission('exams:write'), (req, res) => {
  created(res, addQuestion(contextFrom(req), paramId(req), req.body));
});
examsRouter.get('/:id/results', requirePermission('exams:read'), (req, res) => {
  ok(res, examResults(contextFrom(req), paramId(req)));
});

/* Material ------------------------------------------------------------- */

const uploadMaterial = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.max(env.MAX_UPLOAD_MB, 25) * 1024 * 1024, files: 1, fields: 12, fieldSize: 10_000 },
}).single('file');

export const materialsRouter = Router();

materialsRouter.get('/', requirePermission('materials:read'), (req, res) => {
  ok(res, listMaterials(contextFrom(req), parseQuery(materialListQuerySchema, req)));
});
materialsRouter.post('/', requirePermission('materials:write'), uploadMaterial, (req, res) => {
  created(res, createMaterial(contextFrom(req), req.file, req.body));
});
materialsRouter.put('/:id', requirePermission('materials:write'), (req, res) => {
  ok(res, updateMaterial(contextFrom(req), paramId(req), req.body));
});
materialsRouter.delete('/:id', requirePermission('materials:write'), (req, res) => {
  deleteMaterial(contextFrom(req), paramId(req));
  ok(res, { deleted: true });
});
materialsRouter.get('/:id/open', requirePermission('materials:read'), (req, res) => {
  const opened = openMaterial(contextFrom(req), paramId(req), null);
  if (opened.file) sendDownload(res, opened.file);
  else ok(res, { url: opened.url });
});
materialsRouter.get('/:id/opens', requirePermission('materials:read'), (req, res) => {
  ok(res, materialOpens(contextFrom(req), paramId(req)));
});

/* Certificates --------------------------------------------------------- */

export const certificatesRouter = Router();

certificatesRouter.get('/', requirePermission('certificates:read'), (req, res) => {
  ok(res, listCertificates(parseQuery(certificateListQuerySchema, req)));
});
certificatesRouter.post('/', requirePermission('certificates:issue'), (req, res) => {
  created(res, requestCertificate(contextFrom(req), req.body, null));
});
certificatesRouter.post('/:id/decision', requirePermission('certificates:issue'), async (req, res) => {
  ok(res, await decideCertificate(contextFrom(req), paramId(req), req.body));
});
certificatesRouter.get('/:id/file', requirePermission('certificates:read'), (req, res) => {
  sendDownload(res, certificateFile(paramId(req), null), 'inline');
});

/* Public verification ---------------------------------------------------- */

export const verifyRouter = Router();

const verifyLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new ApiError(429, 'RATE_LIMITED', 'Too many checks. Please wait a few minutes.')),
});

verifyRouter.get('/certificates/:reference', verifyLimiter, (req, res) => {
  const reference = String(req.params.reference ?? '');
  if (!/^[A-Za-z0-9-]{4,40}$/.test(reference)) throw ApiError.badRequest('That is not a certificate reference');
  res.setHeader('Cache-Control', 'no-store');
  ok(res, verifyCertificate(reference));
});
