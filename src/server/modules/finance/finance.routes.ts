/**
 * Money routes.
 *
 * Admission-scoped (mounted under /admissions):
 *   GET  /:id/finance                  payments:read | feePlans:read
 *   POST /:id/fee-plan                 feePlans:write
 *   POST /:id/fee-plan/restructure     feePlans:write
 *   POST /:id/adjustments              discounts:approve
 *   POST /:id/refunds                  payments:refund
 *
 * Top level:
 *   GET  /payments                     payments:read     list + totals
 *   GET  /payments/:id                 payments:read
 *   GET  /payments/:id/receipt         payments:read     JSON for the preview
 *   GET  /payments/:id/receipt.pdf     payments:read
 *   POST /payments                     payments:write    Idempotency-Key honoured
 *   POST /payments/:id/reverse         payments:reverse
 *   POST /adjustments/:id/void         discounts:approve
 *   GET  /instalments                  feePlans:read
 *   GET  /loans, /loans/summary, /loans/:id                loans:read
 *   POST /loans, PUT /loans/:id, POST /loans/:id/status    loans:write
 *        (approve/reject additionally need loans:approve)
 *   POST /loans/:id/disbursements, .../:did/received        loans:disburse
 */

import { dateOnlySchema, instalmentListQuerySchema, loanListQuerySchema, paymentListQuerySchema, type AdmissionFinanceView } from '@ims/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requireAnyPermission, requirePermission } from '../../middleware/auth';
import { renderReceiptPdf } from '../../pdf/receipt';
import { getSettings } from '../../services/settings';
import { contextFrom } from '../../utils/context';
import { created, ok } from '../../utils/respond';
import { paramId, parseBody, parseQuery } from '../../utils/validate';
import { getAdmission } from '../admissions/admissions.service';
import { addAdjustment, adjustmentsForAdmission, voidAdjustment } from './adjustments.service';
import { createFeePlan, plansForAdmission, restructureFeePlan } from './feePlans.service';
import { listInstalments } from './instalments.service';
import { changeLoanStatus, createLoan, getLoan, listLoans, loanSummary, loansForAdmission, markDisbursementReceived, recordDisbursement, updateLoan } from './loans.service';
import { getPayment, getReceipt, listPayments, paymentsForAdmission, recordPayment, refundPayment, reversePayment } from './payments.service';

const idempotencyKey = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{8,100}$/, 'Idempotency-Key must be 8-100 letters, digits, dashes or underscores')
  .optional();

/* ------------------------------------------------------------------ *
 * Admission-scoped
 * ------------------------------------------------------------------ */

export const admissionFinanceRouter = Router();

admissionFinanceRouter.get('/:id/finance', requireAnyPermission('payments:read', 'feePlans:read'), async (req, res) => {
  const id = paramId(req);
  const plans = await plansForAdmission(id);
  const view: AdmissionFinanceView = {
    admission: await getAdmission(id),
    activePlan: plans.active,
    previousPlans: plans.previous,
    payments: await paymentsForAdmission(id),
    adjustments: await adjustmentsForAdmission(id),
    loans: await loansForAdmission(id),
  };
  ok(res, view);
});

admissionFinanceRouter.post('/:id/fee-plan', requirePermission('feePlans:write'), async (req, res) => {
  created(res, await createFeePlan(contextFrom(req), paramId(req), req.body));
});

admissionFinanceRouter.post('/:id/fee-plan/restructure', requirePermission('feePlans:write'), async (req, res) => {
  ok(res, await restructureFeePlan(contextFrom(req), paramId(req), req.body));
});

admissionFinanceRouter.post('/:id/adjustments', requirePermission('discounts:approve'), async (req, res) => {
  created(res, await addAdjustment(contextFrom(req), paramId(req), req.body));
});

admissionFinanceRouter.post('/:id/refunds', requirePermission('payments:refund'), async (req, res) => {
  created(res, await refundPayment(contextFrom(req), paramId(req), req.body));
});

/* ------------------------------------------------------------------ *
 * Payments
 * ------------------------------------------------------------------ */

export const paymentsRouter = Router();

paymentsRouter.get('/', requirePermission('payments:read'), async (req, res) => {
  ok(res, await listPayments(parseQuery(paymentListQuerySchema, req)));
});

paymentsRouter.get('/:id', requirePermission('payments:read'), async (req, res) => {
  ok(res, await getPayment(paramId(req)));
});

paymentsRouter.get('/:id/receipt', requirePermission('payments:read'), async (req, res) => {
  ok(res, await getReceipt(paramId(req)));
});

paymentsRouter.get('/:id/receipt.pdf', requirePermission('payments:read'), async (req, res) => {
  const receipt = await getReceipt(paramId(req));
  const pdf = await renderReceiptPdf(receipt, new Date(), getSettings().timezone);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${receipt.payment.receiptNumber}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(pdf);
});

paymentsRouter.post('/', requirePermission('payments:write'), async (req, res) => {
  const key = idempotencyKey.parse(req.get('idempotency-key') ?? undefined);
  const result = await recordPayment(contextFrom(req), req.body, key);
  if (result.created) created(res, result.payment);
  else ok(res, result.payment);
});

paymentsRouter.post('/:id/reverse', requirePermission('payments:reverse'), async (req, res) => {
  ok(res, await reversePayment(contextFrom(req), paramId(req), req.body));
});

/* ------------------------------------------------------------------ *
 * Adjustments, instalments, loans
 * ------------------------------------------------------------------ */

export const adjustmentsRouter = Router();
adjustmentsRouter.post('/:id/void', requirePermission('discounts:approve'), async (req, res) => {
  ok(res, await voidAdjustment(contextFrom(req), paramId(req), req.body));
});

export const instalmentsRouter = Router();
instalmentsRouter.get('/', requirePermission('feePlans:read'), async (req, res) => {
  ok(res, await listInstalments(parseQuery(instalmentListQuerySchema, req)));
});

export const loansRouter = Router();

loansRouter.get('/', requirePermission('loans:read'), async (req, res) => {
  ok(res, await listLoans(parseQuery(loanListQuerySchema, req)));
});

loansRouter.get('/summary', requirePermission('loans:read'), async (_req, res) => {
  ok(res, await loanSummary());
});

loansRouter.get('/:id', requirePermission('loans:read'), async (req, res) => {
  ok(res, await getLoan(paramId(req)));
});

loansRouter.post('/', requirePermission('loans:write'), async (req, res) => {
  created(res, await createLoan(contextFrom(req), req.body));
});

loansRouter.put('/:id', requirePermission('loans:write'), async (req, res) => {
  ok(res, await updateLoan(contextFrom(req), paramId(req), req.body));
});

loansRouter.post('/:id/status', requirePermission('loans:write'), async (req, res) => {
  ok(res, await changeLoanStatus(contextFrom(req), paramId(req), req.body));
});

loansRouter.post('/:id/disbursements', requirePermission('loans:disburse'), async (req, res) => {
  created(res, await recordDisbursement(contextFrom(req), paramId(req), req.body));
});

loansRouter.post('/:id/disbursements/:did/received', requirePermission('loans:disburse'), async (req, res) => {
  const { receivedOn } = parseBody(z.object({ receivedOn: dateOnlySchema }), req);
  ok(res, await markDisbursementReceived(contextFrom(req), paramId(req), paramId(req, 'did'), receivedOn));
});
