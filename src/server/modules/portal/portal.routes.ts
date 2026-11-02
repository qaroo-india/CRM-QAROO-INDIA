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

portalRouter.get('/overview', async (req, res) => ok(res, await overview(contextFrom(req), me(req))));
portalRouter.get('/fees', async (req, res) => ok(res, await fees(me(req))));

portalRouter.get('/receipts/:id', async (req, res) => {
  const id = paramId(req);
  await assertOwnPayment(me(req), id);
  const receipt = await getReceipt(id);
  const pdf = await renderReceiptPdf(receipt, new Date(), getSettings().timezone);
  sendDownload(res, { buffer: pdf, fileName: `${receipt.payment.receiptNumber}.pdf`, mimeType: 'application/pdf' }, 'inline');
});

portalRouter.get('/attendance', async (req, res) => ok(res, await attendance(me(req))));

const classesQuery = z.object({ from: dateOnlySchema.optional(), to: dateOnlySchema.optional() });
portalRouter.get('/classes', async (req, res) => {
  const q = parseQuery(classesQuery, req);
  const today = instituteToday();
  ok(res, await myClasses(contextFrom(req), me(req), q.from ?? addDays(today, -7), q.to ?? addDays(today, 30)));
});

portalRouter.get('/exams', async (req, res) => ok(res, await portalExams(me(req))));
portalRouter.post('/exams/:id/start', async (req, res) => created(res, await startAttempt(me(req), paramId(req))));
portalRouter.get('/attempts/:id', async (req, res) => ok(res, await getPaper(me(req), paramId(req))));
portalRouter.put('/attempts/:id/answers', async (req, res) => ok(res, await saveAnswer(me(req), paramId(req), req.body)));
portalRouter.post('/attempts/:id/submit', async (req, res) => ok(res, await submitAttempt(me(req), paramId(req))));
portalRouter.get('/attempts/:id/result', async (req, res) => ok(res, await attemptResult(me(req), paramId(req))));
portalRouter.get('/results', async (req, res) => ok(res, await myResults(me(req))));

portalRouter.get('/materials', async (req, res) => ok(res, await portalMaterials(me(req))));
portalRouter.get('/materials/:id/open', async (req, res) => {
  const opened = await openMaterial(contextFrom(req), paramId(req), me(req));
  if (opened.file) sendDownload(res, opened.file);
  else ok(res, { url: opened.url });
});

portalRouter.get('/certificates', async (req, res) => ok(res, (await listCertificates(certificateListQuerySchema.parse({ limit: 100 }), me(req))).items));
portalRouter.post('/certificates', async (req, res) => created(res, await requestCertificate(contextFrom(req), req.body, me(req))));
portalRouter.get('/certificates/:id/file', async (req, res) => sendDownload(res, await certificateFile(paramId(req), me(req)), 'inline'));

portalRouter.get('/placements', async (req, res) => ok(res, await placement(me(req))));
portalRouter.post('/drives/:id/apply', async (req, res) => created(res, await applyAsStudent(contextFrom(req), me(req), paramId(req))));
