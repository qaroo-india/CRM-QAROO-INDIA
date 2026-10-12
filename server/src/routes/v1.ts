/**
 * Version 1 of the REST API, mounted at /api/v1.
 *
 * Order is the security model:
 *   1. /health           public, read-only
 *   2. CSRF check        every state-changing request from here on
 *   3. /auth             login/refresh/logout handle their own session logic
 *   4. authenticate      everything below requires a valid session
 *   5. feature routers   each route then checks its own permission
 *
 * Unknown paths below step 4 answer 401 to anonymous callers, so the API
 * does not reveal which routes exist to someone without a session.
 */

import { Router } from 'express';
import { authenticate, backOffice } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { admissionsRouter } from '../modules/admissions/admissions.routes';
import { auditRouter } from '../modules/audit/audit.routes';
import { authRouter } from '../modules/auth/auth.routes';
import { admissionBatchRouter, assignmentsRouter, batchesRouter, trainersRouter } from '../modules/batches/batches.routes';
import { coursesRouter } from '../modules/courses/courses.routes';
import { expensesRouter } from '../modules/expenses/expenses.routes';
import {
  adjustmentsRouter,
  admissionFinanceRouter,
  instalmentsRouter,
  loansRouter,
  paymentsRouter,
} from '../modules/finance/finance.routes';
import { healthRouter } from '../modules/health/health.routes';
import { leadsRouter } from '../modules/leads/leads.routes';
import { placementsRouter } from '../modules/placements/placements.routes';
import { documentsRouter } from '../modules/documents/documents.routes';
import { importRouter } from '../modules/import/import.routes';
import { notificationsRouter } from '../modules/notifications/notifications.routes';
import { reportsRouter } from '../modules/reports/reports.routes';
import { searchRouter } from '../modules/search/search.routes';
import { settingsRouter } from '../modules/settings/settings.routes';
import { studentsRouter } from '../modules/students/students.routes';
import { usersRouter } from '../modules/users/users.routes';
import { photoRouter, portalAccessRouter } from '../modules/accounts/accounts.routes';
import { portalRouter } from '../modules/portal/portal.routes';
import { attendanceRouter, scheduleRouter } from '../modules/schedule/schedule.routes';
import { certificatesRouter, examsRouter, materialsRouter, verifyRouter } from '../modules/teaching.routes';
import { drivesRouter, inventoryRouter, leaveRouter, tasksRouter } from '../modules/workplace/workplace.routes';

export const v1Router = Router();

v1Router.use('/health', healthRouter);
// Public: confirm a certificate reference (read-only, rate limited).
v1Router.use('/verify', verifyRouter);

v1Router.use(csrfProtection);
v1Router.use('/auth', authRouter);

v1Router.use(authenticate);

// Every kind of account: own notifications.
v1Router.use('/notifications', notificationsRouter);
// Student logins: their own records only.
v1Router.use('/portal', portalRouter);

// Everything below is the back office: team and faculty accounts only. A
// student login is stopped here, whatever permissions a route checks.
v1Router.use(backOffice);
v1Router.use('/users', photoRouter);
v1Router.use('/users', usersRouter);
v1Router.use('/portal-access', portalAccessRouter);
v1Router.use('/settings', settingsRouter);
v1Router.use('/audit', auditRouter);
v1Router.use('/courses', coursesRouter);
v1Router.use('/leads', leadsRouter);
v1Router.use('/students', studentsRouter);
v1Router.use('/admissions', admissionsRouter);
v1Router.use('/admissions', admissionFinanceRouter);
v1Router.use('/payments', paymentsRouter);
v1Router.use('/adjustments', adjustmentsRouter);
v1Router.use('/instalments', instalmentsRouter);
v1Router.use('/loans', loansRouter);
v1Router.use('/expenses', expensesRouter);
v1Router.use('/trainers', trainersRouter);
v1Router.use('/batches', batchesRouter);
v1Router.use('/batch-assignments', assignmentsRouter);
v1Router.use('/admissions', admissionBatchRouter);
v1Router.use('/placements', placementsRouter);
v1Router.use('/reports', reportsRouter);
v1Router.use('/documents', documentsRouter);
v1Router.use('/import', importRouter);
v1Router.use('/search', searchRouter);
v1Router.use('/schedule', scheduleRouter);
v1Router.use('/attendance', attendanceRouter);
v1Router.use('/exams', examsRouter);
v1Router.use('/materials', materialsRouter);
v1Router.use('/certificates', certificatesRouter);
v1Router.use('/drives', drivesRouter);
v1Router.use('/leave', leaveRouter);
v1Router.use('/tasks', tasksRouter);
v1Router.use('/inventory', inventoryRouter);
