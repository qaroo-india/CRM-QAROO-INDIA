import { QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from './api';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry(failureCount, error) {
          // A 4xx means the request itself is wrong (or unauthorised); repeating
          // it cannot help. Network blips and 5xx get two more attempts.
          if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) {
            return false;
          }
          return failureCount < 2;
        },
      },
      mutations: {
        // Never auto-retry a write. If a "record payment" request timed out
        // after the server committed it, a silent retry would book the money
        // twice. Writes are retried only by a person, with idempotency keys
        // added alongside payments in Milestone 4.
        retry: false,
      },
    },
  });
}
