import { loginSchema } from '@ims/shared';
import { LockKeyhole, Mail } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { ApiRequestError } from '@/lib/api';
import { useZodForm } from '@/lib/forms';
import { AuthLayout } from './AuthLayout';
import { useAuth } from './AuthProvider';

/** Only same-app paths are honoured as a return target (no open redirects). */
function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const next = safeNext(search.get('next'));
  const justReset = search.get('reset') === '1';
  const [formError, setFormError] = useState<string | null>(null);

  const form = useZodForm(loginSchema, { defaultValues: { email: search.get('email') ?? '', password: '' } });

  if (auth.status === 'authenticated') return <Navigate to={next} replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await auth.signIn(values);
      navigate(next, { replace: true });
    } catch (error) {
      setFormError(error instanceof ApiRequestError ? error.message : 'Could not sign in. Please try again.');
    }
  });

  return (
    <AuthLayout>
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Sign in</h1>
        <p className="text-sm text-fg-muted">Owner: use the email and password set during setup. Staff: use the account the owner created for you.</p>
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
        <p className="text-fg-subtle">
          Student? <Link to="/activate" className="text-primary hover:underline">Activate your portal login</Link>
        </p>
      </div>
    </AuthLayout>
  );
}

// Re-exported for existing imports (the sidebar uses it).
export { BrandMark } from './AuthLayout';
