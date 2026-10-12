import type { SessionResponse } from '@ims/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/providers/AppProviders';
import { createTestQueryClient, jsonResponse } from '@/test/render';
import { AuthProvider } from './AuthProvider';
import { LoginPage } from './LoginPage';

const session: SessionResponse = {
  csrfToken: 'csrf-after-login-0123456789abcdefghijk',
  user: {
    id: '0190a0a0-0000-7000-8000-000000000001',
    name: 'Priya Sharma',
    email: 'priya@institute.test',
    phone: null,
    role: 'owner',
    accountType: 'team',
    studentId: null,
    trainerId: null,
    hasPhoto: false,
    permissions: ['*'],
    mustChangePassword: false,
    lastLoginAt: null,
  },
  institute: {
    name: 'Apex Skills Academy', legalName: null, tagline: null, logoUrl: null, email: null, phone: null, website: null,
    address: null, taxId: null, timezone: 'Asia/Kolkata', currency: 'INR', locale: 'en-IN', fiscalYearStartMonth: 4,
    weekStartsOn: 1, studentCodePrefix: 'STU', admissionNumberPrefix: 'ADM', receiptNumberPrefix: 'RCT', leadCodePrefix: 'LEAD',
    expenseCodePrefix: 'EXP', expenseApprovalRequired: false, dueReminderDays: 3, unassignedAlertDays: 7, reportRecipients: [],
  },
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Route-aware fetch mock: anonymous until a successful login. */
function mockApi(loginResult: 'ok' | 'invalid') {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push({ url, method, headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/auth/me')) {
        return jsonResponse({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication is required' } }, 401);
      }
      if (url.endsWith('/auth/csrf')) return jsonResponse({ success: true, data: { csrfToken: 'csrf-anon-0123456789abcdefghijklmnop' } });
      if (url.endsWith('/auth/login')) {
        return loginResult === 'ok'
          ? jsonResponse({ success: true, data: session })
          : jsonResponse({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'The email or password is incorrect.' } }, 401);
      }
      return jsonResponse({ success: false, error: { code: 'NOT_FOUND', message: 'not mocked' } }, 404);
    }),
  );
  return calls;
}

function renderLogin(initialPath = '/login') {
  const router = createMemoryRouter(
    [
      {
        element: (
          <AuthProvider>
            <Outlet />
          </AuthProvider>
        ),
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/', element: <p>Dashboard home</p> },
          { path: '/payments', element: <p>Payments page</p> },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  );
  const user = userEvent.setup();
  render(
    <AppProviders queryClient={createTestQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { user, router };
}

describe('LoginPage', () => {
  it('validates the form before calling the API', async () => {
    const calls = mockApi('ok');
    const { user } = renderLogin();

    await user.click(await screen.findByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('must be a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/auth/login'))).toBe(false);
  });

  it('shows the server message for wrong credentials', async () => {
    mockApi('invalid');
    const { user } = renderLogin();

    await user.type(await screen.findByLabelText(/Email/), 'priya@institute.test');
    await user.type(screen.getByLabelText(/Password/), 'Wrong-Password-1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The email or password is incorrect.');
  });

  it('signs in with the CSRF header and returns to the requested page', async () => {
    const calls = mockApi('ok');
    const { user } = renderLogin('/login?next=%2Fpayments');

    await user.type(await screen.findByLabelText(/Email/), 'priya@institute.test');
    await user.type(screen.getByLabelText(/Password/), 'Correct-Horse-42');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Payments page')).toBeInTheDocument();
    const login = calls.find((c) => c.url.endsWith('/auth/login'))!;
    expect(login.method).toBe('POST');
    expect(login.headers['X-CSRF-Token']).toBe('csrf-anon-0123456789abcdefghijklmnop');
    expect(login.body).toEqual({ email: 'priya@institute.test', password: 'Correct-Horse-42' });
  });

  it('ignores an off-site return address', async () => {
    mockApi('ok');
    const { user } = renderLogin('/login?next=%2F%2Fevil.example');

    await user.type(await screen.findByLabelText(/Email/), 'priya@institute.test');
    await user.type(screen.getByLabelText(/Password/), 'Correct-Horse-42');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByText('Dashboard home')).toBeInTheDocument());
  });
});
