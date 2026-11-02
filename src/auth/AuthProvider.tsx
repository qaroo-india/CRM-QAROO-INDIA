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
  type JobRole,
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
  viewer: { accountType: AccountType; jobRole: JobRole | null; can: (permission: Permission) => boolean };
  signIn: (input: LoginInput) => Promise<SessionResponse>;
  signInWithGoogle: (targetAccountType?: AccountType, useRedirect?: boolean) => Promise<SessionResponse | null>;
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

  // Drop every cached query from the previous session EXCEPT the session
  // itself. queryClient.clear() would also destroy the session query this
  // provider is observing: the new session would then land in a query nobody
  // watches, the guards would still see "anonymous", and a successful sign-in
  // would bounce straight back to the sign-in page.
  const dropOtherQueries = useCallback(() => {
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== sessionQueryKey[0] });
  }, [queryClient]);

  // React to the API discovering mid-use that the session is over.
  useEffect(
    () =>
      onSessionEvent((event) => {
        if (event === 'expired') {
          const current = queryClient.getQueryData(sessionQueryKey);
          if (current) {
            toast.warning('Your session has ended. Please sign in again.');
          }
          dropOtherQueries();
          queryClient.setQueryData(sessionQueryKey, null);
          void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
        } else if (event === 'password-change-required') {
          void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
        }
      }),
    [queryClient, dropOtherQueries],
  );

  // Exchange Firebase redirect sign-in results if arriving from Google OAuth redirect
  useEffect(() => {
    if (import.meta.env.MODE === 'test') return;
    let mounted = true;

    async function handleRedirectResult() {
      try {
        const { getRedirectResult } = await import('firebase/auth');
        const { auth } = await import('@/lib/firebase');
        const { syncUserToFirestore } = await import('@/lib/firebaseUser');

        const cred = await getRedirectResult(auth);
        if (cred?.user && mounted) {
          const fbUser = cred.user;
          let targetAccountType: AccountType | undefined;
          try {
            const stored = localStorage.getItem('ims.google.targetAccountType') as AccountType | null;
            if (stored) {
              targetAccountType = stored;
              localStorage.removeItem('ims.google.targetAccountType');
            }
          } catch {}

          await syncUserToFirestore({
            uid: fbUser.uid,
            email: fbUser.email || '',
            name: fbUser.displayName,
            photoURL: fbUser.photoURL,
            accountType: targetAccountType,
          });

          const sessionRes = await api.post<SessionResponse>('/auth/firebase-login', {
            email: fbUser.email,
            name: fbUser.displayName,
            uid: fbUser.uid,
            accountType: targetAccountType,
          });

          dropOtherQueries();
          updateSession(sessionRes);
        }
      } catch (err) {
        console.error('Firebase redirect result processing error:', err);
      }
    }

    void handleRedirectResult();

    return () => {
      mounted = false;
    };
  }, [dropOtherQueries, updateSession]);

  const signIn = useCallback(
    async (input: LoginInput) => {
      // 1. First attempt Firebase Authentication (outside test environment)
      if (import.meta.env.MODE !== 'test') {
        try {
          const { signInWithEmailAndPassword } = await import('firebase/auth');
          const { auth } = await import('@/lib/firebase');
          const { syncUserToFirestore } = await import('@/lib/firebaseUser');

          const cred = await signInWithEmailAndPassword(auth, input.email, input.password);
          await syncUserToFirestore({
            uid: cred.user.uid,
            email: cred.user.email || input.email,
            name: cred.user.displayName,
          });

          const sessionRes = await api.post<SessionResponse>('/auth/firebase-login', {
            email: cred.user.email || input.email,
            name: cred.user.displayName,
            uid: cred.user.uid,
          });
          dropOtherQueries();
          updateSession(sessionRes);
          return sessionRes;
        } catch {
          // Fall through to server database authentication
        }
      }

      // 2. Fallback to server database authentication
      const result = await api.post<SessionResponse>('/auth/login', input);

      // Provision/sync in Firebase Auth & Cloud Firestore in background
      if (import.meta.env.MODE !== 'test') {
        try {
          const { createUserWithEmailAndPassword, signInWithEmailAndPassword } = await import('firebase/auth');
          const { auth } = await import('@/lib/firebase');
          const { syncUserToFirestore } = await import('@/lib/firebaseUser');

          let cred;
          try {
            cred = await createUserWithEmailAndPassword(auth, input.email, input.password);
          } catch {
            cred = await signInWithEmailAndPassword(auth, input.email, input.password);
          }
          if (cred?.user) {
            await syncUserToFirestore({
              uid: cred.user.uid,
              email: input.email,
              name: result.user.name,
              role: result.user.role as any,
              accountType: result.user.accountType,
            });
          }
        } catch {
          // Background sync completed or non-blocking
        }
      }

      dropOtherQueries();
      updateSession(result);
      return result;
    },
    [dropOtherQueries, updateSession],
  );

  const signInWithGoogle = useCallback(
    async (targetAccountType?: AccountType, useRedirect = false) => {
      const { signInWithPopup, signInWithRedirect } = await import('firebase/auth');
      const { auth, googleProvider } = await import('@/lib/firebase');
      const { syncUserToFirestore } = await import('@/lib/firebaseUser');

      if (useRedirect) {
        if (targetAccountType) {
          try {
            localStorage.setItem('ims.google.targetAccountType', targetAccountType);
          } catch {}
        }
        await signInWithRedirect(auth, googleProvider);
        return null;
      }

      const result = await signInWithPopup(auth, googleProvider);
      const fbUser = result.user;

      // Store user in Firestore
      await syncUserToFirestore({
        uid: fbUser.uid,
        email: fbUser.email || '',
        name: fbUser.displayName,
        photoURL: fbUser.photoURL,
        accountType: targetAccountType,
      });

      // Exchange with backend session
      const sessionRes = await api.post<SessionResponse>('/auth/firebase-login', {
        email: fbUser.email,
        name: fbUser.displayName,
        uid: fbUser.uid,
        accountType: targetAccountType,
      });

      dropOtherQueries();
      updateSession(sessionRes);
      return sessionRes;
    },
    [dropOtherQueries, updateSession],
  );

  const signOut = useCallback(async () => {
    try {
      const { signOut: fbSignOut } = await import('firebase/auth');
      const { auth } = await import('@/lib/firebase');
      await fbSignOut(auth).catch(() => {});
    } catch {}
    try {
      await api.post('/auth/logout');
    } finally {
      dropOtherQueries();
      queryClient.setQueryData(sessionQueryKey, null);
      const { csrfToken } = await api.get<{ csrfToken: string }>('/auth/csrf').catch(() => ({ csrfToken: '' }));
      setCsrfToken(csrfToken || null);
    }
  }, [queryClient, dropOtherQueries]);

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
      viewer: { accountType, jobRole: data?.user.jobRole ?? null, can },
      signIn,
      signInWithGoogle,
      signOut,
      updateSession,
    };
  }, [data, session.isPending, signIn, signInWithGoogle, signOut, updateSession]);

  if (session.isError) {
    // The API is unreachable or failing at boot: say so, offer a retry and
    // the public status page, rather than rendering a blank app.
    return (
      <main className="grid min-h-dvh place-items-center px-4">
        <div className="w-full max-w-md rounded-card border bg-surface p-2 shadow-card">
          <ErrorState
            error={session.error}
            title={session.error instanceof ApiRequestError && session.error.status === 429 ? 'Too many requests right now' : 'Cannot connect to Institute OS'}
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
