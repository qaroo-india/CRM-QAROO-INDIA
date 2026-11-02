/**
 * Leave (everyone in the back office requests; leave:approve decides)
 *   GET  /leave?scope=mine|team&status&userId&from&to
 *   GET  /leave/today                    leave:approve    who is away today
 *   POST /leave                          request
 *   POST /leave/:id/decision             leave:approve    { decision, reviewNote }
 *   POST /leave/:id/cancel               own request
 *
 * Tasks (everyone keeps their own; tasks:assign hands work to others)
 *   GET  /tasks?scope=mine|created|all&status&priority&assignedToId&overdue&q
 *   POST /tasks (multipart: optional "file")   PUT /tasks/:id   POST /tasks/:id/status
 *   GET  /tasks/:id/attachment
 *
 * Inventory
 *   GET  /inventory/items                inventory:read   (everyone may browse what can be requested: ?available=true)
 *   POST /inventory/items, PUT /inventory/items/:id      inventory:write
 *   GET  /inventory/requests?scope=mine|all
 *   POST /inventory/requests             anyone in the back office
 *   POST /inventory/requests/:id/decision    issue | reject | return (inventory:approve); cancel (requester)
 *
 * Placement drives
 *   GET  /drives, GET /drives/:id, GET /drives/:id/applicants   placements:read
 *   POST /drives, PUT /drives/:id, POST /drives/:id/applicants  placements:write
 */

import { driveListQuerySchema, hasPermission, inventoryListQuerySchema, inventoryRequestListQuerySchema, leaveListQuerySchema, taskListQuerySchema } from '@ims/shared';
import { Router } from 'express';
import { requirePermission } from '../../middleware/auth';
import { ApiError } from '../../utils/ApiError';
import { contextFrom } from '../../utils/context';
import { created, ok } from '../../utils/respond';
import { sendDownload } from '../../utils/sendFile';
import { paramId, parseQuery } from '../../utils/validate';
import { uploadSingle } from '../documents/documents.routes';
import { addApplicants, createDrive, driveApplicants, getDrive, listDrives, updateDrive } from '../placements/drives.service';
import {
  cancelLeave,
  createTask,
  decideLeave,
  decideRequest,
  listItems,
  listLeave,
  listRequests,
  listTasks,
  onLeave,
  requestItem,
  requestLeave,
  saveItem,
  setTaskStatus,
  taskAttachment,
  updateTask,
} from './workplace.service';

export const leaveRouter = Router();
leaveRouter.get('/', async (req, res) => ok(res, await listLeave(contextFrom(req), parseQuery(leaveListQuerySchema, req))));
leaveRouter.get('/today', requirePermission('leave:approve'), async (_req, res) => ok(res, await onLeave()));
leaveRouter.post('/', async (req, res) => created(res, await requestLeave(contextFrom(req), req.body)));
leaveRouter.post('/:id/decision', requirePermission('leave:approve'), async (req, res) => ok(res, await decideLeave(contextFrom(req), paramId(req), req.body)));
leaveRouter.post('/:id/cancel', async (req, res) => ok(res, await cancelLeave(contextFrom(req), paramId(req))));

export const tasksRouter = Router();
tasksRouter.get('/', async (req, res) => ok(res, await listTasks(contextFrom(req), parseQuery(taskListQuerySchema, req))));
tasksRouter.post('/', uploadSingle, async (req, res) => created(res, await createTask(contextFrom(req), req.file, req.body)));
tasksRouter.put('/:id', async (req, res) => ok(res, await updateTask(contextFrom(req), paramId(req), req.body)));
tasksRouter.post('/:id/status', async (req, res) => ok(res, await setTaskStatus(contextFrom(req), paramId(req), req.body)));
tasksRouter.get('/:id/attachment', async (req, res) => sendDownload(res, await taskAttachment(contextFrom(req), paramId(req))));

export const inventoryRouter = Router();
inventoryRouter.get('/items', async (req, res) => {
  const ctx = contextFrom(req);
  const q = parseQuery(inventoryListQuerySchema, req);
  // Without inventory:read, people may only browse what they can request.
  if (!hasPermission(ctx.permissions, 'inventory:read') && !q.available) throw ApiError.forbidden('Browsing the full register needs inventory access; add ?available=true to see what can be requested.');
  ok(res, await listItems(q));
});
inventoryRouter.post('/items', requirePermission('inventory:write'), async (req, res) => created(res, await saveItem(contextFrom(req), req.body)));
inventoryRouter.put('/items/:id', requirePermission('inventory:write'), async (req, res) => ok(res, await saveItem(contextFrom(req), req.body, paramId(req))));
inventoryRouter.get('/requests', async (req, res) => ok(res, await listRequests(contextFrom(req), parseQuery(inventoryRequestListQuerySchema, req))));
inventoryRouter.post('/requests', async (req, res) => created(res, await requestItem(contextFrom(req), req.body)));
inventoryRouter.post('/requests/:id/decision', async (req, res) => ok(res, await decideRequest(contextFrom(req), paramId(req), req.body)));

export const drivesRouter = Router();
drivesRouter.get('/', requirePermission('placements:read'), async (req, res) => ok(res, await listDrives(parseQuery(driveListQuerySchema, req))));
drivesRouter.post('/', requirePermission('placements:write'), async (req, res) => created(res, await createDrive(contextFrom(req), req.body)));
drivesRouter.get('/:id', requirePermission('placements:read'), async (req, res) => ok(res, await getDrive(paramId(req))));
drivesRouter.put('/:id', requirePermission('placements:write'), async (req, res) => ok(res, await updateDrive(contextFrom(req), paramId(req), req.body)));
drivesRouter.get('/:id/applicants', requirePermission('placements:read'), async (req, res) => ok(res, await driveApplicants(paramId(req))));
drivesRouter.post('/:id/applicants', requirePermission('placements:write'), async (req, res) => ok(res, await addApplicants(contextFrom(req), paramId(req), req.body)));
