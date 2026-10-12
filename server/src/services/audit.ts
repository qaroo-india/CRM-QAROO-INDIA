/**
 * Audit trail writer. Call it inside the same transaction as the change it
 * describes, so an audited write can never commit without its record.
 */

import type { AuditAction } from '@ims/shared';
import { auditLogs } from '../db/schema';
import type { DbLike } from '../db/types';
import type { RequestContext } from '../utils/context';

/** Fields never copied into audit snapshots. */
const SENSITIVE_KEYS = new Set(['passwordHash', 'tokenHash', 'tokenVersion', 'requestHash']);

function sanitize(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined || typeof value !== 'object') return null;
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    result[key] = field instanceof Date ? field.toISOString() : field;
  }
  return result;
}

/** Only the fields that actually changed, so an update's record stays readable. */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (key === 'updatedAt' || SENSITIVE_KEYS.has(key)) continue;
    const a = before[key] instanceof Date ? (before[key] as Date).toISOString() : before[key];
    const b = after[key] instanceof Date ? (after[key] as Date).toISOString() : after[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changedBefore[key] = a;
      changedAfter[key] = b;
    }
  }
  return { before: changedBefore, after: changedAfter };
}

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
}

export function recordAudit(database: DbLike, ctx: RequestContext, entry: AuditEntry): void {
  database
    .insert(auditLogs)
    .values({
      actorId: ctx.actorId || null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      before: sanitize(entry.before),
      after: sanitize(entry.after),
      requestId: ctx.requestId ?? null,
      ip: ctx.ip ?? null,
    })
    .run();
}
