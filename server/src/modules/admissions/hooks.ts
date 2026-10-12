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

type CreatedHandler = (tx: Tx, ctx: RequestContext, admission: Admission, rawInput: unknown) => void;
type StatusHandler = (tx: Tx, ctx: RequestContext, before: Admission, after: Admission, date: string) => void;
type AfterCommitHandler = (event: 'created', admissionId: string) => void;

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
  onCreated(tx: Tx, ctx: RequestContext, admission: Admission, rawInput: unknown) {
    for (const handler of created) handler(tx, ctx, admission, rawInput);
  },
  onStatusChanged(tx: Tx, ctx: RequestContext, before: Admission, after: Admission, date: string) {
    for (const handler of status) handler(tx, ctx, before, after, date);
  },
  /** Non-critical follow-ups (notifications). Failures are logged, never thrown. */
  afterCommit(event: 'created', admissionId: string) {
    for (const handler of afterCommit) {
      try {
        handler(event, admissionId);
      } catch {
        // Swallowed by design: the admission is already committed.
      }
    }
  },
};
