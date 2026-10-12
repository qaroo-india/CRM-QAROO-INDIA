/**
 * Student portal (student logins only; the student comes from the session).
 *
 * GET  /portal/overview
 * GET  /portal/fees                       admissions, instalments, receipts
 * GET  /portal/receipts/:id               own receipt PDF only
 * GET  /portal/attendance
 * GET  /portal/classes?from&to
 * GET  /portal/exams                      POST /portal/exams/:id/start
 * GET  /portal/attempts/:id               the paper (no answers)
 * PUT  /portal/attempts/:id/answers       { questionId, optionId }
 * POST /portal/attempts/:id/submit        graded on the server
 * GET  /portal/attempts/:id/result        GET /portal/results
 * GET  /portal/materials                  GET /portal/materials/:id/open
 * GET  /portal/certificates               POST /portal/certificates   GET /portal/certificates/:id/file
 * GET  /portal/placements                 POST /portal/drives/:id/apply
 */

import { addDays, certificateListQuerySchema, dateOnlySchema } from '@ims/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAccount } from '../../middleware/auth';
import { renderReceiptPdf } from '../../pdf/receipt';
import { instituteToday } from '../../services/clock';
import { getSettings } from '../../services/settings';
import { contextFrom } from '../../utils/context';
import { created, ok } from '../../utils/respond';
import { sendDownload } from '../../utils/sendFile';
import { paramId, parseQuery } from '../../utils/validate';
import { certificateFile, listCertificates, requestCertificate } from '../certificates/certificates.service';
import { attemptResult, getPaper, myResults, portalExams, saveAnswer, startAttempt, submitAttempt } from '../exams/exams.service';
import { getReceipt } from '../finance/payments.service';
import { openMaterial, portalMaterials } from '../materials/materials.service';
import { applyAsStudent } from '../placements/drives.service';
import { assertOwnPayment, attendance, fees, myClasses, overview, placement } from './portal.service';

export const portalRouter = Router();
portalRouter.use(requireAccount('student'));

const me = (req: Request) => req.auth!.studentId!;

portalRouter.get('/overview', (req, res) => ok(res, overview(contextFrom(req), me(req))));
portalRouter.get('/fees', (req, res) => ok(res, fees(me(req))));

portalRouter.get('/receipts/:id', async (req, res) => {
  const id = paramId(req);
  assertOwnPayment(me(req), id);
  const receipt = getReceipt(id);
  const pdf = await renderReceiptPdf(receipt, new Date(), getSettings().timezone);
  sendDownload(res, { buffer: pdf, fileName: `${receipt.payment.receiptNumber}.pdf`, mimeType: 'application/pdf' }, 'inline');
});

portalRouter.get('/attendance', (req, res) => ok(res, attendance(me(req))));

const classesQuery = z.object({ from: dateOnlySchema.optional(), to: dateOnlySchema.optional() });
portalRouter.get('/classes', (req, res) => {
  const q = parseQuery(classesQuery, req);
  const today = instituteToday();
  ok(res, myClasses(contextFrom(req), me(req), q.from ?? addDays(today, -7), q.to ?? addDays(today, 30)));
});

portalRouter.get('/exams', (req, res) => ok(res, portalExams(me(req))));
portalRouter.post('/exams/:id/start', (req, res) => created(res, startAttempt(me(req), paramId(req))));
portalRouter.get('/attempts/:id', (req, res) => ok(res, getPaper(me(req), paramId(req))));
portalRouter.put('/attempts/:id/answers', (req, res) => ok(res, saveAnswer(me(req), paramId(req), req.body)));
portalRouter.post('/attempts/:id/submit', (req, res) => ok(res, submitAttempt(me(req), paramId(req))));
portalRouter.get('/attempts/:id/result', (req, res) => ok(res, attemptResult(me(req), paramId(req))));
portalRouter.get('/results', (req, res) => ok(res, myResults(me(req))));

portalRouter.get('/materials', (req, res) => ok(res, portalMaterials(me(req))));
portalRouter.get('/materials/:id/open', (req, res) => {
  const opened = openMaterial(contextFrom(req), paramId(req), me(req));
  if (opened.file) sendDownload(res, opened.file);
  else ok(res, { url: opened.url });
});

portalRouter.get('/certificates', (req, res) => ok(res, listCertificates(certificateListQuerySchema.parse({ limit: 100 }), me(req)).items));
portalRouter.post('/certificates', (req, res) => created(res, requestCertificate(contextFrom(req), req.body, me(req))));
portalRouter.get('/certificates/:id/file', (req, res) => sendDownload(res, certificateFile(paramId(req), me(req)), 'inline'));

portalRouter.get('/placements', (req, res) => ok(res, placement(me(req))));
portalRouter.post('/drives/:id/apply', (req, res) => created(res, applyAsStudent(contextFrom(req), me(req), paramId(req))));
