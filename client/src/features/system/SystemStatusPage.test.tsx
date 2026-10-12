import type { HealthResponse } from '@ims/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderWithProviders } from '@/test/render';
import { SystemStatusPage } from './SystemStatusPage';

const healthy: HealthResponse = {
  status: 'ok',
  service: 'institute-management-api',
  version: '0.1.0',
  environment: 'development',
  uptimeSeconds: 3725,
  // 09:30 UTC is 15:00 in Asia/Kolkata (UTC+5:30).
  timestamp: '2026-10-10T09:30:00.000Z',
  timezone: 'Asia/Kolkata',
  dependencies: [
    { name: 'database', status: 'ok', latencyMs: 0.04, detail: 'SQLite responding' },
    { name: 'migrations', status: 'ok', latencyMs: 0.21, detail: '1 migration(s) applied, schema up to date' },
    { name: 'settings', status: 'ok', latencyMs: 0.12, detail: 'Institute settings present' },
  ],
};

function mockFetch(...responses: Array<Response | Error>) {
  const fn = vi.fn<typeof fetch>();
  for (const response of responses) {
    if (response instanceof Error) fn.mockRejectedValueOnce(response);
    else fn.mockResolvedValueOnce(response);
  }
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('SystemStatusPage', () => {
  it('shows a loading state, then the healthy report', async () => {
    mockFetch(jsonResponse({ success: true, data: healthy }));
    renderWithProviders(<SystemStatusPage />);

    expect(screen.getByText('Checking system status…')).toBeInTheDocument();

    expect(await screen.findByText('All systems operational')).toBeInTheDocument();
    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.getByText('Schema migrations')).toBeInTheDocument();
    expect(screen.getByText('Institute settings')).toBeInTheDocument();
    expect(screen.getAllByText('Operational')).toHaveLength(3);
    expect(screen.getByText('v0.1.0')).toBeInTheDocument();
    expect(screen.getByText('1h 2m')).toBeInTheDocument();
    expect(screen.getByText('0.04 ms')).toBeInTheDocument();
  });

  it('calls the API with cookies, through the same-origin base path', async () => {
    const fetchMock = mockFetch(jsonResponse({ success: true, data: healthy }));
    renderWithProviders(<SystemStatusPage />);
    await screen.findByText('All systems operational');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/health');
    expect(init?.credentials).toBe('include');
  });

  it("renders server time in the institute's zone, not the viewer's", async () => {
    mockFetch(jsonResponse({ success: true, data: healthy }));
    renderWithProviders(<SystemStatusPage />);
    await screen.findByText('All systems operational');

    // 09:30 UTC must display as 3:00 pm IST. Rendering in UTC would show 9:30.
    expect(screen.getByText(/3:00:00\s?pm/i)).toBeInTheDocument();
    expect(screen.getByText('Asia/Kolkata')).toBeInTheDocument();
  });

  it('explains exactly which setup step is missing when degraded', async () => {
    const degraded: HealthResponse = {
      ...healthy,
      status: 'degraded',
      dependencies: [
        healthy.dependencies[0]!,
        { name: 'migrations', status: 'degraded', latencyMs: 0.3, detail: '1 pending migration(s). Run "npm run db:migrate".' },
        { name: 'settings', status: 'degraded', latencyMs: null, detail: 'Settings table unavailable.' },
      ],
    };
    mockFetch(jsonResponse({ success: true, data: degraded }));
    renderWithProviders(<SystemStatusPage />);

    expect(await screen.findByText('Setup incomplete')).toBeInTheDocument();
    expect(screen.getByText(/npm run db:migrate/)).toBeInTheDocument();
    expect(screen.getAllByText('Action needed')).toHaveLength(2);
    expect(screen.getByText('—')).toBeInTheDocument(); // null latency
  });

  it('reads the full report from a 503 when the database is down', async () => {
    const down: HealthResponse = {
      ...healthy,
      status: 'down',
      dependencies: [{ name: 'database', status: 'down', latencyMs: null, detail: 'Database is unreachable' }],
    };
    mockFetch(jsonResponse({ success: true, data: down }, 503));
    renderWithProviders(<SystemStatusPage />);

    expect(await screen.findByText('Service unavailable')).toBeInTheDocument();
    expect(screen.getByText('Database is unreachable')).toBeInTheDocument();
    expect(screen.getByText('Down')).toBeInTheDocument();
  });

  it('guides the user when the API cannot be reached, and recovers on retry', async () => {
    const fetchMock = mockFetch(new TypeError('Failed to fetch'), jsonResponse({ success: true, data: healthy }));
    const { user } = renderWithProviders(<SystemStatusPage />);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('API unreachable')).toBeInTheDocument();
    expect(within(alert).getByText('Things to check')).toBeInTheDocument();

    await user.click(within(alert).getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('All systems operational')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a non-JSON gateway error as the API being down', async () => {
    // What the Vite dev proxy returns when the API process is not running.
    mockFetch(new Response('', { status: 500, headers: { 'content-type': 'text/plain' } }));
    renderWithProviders(<SystemStatusPage />);

    expect(await screen.findByText('API unreachable')).toBeInTheDocument();
  });

  it('shows the server error and request id for an API rejection', async () => {
    mockFetch(
      jsonResponse(
        {
          success: false,
          error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later', requestId: 'req-abc-123' },
        },
        429,
      ),
    );
    renderWithProviders(<SystemStatusPage />);

    expect(await screen.findByText('Health check failed')).toBeInTheDocument();
    expect(screen.getByText('Too many requests, please try again later')).toBeInTheDocument();
    expect(screen.getByText('req-abc-123')).toBeInTheDocument();
    expect(screen.queryByText('Things to check')).not.toBeInTheDocument();
  });

  it('rejects a response that breaks the shared contract', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch(jsonResponse({ success: true, data: { status: 'ok' } }));
    renderWithProviders(<SystemStatusPage />);

    expect(await screen.findByText('Health check failed')).toBeInTheDocument();
    expect(screen.getByText(/unexpected format/i)).toBeInTheDocument();
  });

  it('refreshes on demand', async () => {
    const fetchMock = mockFetch(
      jsonResponse({ success: true, data: healthy }),
      jsonResponse({ success: true, data: { ...healthy, uptimeSeconds: 7200 } }),
    );
    const { user } = renderWithProviders(<SystemStatusPage />);
    await screen.findByText('1h 2m');

    await user.click(screen.getByRole('button', { name: 'Refresh status' }));

    expect(await screen.findByText('2h 0m')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('theme toggle', () => {
  it('cycles dark -> light -> system and remembers the choice', async () => {
    mockFetch(jsonResponse({ success: true, data: healthy }));
    const { user } = renderWithProviders(<SystemStatusPage />);
    await screen.findByText('All systems operational');

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');

    await user.click(screen.getByRole('button', { name: /theme: dark/i }));
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'light'));
    expect(window.localStorage.getItem('ims-theme')).toBe('light');

    await user.click(screen.getByRole('button', { name: /theme: light/i }));
    expect(window.localStorage.getItem('ims-theme')).toBe('system');
    expect(screen.getByRole('button', { name: /theme: system/i })).toBeInTheDocument();
  });
});
