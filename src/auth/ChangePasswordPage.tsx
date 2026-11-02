import { changePasswordSchema, type SessionResponse } from '@ims/shared';
import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { api } from '@/lib/api';
import { handleFormError, useZodForm } from '@/lib/forms';
import { cn } from '@/lib/cn';
import { useAuth } from './AuthProvider';

/** Change-password form, used both as the forced first-login step and in Account. */
export function ChangePasswordForm({ onDone, className }: { onDone?: () => void; className?: string }) {
  const auth = useAuth();
  const form = useZodForm(changePasswordSchema, { defaultValues: { currentPassword: '', newPassword: '' } });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const session = await api.post<SessionResponse>('/auth/password', values);
      auth.updateSession(session);
      form.reset();
      toast.success('Password changed. Other sessions have been signed out.');
      onDone?.();
    } catch (error) {
      handleFormError(form, error, 'Could not change the password');
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className={cn('space-y-4', className)}>
      <Field label="Current password" error={form.formState.errors.currentPassword?.message} required>
        <Input type="password" autoComplete="current-password" {...form.register('currentPassword')} />
      </Field>
      <Field
        label="New password"
        hint="At least 10 characters, including a letter and a number."
        error={form.formState.errors.newPassword?.message}
        required
      >
        <Input type="password" autoComplete="new-password" {...form.register('newPassword')} />
      </Field>
      <Button type="submit" loading={form.formState.isSubmitting}>
        Change password
      </Button>
    </form>
  );
}

/** Shown in place of the app until a temporary password has been replaced. */
export function ChangePasswordPage() {
  const auth = useAuth();
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md rounded-card border bg-surface p-6 shadow-card sm:p-8">
        <span className="mb-4 grid size-11 place-items-center rounded-2xl border border-warning/30 bg-warning-soft text-warning">
          <KeyRound aria-hidden className="size-5" />
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-fg">Choose a new password</h1>
        <p className="mt-1.5 mb-6 text-sm text-fg-muted">
          Welcome, {auth.user?.name}. You signed in with a temporary password, so set your own before continuing.
        </p>
        <ChangePasswordForm />
        <button type="button" onClick={() => void auth.signOut()} className="mt-5 text-xs text-fg-subtle underline-offset-2 hover:text-fg hover:underline">
          Sign out instead
        </button>
      </div>
    </main>
  );
}
