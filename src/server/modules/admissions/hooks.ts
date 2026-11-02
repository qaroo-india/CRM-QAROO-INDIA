/**
 * Extension points around the admission lifecycle.
 *
 * Fee plans (Milestone 4), batch assignment (5), placement profiles (6) and
 * notifications (8) react to admissions without the admissions module
 * importing all of them. Each module registers its handler at startup;
 * handlers that run inside the transaction share its all-or-nothing outcome.
 */

import type { Admission } from '../../db/schema';
import type { Tx } from '../../db/types';
import type { RequestContext } from '../../utils/context';

type CreatedHandler = (tx: Tx, ctx: RequestContext, admission: Admission, rawInput: unknown) => Promise<void> | void;
type StatusHandler = (tx: Tx, ctx: RequestContext, before: Admission, after: Admission, date: string) => Promise<void> | void;
type AfterCommitHandler = (event: 'created', admissionId: string) => Promise<void> | void;

const created: CreatedHandler[] = [];
const status: StatusHandler[] = [];
const afterCommit: AfterCommitHandler[] = [];

export const admissionHooks = {
  registerOnCreated(handler: CreatedHandler) {
    created.push(handler);
  },
  registerOnStatusChanged(handler: StatusHandler) {
    status.push(handler);
  },
  registerAfterCommit(handler: AfterCommitHandler) {
    afterCommit.push(handler);
  },
  /** Runs each handler in turn on the caller's transaction. */
  async onCreated(tx: Tx, ctx: RequestContext, admission: Admission, rawInput: unknown): Promise<void> {
    for (const handler of created) await handler(tx, ctx, admission, rawInput);
  },
  async onStatusChanged(tx: Tx, ctx: RequestContext, before: Admission, after: Admission, date: string): Promise<void> {
    for (const handler of status) await handler(tx, ctx, before, after, date);
  },
  /**
   * Non-critical follow-ups (notifications). Failures are swallowed, never
   * thrown. Awaited before the response, because a serverless function may
   * be frozen as soon as it has answered.
   */
  async afterCommit(event: 'created', admissionId: string): Promise<void> {
    for (const handler of afterCommit) {
      try {
        await handler(event, admissionId);
      } catch {
        // Swallowed by design: the admission is already committed.
      }
    }
  },
};
