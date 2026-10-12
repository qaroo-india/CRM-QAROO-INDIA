/**
 * GET  /placements/profiles               placements:read
 * GET  /placements/profiles/:id           placements:read   with applications + interviews
 * POST /placements/profiles               placements:write
 * PUT  /placements/profiles/:id           placements:write
 * POST /placements/profiles/:id/stage     placements:write
 * GET  /placements/applications           placements:read
 * POST /placements/applications           placements:write
 * POST /placements/applications/:id/outcome   placements:offer for offers/joining, else placements:write
 * POST /placements/applications/:id/interviews  placements:write
 * POST /placements/interviews/:id/result  placements:write
 * GET  /placements/companies, POST        placements:read / placements:write
 * GET  /placements/analytics?from&to      placements:read
 */

import { applicationListQuerySchema, hasPermission, profileListQuerySchema } from '@ims/shared';
import { Router } from 'express';
import { requirePermission } from '../../middleware/auth';
import { ApiError } from '../../utils/ApiError';
import { contextFrom } from '../../utils/context';
import { created, ok } from '../../utils/respond';
import { paramId, parseQuery } from '../../utils/validate';
import {
  addInterview,
  createApplication,
  createCompany,
  createProfile,
  getProfile,
  listApplications,
  listCompanies,
  listProfiles,
  placementAnalytics,
  setInterviewResult,
  setOutcome,
  setStage,
  updateProfile,
} from './placements.service';

export const placementsRouter = Router();

placementsRouter.get('/profiles', requirePermission('placements:read'), (req, res) => ok(res, listProfiles(parseQuery(profileListQuerySchema, req))));
placementsRouter.get('/profiles/:id', requirePermission('placements:read'), (req, res) => ok(res, getProfile(paramId(req))));
placementsRouter.post('/profiles', requirePermission('placements:write'), (req, res) => created(res, createProfile(contextFrom(req), req.body)));
placementsRouter.put('/profiles/:id', requirePermission('placements:write'), (req, res) => ok(res, updateProfile(contextFrom(req), paramId(req), req.body)));
placementsRouter.post('/profiles/:id/stage', requirePermission('placements:write'), (req, res) => ok(res, setStage(contextFrom(req), paramId(req), req.body)));

placementsRouter.get('/applications', requirePermission('placements:read'), (req, res) => ok(res, listApplications(parseQuery(applicationListQuerySchema, req))));
placementsRouter.post('/applications', requirePermission('placements:write'), (req, res) => created(res, createApplication(contextFrom(req), req.body)));
placementsRouter.post('/applications/:id/outcome', requirePermission('placements:write'), (req, res) => {
  const ctx = contextFrom(req);
  if (['offer_received', 'offer_declined', 'joined'].includes(req.body?.outcome) && !hasPermission(ctx.permissions, 'placements:offer')) {
    throw ApiError.forbidden('Recording offers and joining needs the "placements:offer" permission.');
  }
  ok(res, setOutcome(ctx, paramId(req), req.body));
});
placementsRouter.post('/applications/:id/interviews', requirePermission('placements:write'), (req, res) => created(res, addInterview(contextFrom(req), paramId(req), req.body)));
placementsRouter.post('/interviews/:id/result', requirePermission('placements:write'), (req, res) => ok(res, setInterviewResult(contextFrom(req), paramId(req), req.body)));

placementsRouter.get('/companies', requirePermission('placements:read'), (_req, res) => ok(res, listCompanies()));
placementsRouter.post('/companies', requirePermission('placements:write'), (req, res) => created(res, createCompany(contextFrom(req), req.body)));

placementsRouter.get('/analytics', requirePermission('placements:read'), (req, res) => ok(res, placementAnalytics(req.query)));
