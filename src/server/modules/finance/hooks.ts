/**
 * Post-commit reactions to payments (notifications, Milestone 8). Failures
 * here never affect the committed payment.
 */

type Handler = (paymentId: string) => void;
const handlers: Handler[] = [];

export const paymentHooks = {
  registerAfterRecorded(handler: Handler) {
    handlers.push(handler);
  },
  afterRecorded(paymentId: string) {
    for (const handler of handlers) {
      try {
        handler(paymentId);
      } catch {
        // Swallowed by design: the payment is already committed.
      }
    }
  },
};
