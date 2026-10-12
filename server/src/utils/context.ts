/**
 * Who is acting, from where. Routes build this once and pass it to services,
 * which use it for permission decisions and the audit trail.
 */

import type { AccountType } from '@ims/shared';
import type { Request } from 'express';
import type { PublicUser } from '../db/schema';
import { ApiError } from './ApiError';

export interface AuthState {
  user: PublicUser;
  permissions: string[];
  accountType: AccountType;
  /** The student record of a student login. */
  studentId: string | null;
  /** The trainer record of a faculty login. */
  trainerId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      /** Set by the authenticate middleware. */
      auth?: AuthState;
    }
  }
}

export interface RequestContext {
  actorId: string;
  actorName: string;
  permissions: string[];
  isOwner: boolean;
  /** Absent for system work; treated as 'team'. */
  accountType?: AccountType;
  studentId?: string | null;
  trainerId?: string | null;
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

export function contextFrom(req: Request): RequestContext {
  if (!req.auth) throw ApiError.unauthorized();
  return {
    actorId: req.auth.user.id,
    actorName: req.auth.user.name,
    permissions: req.auth.permissions,
    isOwner: req.auth.user.role === 'owner',
    accountType: req.auth.accountType,
    studentId: req.auth.studentId,
    trainerId: req.auth.trainerId,
    requestId: typeof req.id === 'string' ? req.id : undefined,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
  };
}

/** A context for system-initiated work (scheduled jobs, seeding). */
export function systemContext(): RequestContext {
  return { actorId: '', actorName: 'System', permissions: ['*'], isOwner: true };
}
