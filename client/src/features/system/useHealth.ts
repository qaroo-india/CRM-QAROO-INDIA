import { healthResponseSchema, type HealthResponse } from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { api, type ApiRequestError } from '@/lib/api';

export const HEALTH_REFRESH_MS = 15_000;

export const healthQueryKey = ['system', 'health'] as const;

/**
 * Polls the readiness endpoint. The response is validated against the same
 * schema the server builds it from, so contract drift surfaces as an error
 * state rather than a half-rendered page.
 */
export function useHealth() {
  return useQuery<HealthResponse, ApiRequestError>({
    queryKey: healthQueryKey,
    queryFn: ({ signal }) =>
      api.get('/health', {
        schema: healthResponseSchema,
        signal,
        // 503 still carries a full report when the database is down.
        acceptStatuses: [503],
      }),
    refetchInterval: HEALTH_REFRESH_MS,
    staleTime: 0,
  });
}
