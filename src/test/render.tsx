import { QueryClient } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { AppProviders } from '@/providers/AppProviders';

/** A fresh client per test: no retries (failures surface at once), no shared cache. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

/** Render inside the real provider tree, returning a user-event instance too. */
export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  const queryClient = createTestQueryClient();
  const user = userEvent.setup();
  const result = render(ui, {
    wrapper: ({ children }) => <AppProviders queryClient={queryClient}>{children}</AppProviders>,
    ...options,
  });
  return { ...result, user, queryClient };
}

/** A fetch Response carrying JSON, as the API (or a proxy) would send it. */
export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': 'req-test-0001', ...headers },
  });
}
