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

  const form = useZodForm(loginSchema, { defaultValues: { email: params.get('email') ?? '', password: '' } });

  if (auth.status === 'authenticated') return <Navigate to={next} replace />;

  const choose = (value: Audience) => {
    remember(value);
    setFormError(null);
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
    try {
      await auth.signIn(values);
      remember(audience);
      navigate(next, { replace: true });
    } catch (error) {
      setFormError(error instanceof ApiRequestError ? error.message : 'Could not sign in. Please try again.');
    }
  });

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
          <div role="alert" className="rounded-control border border-danger/35 bg-danger-soft px-3 py-2.5 text-sm text-danger">
            {formError}
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
export { BrandMark, BrandLogo } from './AuthLayout';
