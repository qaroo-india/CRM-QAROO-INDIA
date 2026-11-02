import { resetPasswordSchema, userListQuerySchema } from '@ims/shared';
import { Router } from 'express';
import { requirePermission } from '../../middleware/auth';
import { contextFrom } from '../../utils/context';
import { created, ok } from '../../utils/respond';
import { paramId, parseBody, parseQuery } from '../../utils/validate';
import {
  createUser,
  getUser,
  listUsers,
  resetPassword,
  setUserActive,
  updateUser,
  userOptions,
} from './users.service';

export const usersRouter = Router();

/** Any signed-in user: names for assignee pickers. */
usersRouter.get('/options', async (_req, res) => {
  ok(res, await userOptions());
});

/** Any back-office user: their own work profile (staff code, designation...). */
usersRouter.get('/me', async (req, res) => {
  ok(res, await getUser(req.auth!.user.id));
});

usersRouter.get('/', requirePermission('users:read'), async (req, res) => {
  ok(res, await listUsers(parseQuery(userListQuerySchema, req)));
});

usersRouter.get('/:id', requirePermission('users:read'), async (req, res) => {
  ok(res, await getUser(paramId(req)));
});

usersRouter.post('/', requirePermission('users:write'), async (req, res) => {
  created(res, await createUser(contextFrom(req), req.body));
});

usersRouter.patch('/:id', requirePermission('users:write'), async (req, res) => {
  ok(res, await updateUser(contextFrom(req), paramId(req), req.body));
});

usersRouter.post('/:id/deactivate', requirePermission('users:write'), async (req, res) => {
  ok(res, await setUserActive(contextFrom(req), paramId(req), false));
});

usersRouter.post('/:id/reactivate', requirePermission('users:write'), async (req, res) => {
  ok(res, await setUserActive(contextFrom(req), paramId(req), true));
});

usersRouter.post('/:id/reset-password', requirePermission('users:write'), async (req, res) => {
  const { temporaryPassword } = parseBody(resetPasswordSchema, req);
  ok(res, await resetPassword(contextFrom(req), paramId(req), temporaryPassword));
});
