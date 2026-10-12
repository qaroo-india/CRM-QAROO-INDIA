/**
 * Session state for the whole app.
 *
 * The session is server state (GET /auth/me), so it lives in TanStack Query
 * like everything else. This provider adds the verbs (sign in / out), the
 * permission helpers, and the reaction to a session ending mid-use: an
 * expired or revoked session sends the user to sign-in with a message and a
 * return path, rather than leaving them staring at failed requests.
 */

import {
  hasAllPermissions,
  hasAnyPermission,
  type InstituteInfo,
  type LoginInput,
  type Permission,
  type SessionResponse,
  type SessionUser,
  type AccountType,
} from '@ims/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, use, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/ui/Feedback';
import { api, ApiRequestError, onSessionEvent, setCsrfToken } from '@/lib/api';
import { setFormatConfig } from '@/utils/format';

export const sessionQueryKey = ['session'] as const;

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: Status;
  user: SessionUser | null;
  institute: InstituteInfo | null;
  can: (permission: Permission) => boolean;
  canAny: (...permissions: Permission[]) => boolean;
  canAll: (...permissions: Permission[]) => boolean;
  isOwner: boolean;
  /** team | faculty | student: decides which application the person sees. */
  accountType: AccountType;
  /** Account type + permission check, for navigation and guards. */
  viewer: { accountType: AccountType; can: (permission: Permission) => boolean };
  signIn: (input: LoginInput) => Promise<SessionResponse>;
  signOut: () => Promise<void>;
  /** Replace the cached session (after a password change, settings edit). */
  updateSession: (session: SessionResponse) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** GET /auth/me, treating "not signed in" as a normal answer rather than an error. */
async function fetchSession(): Promise<SessionResponse | null> {
  try {
    return await api.get<SessionResponse>('/auth/me');
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      // Anonymous: mint a CSRF token now so the login form can post.
      const { csrfToken } = await api.get<{ csrfToken: string }>('/auth/csrf');
      setCsrfToken(csrfToken);
      return null;
    }
    throw error;
  }
}

function applySession(session: SessionResponse | null | undefined): void {
  if (!session) return;
  setCsrfToken(session.csrfToken);
  setFormatConfig({
    currency: session.institute.currency,
    locale: session.institute.locale,
    timeZone: session.institute.timezone,
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: sessionQueryKey,
    queryFn: fetchSession,
    staleTime: 5 * 60_000,
    retry: (count, error) => !(error instanceof ApiRequestError && error.status < 500) && count < 2,
  });

  const data = session.data ?? null;
  applySession(data);

  const updateSession = useCallback(
    (next: SessionResponse) => {
      applySession(next);
      queryClient.setQueryData(sessionQueryKey, next);
    },
    [queryClient],
  );

  // React to the API discovering mid-use that the session is over.
  useEffect(
    () =>
      onSessionEvent((event) => {
        if (event === 'expired') {
          const current = queryClient.getQueryData(sessionQueryKey);
          if (current) {
            toast.warning('Your session has ended. Please sign in again.');
          }
          queryClient.clear();
          queryClient.setQueryData(sessionQueryKey, null);
          void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
        } else if (event === 'password-change-required') {
          void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
        }
      }),
    [queryClient],
  );

  const signIn = useCallback(
    async (input: LoginInput) => {
      const result = await api.post<SessionResponse>('/auth/login', input);
      queryClient.clear();
      updateSession(result);
      return result;
    },
    [queryClient, updateSession],
  );

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      queryClient.clear();
      queryClient.setQueryData(sessionQueryKey, null);
      const { csrfToken } = await api.get<{ csrfToken: string }>('/auth/csrf').catch(() => ({ csrfToken: '' }));
      setCsrfToken(csrfToken || null);
    }
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(() => {
    const permissions = data?.user.permissions ?? [];
    const can = (permission: Permission) => hasAllPermissions(permissions, [permission]);
    const accountType: AccountType = data?.user.accountType ?? 'team';
    return {
      status: session.isPending ? 'loading' : data ? 'authenticated' : 'anonymous',
      user: data?.user ?? null,
      institute: data?.institute ?? null,
      can,
      canAny: (...required) => hasAnyPermission(permissions, required),
      canAll: (...required) => hasAllPermissions(permissions, required),
      isOwner: data?.user.role === 'owner',
      accountType,
      viewer: { accountType, can },
      signIn,
      signOut,
      updateSession,
    };
  }, [data, session.isPending, signIn, signOut, updateSession]);

  if (session.isError) {
    // The API is unreachable or failing at boot: say so, offer a retry and
    // the public status page, rather than rendering a blank app.
    return (
      <main className="grid min-h-dvh place-items-center px-4">
        <div className="w-full max-w-md rounded-card border bg-surface p-2 shadow-card">
          <ErrorState
            error={session.error}
            title="Cannot connect to Institute OS"
            onRetry={() => void session.refetch()}
            retrying={session.isFetching}
          />
          <p className="pb-4 text-center text-xs text-fg-subtle">
            <a href="/status" className="underline underline-offset-2 hover:text-fg">
              Open the system status page
            </a>{' '}
            for diagnostics.
          </p>
        </div>
      </main>
    );
  }

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const context = use(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** Render children only when the user holds the permission(s). */
export function Can({ permission, any, children, fallback = null }: { permission?: Permission; any?: Permission[]; children: ReactNode; fallback?: ReactNode }) {
  const auth = useAuth();
  const allowed = permission ? auth.can(permission) : any ? auth.canAny(...any) : true;
  return <>{allowed ? children : fallback}</>;
}
