import { changePasswordSchema, type SessionResponse } from '@ims/shared';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { useState } from 'react';
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
  const isForced = Boolean(auth.user?.mustChangePassword);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [keeping, setKeeping] = useState(false);

  const form = useZodForm(changePasswordSchema, {
    defaultValues: { currentPassword: '', newPassword: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const session = await api.post<SessionResponse>('/auth/password', {
        currentPassword: values.currentPassword || '',
        newPassword: values.newPassword,
      });

      // Keep Firebase Auth password in sync if available
      try {
        const { auth: fbAuth } = await import('@/lib/firebase');
        const { updatePassword } = await import('firebase/auth');
        if (fbAuth.currentUser) {
          await updatePassword(fbAuth.currentUser, values.newPassword);
        }
      } catch {
        // Non-blocking
      }

      auth.updateSession(session);
      form.reset();
      toast.success('Password set successfully. Welcome to your workspace!');
      onDone?.();
    } catch (error) {
      handleFormError(form, error, 'Could not change the password');
    }
  });

  const handleKeepPassword = async () => {
    setKeeping(true);
    try {
      const session = await api.post<SessionResponse>('/auth/keep-password');
      auth.updateSession(session);
      toast.success('Welcome to your workspace!');
      onDone?.();
    } catch (error) {
      handleFormError(form, error, 'Could not continue with current password');
    } finally {
      setKeeping(false);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className={cn('space-y-4', className)}>
      {!isForced && (
        <Field label="Current password" error={form.formState.errors.currentPassword?.message} required>
          <Input
            type={showCurrent ? 'text' : 'password'}
            autoComplete="current-password"
            trailing={
              <button
                type="button"
                tabIndex={-1}
                className="text-fg-subtle hover:text-fg"
                onClick={() => setShowCurrent((v) => !v)}
              >
                {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            }
            {...form.register('currentPassword')}
          />
        </Field>
      )}

      <Field
        label={isForced ? 'Choose your password' : 'New password'}
        hint="At least 10 characters, including a letter and a number."
        error={form.formState.errors.newPassword?.message}
        required
      >
        <Input
          type={showNew ? 'text' : 'password'}
          autoComplete="new-password"
          trailing={
            <button
              type="button"
              tabIndex={-1}
              className="text-fg-subtle hover:text-fg"
              onClick={() => setShowNew((v) => !v)}
            >
              {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          }
          {...form.register('newPassword')}
        />
      </Field>

      <div className="flex flex-col gap-2 pt-2">
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          {isForced ? 'Save password & continue' : 'Change password'}
        </Button>

        {isForced && (
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            loading={keeping}
            onClick={handleKeepPassword}
          >
            Keep current password & continue
          </Button>
        )}
      </div>
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
