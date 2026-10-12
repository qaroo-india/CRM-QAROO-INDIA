/**
 * GET  /schedule?from&to&batchId&courseId&trainerId&status   schedule:read    (faculty: own batches)
 * GET  /schedule/:id                                          schedule:read
 * POST /schedule                                              schedule:write   one class, or a weekly repeat
 * PUT  /schedule/:id                                          schedule:write   scheduled classes only
 * POST /schedule/:id/status                                   schedule:write   completed | cancelled (reason) | scheduled
 *
 * GET  /attendance/roster?batchId&date        attendance:read
 * POST /attendance                            attendance:write   { batchId, date, topic?, records[] }
 * GET  /attendance/sessions?batchId&from&to   attendance:read
 * GET  /attendance/summary?batchId&from&to    attendance:read
 */

import { attendanceQuerySchema, dateOnlySchema, idSchema, scheduleQuerySchema } from '@ims/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/auth';
import { contextFrom } from '../../utils/context';
import { created, ok } from '../../utils/respond';
import { paramId, parseQuery } from '../../utils/validate';
import { attendanceSummary, getRoster, listAttendanceSessions, saveAttendance } from '../attendance/attendance.service';
import { createSessions, getSession, listSessions, setSessionStatus, updateSession } from './schedule.service';

export const scheduleRouter = Router();

scheduleRouter.get('/', requirePermission('schedule:read'), (req, res) => {
  ok(res, listSessions(contextFrom(req), parseQuery(scheduleQuerySchema, req)));
});

scheduleRouter.get('/:id', requirePermission('schedule:read'), (req, res) => {
  ok(res, getSession(contextFrom(req), paramId(req)));
});

scheduleRouter.post('/', requirePermission('schedule:write'), (req, res) => {
  created(res, createSessions(contextFrom(req), req.body));
});

scheduleRouter.put('/:id', requirePermission('schedule:write'), (req, res) => {
  ok(res, updateSession(contextFrom(req), paramId(req), req.body));
});

scheduleRouter.post('/:id/status', requirePermission('schedule:write'), (req, res) => {
  ok(res, setSessionStatus(contextFrom(req), paramId(req), req.body));
});

export const attendanceRouter = Router();

const rosterQuery = z.object({ batchId: idSchema, date: dateOnlySchema });

attendanceRouter.get('/roster', requirePermission('attendance:read'), (req, res) => {
  const q = parseQuery(rosterQuery, req);
  ok(res, getRoster(contextFrom(req), q.batchId, q.date));
});

attendanceRouter.post('/', requirePermission('attendance:write'), (req, res) => {
  ok(res, saveAttendance(contextFrom(req), req.body));
});

attendanceRouter.get('/sessions', requirePermission('attendance:read'), (req, res) => {
  ok(res, listAttendanceSessions(contextFrom(req), parseQuery(attendanceQuerySchema, req)));
});

attendanceRouter.get('/summary', requirePermission('attendance:read'), (req, res) => {
  ok(res, attendanceSummary(contextFrom(req), parseQuery(attendanceQuerySchema, req)));
});
