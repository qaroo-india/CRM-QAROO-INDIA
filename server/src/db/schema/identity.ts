/**
 * Sessions, code sequences, saved filters and the audit trail.
 */

import {
  check,
  id,
  index,
  instant,
  int,
  json,
  primaryKey,
  ref,
  sql,
  str,
  table,
  timestamps,
  uniqueIndex,
} from '../dialect';
import { users } from './users';

/**
 * Single-use emailed links: "forgot password" and "activate your portal
 * account". Only a SHA-256 hash of the token is stored, so a database leak
 * cannot be turned into working links.
 */
export const passwordTokens = table(
  'password_tokens',
  {
    id: id(),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id),
    purpose: str('purpose').$type<'reset' | 'activate'>().notNull(),
    tokenHash: str('token_hash').notNull(),
    expiresAt: instant('expires_at').notNull(),
    usedAt: instant('used_at'),
    requestedIp: str('requested_ip'),
    createdAt: instant('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('password_tokens_hash_unique').on(t.tokenHash),
    index('password_tokens_user_idx').on(t.userId, t.createdAt),
    check('password_tokens_purpose_check', sql`${t.purpose} in ('reset', 'activate')`),
  ],
);

/**
 * Rotating refresh tokens. Only a SHA-256 hash is stored, so a database leak
 * does not leak usable sessions. Each refresh issues a new token in the same
 * family and marks the old one replaced; presenting a replaced token again
 * means it was stolen, and the whole family is revoked.
 */
export const refreshTokens = table(
  'refresh_tokens',
  {
    id: id(),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: str('token_hash').notNull(),
    familyId: str('family_id').notNull(),
    expiresAt: instant('expires_at').notNull(),
    revokedAt: instant('revoked_at'),
    replacedById: str('replaced_by_id'),
    userAgent: str('user_agent'),
    ip: str('ip'),
    createdAt: instant('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_unique').on(t.tokenHash),
    index('refresh_tokens_user_idx').on(t.userId),
    index('refresh_tokens_family_idx').on(t.familyId),
  ],
);

/**
 * Per-year counters behind human-facing codes (RCT-2026-00042). Incremented
 * inside the same transaction as the row that uses the number, so two
 * simultaneous receipts can never share one, and a rolled-back insert never
 * burns one.
 */
export const sequences = table(
  'sequences',
  {
    name: str('name').notNull(),
    year: int('year').notNull(),
    value: int('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.name, t.year] }), check('sequences_value_positive', sql`${t.value} > 0`)],
);

export const savedFilters = table(
  'saved_filters',
  {
    id: id(),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id),
    scope: str('scope').notNull(),
    name: str('name').notNull(),
    params: json<Record<string, unknown>>('params').notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('saved_filters_user_scope_name_unique').on(t.userId, t.scope, t.name)],
);

/**
 * Who changed what, and when. Written in the same transaction as the change,
 * so an audited write cannot succeed without its record.
 */
export const auditLogs = table(
  'audit_logs',
  {
    id: id(),
    actorId: ref('actor_id').references(() => users.id),
    action: str('action').notNull(),
    entityType: str('entity_type').notNull(),
    entityId: str('entity_id'),
    summary: str('summary').notNull(),
    before: json<Record<string, unknown>>('before'),
    after: json<Record<string, unknown>>('after'),
    requestId: str('request_id'),
    ip: str('ip'),
    occurredAt: instant('occurred_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_occurred_idx').on(t.occurredAt),
    index('audit_logs_actor_idx').on(t.actorId),
  ],
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
