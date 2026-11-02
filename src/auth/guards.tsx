import type { AccountType, Permission } from '@ims/shared';
import { ShieldOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { firstAllowedPath } from '@/app/navigation';
import { EmptyState, LoadingBlock } from '@/components/ui/Feedback';
import { useAuth } from './AuthProvider';
import { ChangePasswordPage } from './ChangePasswordPage';

/** Signed-in users only; a temporary password must be replaced first. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') return <LoadingBlock label="Loading your workspace…" className="min-h-dvh" />;
  if (auth.status === 'anonymous') {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (auth.user?.mustChangePassword) return <ChangePasswordPage />;
  return <>{children}</>;
}

/**
 * Page-level permission gate. The server refuses the data anyway; this shows a
 * clear "no access" state instead of a page full of 403 errors.
 */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const auth = useAuth();
  // A student who follows a staff link lands back in their portal.
  if (auth.accountType === 'student') return <Navigate to="/portal" replace />;
  if (!auth.can(permission)) {
    return (
      <EmptyState
        icon={ShieldOff}
        title="You don't have access to this page"
        description={`It needs the "${permission}" permission. Ask the institute owner if you need it.`}
      />
    );
  }
  return <>{children}</>;
}

/**
 * "/" is home: the executive dashboard for the team (when permitted), the
 * teaching home for faculty, and the portal for students.
 */
export function HomeGate({ children, faculty }: { children: ReactNode; faculty: ReactNode }) {
  const auth = useAuth();
  if (auth.accountType === 'student') return <Navigate to="/portal" replace />;
  if (auth.accountType === 'faculty') return <>{faculty}</>;
  if (!auth.can('reports:read')) return <Navigate to={firstAllowedPath(auth.viewer)} replace />;
  return <>{children}</>;
}

/** Pages for one kind of account (the student portal, the back office). */
export function RequireAccount({ types, children }: { types: AccountType[]; children: ReactNode }) {
  const auth = useAuth();
  if (!types.includes(auth.accountType)) {
    return auth.accountType === 'student' ? (
      <Navigate to="/portal" replace />
    ) : (
      <EmptyState icon={ShieldOff} title="This page is for students" description="Staff see the same information from the student's profile." />
    );
  }
  return <>{children}</>;
}
