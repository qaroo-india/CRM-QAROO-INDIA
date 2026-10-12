/**
 * Every signed-in user reads and clears only their own notifications.
 *
 * GET  /notifications                 own, paginated (?unread=true)
 * GET  /notifications/unread-count
 * POST /notifications/:id/read
 * POST /notifications/read-all
 * POST /notifications/sweep           owner only: run the reminder sweep now
 */

import { notificationListQuerySchema } from '@ims/shared';
import { Router } from 'express';
import { requireOwner } from '../../middleware/auth';
import { contextFrom } from '../../utils/context';
import { ok } from '../../utils/respond';
import { paramId, parseQuery } from '../../utils/validate';
import './events';
import { listNotifications, markAllRead, markRead, runNotificationSweep, unreadCount } from './notifications.service';

export const notificationsRouter = Router();

notificationsRouter.get('/', (req, res) => {
  ok(res, listNotifications(contextFrom(req).actorId, parseQuery(notificationListQuerySchema, req)));
});

notificationsRouter.get('/unread-count', (req, res) => {
  ok(res, { unread: unreadCount(contextFrom(req).actorId) });
});

notificationsRouter.post('/read-all', (req, res) => {
  ok(res, { updated: markAllRead(contextFrom(req).actorId) });
});

notificationsRouter.post('/sweep', requireOwner, (_req, res) => {
  ok(res, runNotificationSweep());
});

notificationsRouter.post('/:id/read', (req, res) => {
  ok(res, markRead(contextFrom(req).actorId, paramId(req)));
});
