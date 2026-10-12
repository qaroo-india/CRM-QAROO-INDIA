/**
 * The health contract.
 *
 * Deliberately shared rather than duplicated: the server builds its response
 * from this schema and the client parses the response with it, so a drift in
 * either direction fails loudly instead of rendering "undefined" on a status
 * page. It is also the Milestone 1 proof that the shared workspace genuinely
 * links both halves of the stack together.
 */

import { z } from 'zod';

export const HEALTH_STATES = ['ok', 'degraded', 'down'] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

export const dependencyHealthSchema = z.object({
  /** Human label, e.g. "database". */
  name: z.string(),
  status: z.enum(HEALTH_STATES),
  /** Round-trip time of the probe query in milliseconds. */
  latencyMs: z.number().nonnegative().nullable(),
  /** Safe, non-sensitive detail -- never a connection string or credential. */
  detail: z.string().optional(),
});

export type DependencyHealth = z.infer<typeof dependencyHealthSchema>;

export const healthResponseSchema = z.object({
  /** Worst status among all dependencies. */
  status: z.enum(HEALTH_STATES),
  service: z.string(),
  version: z.string(),
  environment: z.string(),
  /** Process uptime in seconds. */
  uptimeSeconds: z.number().nonnegative(),
  /** Server instant, so the client can show clock skew. */
  timestamp: z.string(),
  /** IANA zone the institute's reports are bucketed in. */
  timezone: z.string(),
  dependencies: z.array(dependencyHealthSchema),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * Liveness is intentionally thinner than readiness: it answers "is the process
 * running" without touching the database, so an orchestrator never restarts a
 * healthy process just because a dependency is briefly unreachable.
 */
export const livenessResponseSchema = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.number().nonnegative(),
});

export type LivenessResponse = z.infer<typeof livenessResponseSchema>;
