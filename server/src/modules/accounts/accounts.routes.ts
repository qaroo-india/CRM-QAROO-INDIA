/**
 * POST /portal-access/students/:id       portal:manage   { temporaryPassword } -> student portal login
 * POST /portal-access/trainers/:id       portal:manage   { temporaryPassword } -> faculty login
 * POST /portal-access/:userId/revoke     portal:manage   switch a student / faculty login off
 *
 * GET  /users/:id/photo                  back office     staff photo (attachment-safe image)
 * POST /users/:id/photo                  self, or users:write    multipart "file": PNG, JPG or WEBP, 2 MB
 */

import { hasPermission } from '@ims/shared';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import multer from 'multer';
import { db } from '../../db';
import { users } from '../../db/schema';
import { requirePermission } from '../../middleware/auth';
import { recordAudit } from '../../services/audit';
import { newKey, readStoredFile, saveFile } from '../../services/storage';
import { ApiError } from '../../utils/ApiError';
import { contextFrom } from '../../utils/context';
import { created, ok } from '../../utils/respond';
import { sendDownload } from '../../utils/sendFile';
import { paramId } from '../../utils/validate';
import { checkFile } from '../documents/documents.service';
import { grantFacultyLogin, grantStudentPortal, revokePortalLogin } from './accounts.service';

export const portalAccessRouter = Router();

portalAccessRouter.post('/students/:id', requirePermission('portal:manage'), async (req, res) => {
  created(res, await grantStudentPortal(contextFrom(req), paramId(req), req.body));
});

portalAccessRouter.post('/trainers/:id', requirePermission('portal:manage'), async (req, res) => {
  created(res, await grantFacultyLogin(contextFrom(req), paramId(req), req.body));
});

portalAccessRouter.post('/:userId/revoke', requirePermission('portal:manage'), (req, res) => {
  revokePortalLogin(contextFrom(req), paramId(req, 'userId'));
  ok(res, { revoked: true });
});

/* ------------------------------------------------------------------ *
 * Staff photos
 * ------------------------------------------------------------------ */

const PHOTO_TYPES = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const uploadPhoto = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 4 } }).single('file');

export const photoRouter = Router();

photoRouter.get('/:id/photo', (req, res) => {
  const user = db.select({ photoKey: users.photoKey, photoMime: users.photoMime, name: users.name }).from(users).where(eq(users.id, paramId(req))).get();
  const buffer = user?.photoKey ? readStoredFile(user.photoKey) : null;
  if (!user || !buffer) throw ApiError.notFound('Photo');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  sendDownload(res, { buffer, fileName: `${user.name.replace(/[^A-Za-z0-9]+/g, '-')}.${(user.photoMime ?? 'image/png').split('/')[1]}`, mimeType: user.photoMime ?? 'image/png' }, 'inline');
});

photoRouter.post('/:id/photo', uploadPhoto, (req, res) => {
  const ctx = contextFrom(req);
  const id = paramId(req);
  if (id !== ctx.actorId && !hasPermission(ctx.permissions, 'users:write')) throw ApiError.forbidden('You can only change your own photo.');
  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) throw ApiError.notFound('User');
  const { ext, mime } = checkFile(req.file);
  if (!PHOTO_TYPES.has(ext)) throw ApiError.validation([{ path: 'file', message: 'Use a PNG, JPG or WEBP image' }]);
  const key = newKey('photos', ext);
  saveFile(key, req.file!.buffer);
  db.transaction((tx) => {
    tx.update(users).set({ photoKey: key, photoMime: mime }).where(eq(users.id, id)).run();
    recordAudit(tx, ctx, { action: 'update', entityType: 'user', entityId: id, summary: `Updated the profile photo of ${target.name}` });
  });
  ok(res, { hasPhoto: true });
});
