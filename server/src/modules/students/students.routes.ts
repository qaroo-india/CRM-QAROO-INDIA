/**
 * GET  /students              students:read   paginated + filters
 * GET  /students/duplicates   students:read   ?phone&email&excludeId
 * GET  /students/:id          students:read   profile: admissions, leads, timeline
 * POST /students              students:write  409 DUPLICATE_STUDENT unless allowDuplicate
 * PUT  /students/:id          students:write  full replace
 */

import { duplicateQuerySchema, studentListQuerySchema } from '@ims/shared';
import { Router } from 'express';
import { requirePermission } from '../../middleware/auth';
import { findDuplicates } from '../../services/duplicates';
import { contextFrom } from '../../utils/context';
import { created, ok } from '../../utils/respond';
import { paramId, parseQuery } from '../../utils/validate';
import { createStudent, getStudentProfile, listStudents, updateStudent } from './students.service';

export const studentsRouter = Router();

studentsRouter.get('/', requirePermission('students:read'), (req, res) => {
  ok(res, listStudents(parseQuery(studentListQuerySchema, req)));
});

studentsRouter.get('/duplicates', requirePermission('students:read'), (req, res) => {
  const query = parseQuery(duplicateQuerySchema, req);
  ok(res, findDuplicates({ phone: query.phone, email: query.email, excludeStudentId: query.excludeId }));
});

studentsRouter.get('/:id', requirePermission('students:read'), (req, res) => {
  ok(res, getStudentProfile(paramId(req)));
});

studentsRouter.post('/', requirePermission('students:write'), (req, res) => {
  created(res, createStudent(contextFrom(req), req.body));
});

studentsRouter.put('/:id', requirePermission('students:write'), (req, res) => {
  ok(res, updateStudent(contextFrom(req), paramId(req), req.body));
});
