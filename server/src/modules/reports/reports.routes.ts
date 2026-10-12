/**
 * GET    /reports/dashboard?period&from&to&courseId&leadSourceId&counsellorId   reports:read
 * GET    /reports/summary?type&reference&from&to&...                          reports:read
 * GET    /reports/export?format=pdf|excel&...    reports:export    file download (recorded as a job)
 * POST   /reports/email                          reports:email     generate + send; failures are recorded
 * GET    /reports/email-status                   reports:read      is email really delivered?
 * GET    /reports/jobs                           reports:export | reports:email
 * GET    /reports/jobs/:id/download              reports:export
 * POST   /reports/deliveries/:id/retry           reports:email
 * GET    /reports/schedules, POST                reports:email
 * PUT    /reports/schedules/:id, DELETE          reports:email
 * POST   /reports/schedules/:id/run              reports:email     send the previous period now
 *
 * Money sections are included only for reports:financial; without it they
 * come back null (decided here on the server, never by hiding UI).
 */

import { hasPermission, paginationSchema, reportQuerySchema } from '@ims/shared';
import { Router } from 'express';
import { requireAnyPermission, requirePermission } from '../../middleware/auth';
import { contextFrom } from '../../utils/context';
import { created, ok } from '../../utils/respond';
import { sendDownload } from '../../utils/sendFile';
import { paramId, parseQuery } from '../../utils/validate';
import {
  createSchedule,
  deleteSchedule,
  emailReport,
  emailStatus,
  exportReport,
  getJob,
  jobFile,
  listJobs,
  listSchedules,
  retryDelivery,
  runSchedule,
  updateSchedule,
} from './delivery.service';
import { buildDashboard, buildReport } from './reports.service';

export const reportsRouter = Router();

reportsRouter.get('/dashboard', requirePermission('reports:read'), (req, res) => {
  const ctx = contextFrom(req);
  ok(res, buildDashboard(parseQuery(reportQuerySchema, req), { includeFinance: hasPermission(ctx.permissions, 'reports:financial') }));
});

reportsRouter.get('/summary', requirePermission('reports:read'), (req, res) => {
  const ctx = contextFrom(req);
  ok(res, buildReport(parseQuery(reportQuerySchema, req), { includeFinance: hasPermission(ctx.permissions, 'reports:financial') }));
});

reportsRouter.get('/export', requirePermission('reports:export'), async (req, res) => {
  sendDownload(res, await exportReport(contextFrom(req), req.query));
});

reportsRouter.post('/email', requirePermission('reports:email'), async (req, res) => {
  created(res, await emailReport(contextFrom(req), req.body));
});

reportsRouter.get('/email-status', requirePermission('reports:read'), (_req, res) => {
  ok(res, emailStatus());
});

reportsRouter.get('/jobs', requireAnyPermission('reports:export', 'reports:email'), (req, res) => {
  const q = parseQuery(paginationSchema, req);
  ok(res, listJobs(q.page, q.limit));
});

reportsRouter.get('/jobs/:id', requireAnyPermission('reports:export', 'reports:email'), (req, res) => {
  ok(res, getJob(paramId(req)));
});

reportsRouter.get('/jobs/:id/download', requirePermission('reports:export'), (req, res) => {
  sendDownload(res, jobFile(contextFrom(req), paramId(req)));
});

reportsRouter.post('/deliveries/:id/retry', requirePermission('reports:email'), async (req, res) => {
  ok(res, await retryDelivery(contextFrom(req), paramId(req)));
});

reportsRouter.get('/schedules', requirePermission('reports:email'), (_req, res) => {
  ok(res, listSchedules());
});

reportsRouter.post('/schedules', requirePermission('reports:email'), (req, res) => {
  created(res, createSchedule(contextFrom(req), req.body));
});

reportsRouter.put('/schedules/:id', requirePermission('reports:email'), (req, res) => {
  ok(res, updateSchedule(contextFrom(req), paramId(req), req.body));
});

reportsRouter.delete('/schedules/:id', requirePermission('reports:email'), (req, res) => {
  deleteSchedule(contextFrom(req), paramId(req));
  ok(res, { deleted: true });
});

reportsRouter.post('/schedules/:id/run', requirePermission('reports:email'), async (req, res) => {
  const job = await runSchedule(paramId(req));
  ok(res, job);
});
