import { loginSchema } from '@ims/shared';
import { Briefcase, GraduationCap, LockKeyhole, Mail, Presentation, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { SegmentedItem, SegmentedList } from '@/components/ui/Segmented';
import { ApiRequestError } from '@/lib/api';
import { useZodForm } from '@/lib/forms';
import { AuthLayout } from './AuthLayout';
import { useAuth } from './AuthProvider';

/** Only same-app paths are honoured as a return target (no open redirects). */
function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

type Audience = 'office' | 'faculty' | 'student';

/**
 * Who is signing in. This only changes the wording and the help links: the
 * server decides what an account can reach, so choosing the wrong tab can
 * never open the wrong area (a student who signs in under "Office" still
 * lands in their portal).
 */
const AUDIENCES: Record<Audience, { label: string; icon: LucideIcon; title: string; help: string; placeholder: string }> = {
  office: {
    label: 'Office',
    icon: Briefcase,
    title: 'Office sign in',
    help: 'For the owner and office staff. Use the email and password the owner set up for you.',
    placeholder: 'you@institute.com',
  },
  faculty: {
    label: 'Faculty',
    icon: Presentation,
    title: 'Faculty sign in',
    help: 'For trainers. Use the email on your trainer record and the password the office gave you.',
    placeholder: 'trainer@institute.com',
  },
  student: {
    label: 'Student',
    icon: GraduationCap,
    title: 'Student portal',
    help: 'Use the email you gave at admission to see your classes, attendance, exams, fees and certificates.',
    placeholder: 'you@example.com',
  },
};
const AUDIENCE_KEYS = Object.keys(AUDIENCES) as Audience[];
const STORAGE_KEY = 'ims.login.audience';

function rememberedAudience(): Audience | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return AUDIENCE_KEYS.includes(value as Audience) ? (value as Audience) : null;
  } catch {
    return null;
  }
}

function remember(audience: Audience): void {
  try {
    localStorage.setItem(STORAGE_KEY, audience);
  } catch {
    // Private mode or blocked storage: the tab just isn't remembered.
  }
}

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const next = safeNext(params.get('next'));
  const justReset = params.get('reset') === '1';
  const fromUrl = params.get('as') as Audience | null;
  const audience: Audience = fromUrl && AUDIENCE_KEYS.includes(fromUrl) ? fromUrl : (rememberedAudience() ?? 'office');
  const copy = AUDIENCES[audience];
  const [formError, setFormError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [redirectFallback, setRedirectFallback] = useState(false);

  const form = useZodForm(loginSchema, { defaultValues: { email: params.get('email') ?? '', password: '' } });

  if (auth.status === 'authenticated') return <Navigate to={next} replace />;

  const choose = (value: Audience) => {
    remember(value);
    setFormError(null);
    setRedirectFallback(false);
    setParams(
      (current) => {
        const p = new URLSearchParams(current);
        p.set('as', value);
        return p;
      },
      { replace: true, state: location.state },
    );
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    setRedirectFallback(false);
    try {
      await auth.signIn(values);
      remember(audience);
      navigate(next, { replace: true });
    } catch (error) {
      setFormError(error instanceof ApiRequestError ? error.message : 'Could not sign in. Please try again.');
    }
  });

  const handleGoogleSignIn = async (useRedirect = false) => {
    setFormError(null);
    setGoogleLoading(true);
    try {
      const res = await auth.signInWithGoogle(audience === 'office' ? 'team' : audience, useRedirect);
      if (res) {
        remember(audience);
        navigate(next, { replace: true });
      }
    } catch (error: any) {
      if (error?.code === 'auth/popup-closed-by-user') {
        return;
      }

      const errorCode = error?.code || '';
      const errorRaw = String(error?.customData?._tokenResponse?.error?.message || error?.message || '');
      const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'your domain';

      if (errorRaw.includes('UNAUTHORIZED_DOMAIN') || errorCode === 'auth/unauthorized-domain') {
        setRedirectFallback(false);
        setFormError(
          `Domain not authorized in Firebase: "${currentHost}". Please add "${currentHost}" in Firebase Console > Authentication > Settings > Authorized domains.`,
        );
        return;
      }

      if (errorCode === 'auth/popup-blocked') {
        setRedirectFallback(true);
        setFormError('Popup was blocked by your browser. Please allow popups or try the redirect option below.');
        return;
      }

      if (errorCode === 'auth/internal-error') {
        setRedirectFallback(true);
        setFormError(
          `Google sign-in internal error. Ensure "${currentHost}" is in Firebase Console Authorized Domains, or try redirect sign-in below.`,
        );
        return;
      }

      setRedirectFallback(false);
      setFormError(error instanceof Error ? error.message : 'Google sign-in failed. Please try again.');
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <AuthLayout>
      <SegmentedList label="Who is signing in" className="grid grid-cols-3 gap-1 rounded-control border bg-surface p-1">
        {AUDIENCE_KEYS.map((key) => {
          const { label, icon: Icon } = AUDIENCES[key];
          return (
            <SegmentedItem key={key} selected={key === audience} onClick={() => choose(key)} className="px-2 py-2">
              <Icon aria-hidden className="size-4" />
              {label}
            </SegmentedItem>
          );
        })}
      </SegmentedList>

      <div key={audience} className="animate-fade-in space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{copy.title}</h1>
        <p className="text-sm text-fg-muted">{copy.help}</p>
      </div>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {justReset && !formError && (
          <div role="status" className="rounded-control border border-success/35 bg-success-soft px-3 py-2.5 text-sm text-fg">
            Your password is set. Sign in with it now.
          </div>
        )}
        {formError && (
          <div role="alert" className="space-y-2 rounded-control border border-danger/35 bg-danger-soft px-3 py-2.5 text-sm text-danger">
            <div>{formError}</div>
            {redirectFallback && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full text-xs font-normal"
                loading={googleLoading}
                onClick={() => handleGoogleSignIn(true)}
              >
                Sign in with Google via redirect instead
              </Button>
            )}
          </div>
        )}
        <Field label="Email" error={form.formState.errors.email?.message} required>
          <Input
            type="email"
            autoComplete="username"
            autoFocus
            placeholder={copy.placeholder}
            leading={<Mail aria-hidden className="size-4" />}
            {...form.register('email')}
          />
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message} required>
          <Input
            type="password"
            autoComplete="current-password"
            leading={<LockKeyhole aria-hidden className="size-4" />}
            {...form.register('password')}
          />
        </Field>
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Sign in
        </Button>

        <div className="relative my-3 flex items-center justify-center">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
          <span className="relative bg-surface px-2 text-xs text-fg-subtle">or continue with</span>
        </div>

        <Button
          type="button"
          variant="secondary"
          className="w-full gap-2"
          loading={googleLoading}
          onClick={() => handleGoogleSignIn(false)}
        >
          <svg className="size-4 shrink-0" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
          </svg>
          Google
        </Button>
      </form>

      <div className="space-y-1.5 text-center text-sm">
        <p>
          <Link to="/forgot-password" className="text-primary hover:underline">Forgot your password?</Link>
        </p>
        {audience === 'student' && (
          <p className="text-fg-subtle">
            First time here? <Link to="/activate" className="text-primary hover:underline">Activate your portal login</Link>
          </p>
        )}
        {audience === 'faculty' && <p className="text-fg-subtle">No login yet? Ask the institute office to give you one.</p>}
        {audience === 'office' && <p className="text-fg-subtle">Staff accounts are created by the owner.</p>}
      </div>
    </AuthLayout>
  );
}

// Re-exported for existing imports (the sidebar uses it).
export { BrandMark } from './AuthLayout';
