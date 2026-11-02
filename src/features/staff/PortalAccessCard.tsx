/**
 * Give, restore or switch off the login of a student (portal) or a trainer
 * (faculty workspace). The person's email on the record is their sign-in
 * name; they set their own password at first sign-in.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogIn, UserX } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DialogContent, DialogRoot } from '@/components/ui/Dialog';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { api } from '@/lib/api';
import { toastError } from '@/lib/forms';
import { relative } from '@/utils/format';
import { generateTemporaryPassword } from './permissionGroups';
import { TemporaryPasswordNotice } from './StaffPage';

export interface PortalLogin {
  userId: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

interface Props {
  kind: 'student' | 'trainer';
  recordId: string;
  name: string;
  email: string | null;
  portal: PortalLogin | null;
  /** Query keys to refresh after a change. */
  invalidate: readonly (readonly unknown[])[];
  /** Render without the card chrome (inside a table row menu, a drawer...). */
  bare?: boolean;
}

export function PortalAccessCard({ kind, recordId, name, email, portal, invalidate, bare }: Props) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [issuing, setIssuing] = useState<{ password: string; mode: 'grant' | 'reset'; done: boolean } | null>(null);
  const [revoking, setRevoking] = useState(false);
  const label = kind === 'student' ? 'Student portal' : 'Faculty login';
  const refresh = () => invalidate.forEach((key) => void queryClient.invalidateQueries({ queryKey: key }));

  const issue = useMutation({
    mutationFn: ({ password, mode }: { password: string; mode: 'grant' | 'reset' }) =>
      mode === 'grant'
        ? api.post(`/portal-access/${kind === 'student' ? 'students' : 'trainers'}/${recordId}`, { temporaryPassword: password })
        : api.post(`/users/${portal!.userId}/reset-password`, { temporaryPassword: password }),
    onSuccess: () => {
      setIssuing((current) => (current ? { ...current, done: true } : current));
      refresh();
    },
    onError: (error) => toastError(error),
  });

  const revoke = useMutation({
    mutationFn: () => api.post(`/portal-access/${portal!.userId}/revoke`),
    onSuccess: () => {
      toast.success(`${label} switched off`);
      setRevoking(false);
      refresh();
    },
    onError: (error) => toastError(error),
  });

  if (!can('portal:manage')) return null;

  const active = portal?.isActive ?? false;
  const body = (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {active ? <StatusBadge status="active" label="Can sign in" /> : portal ? <StatusBadge status="cancelled" label="Switched off" /> : <StatusBadge status="pending" label="No login yet" />}
        {active && <span className="text-fg-subtle">{portal?.lastLoginAt ? `Last sign-in ${relative(portal.lastLoginAt)}` : 'Has not signed in yet'}</span>}
      </div>
      {!email && <p className="text-fg-muted">Add an email address to {name}'s record first: it is their sign-in name.</p>}
      {email && !portal && kind === 'student' && <p className="text-fg-muted">Students can also activate it themselves from the sign-in page with {email}.</p>}
      <div className="flex flex-wrap gap-2">
        {!active && (
          <Button size="sm" disabled={!email} onClick={() => setIssuing({ password: generateTemporaryPassword(), mode: 'grant', done: false })}>
            <LogIn aria-hidden className="size-4" /> {portal ? 'Switch back on' : 'Give a login'}
          </Button>
        )}
        {active && can('users:write') && (
          <Button size="sm" variant="secondary" onClick={() => setIssuing({ password: generateTemporaryPassword(), mode: 'reset', done: false })}>
            <KeyRound aria-hidden className="size-4" /> New temporary password
          </Button>
        )}
        {active && (
          <Button size="sm" variant="ghost" onClick={() => setRevoking(true)}>
            <UserX aria-hidden className="size-4" /> Switch off
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <>
      {bare ? (
        body
      ) : (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{label}</CardTitle>
              <CardDescription>{kind === 'student' ? 'Classes, attendance, exams, fees and certificates, for this student only.' : 'Their batches, schedule, attendance, exams and material.'}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>{body}</CardContent>
        </Card>
      )}

      <DialogRoot open={Boolean(issuing)} onOpenChange={(open) => !open && setIssuing(null)}>
        <DialogContent
          title={issuing?.mode === 'reset' ? `New temporary password for ${name}` : `${label} for ${name}`}
          description={`They will sign in with ${email ?? 'their email'} using this password.`}
          size="sm"
          footer={
            issuing?.done ? (
              <Button onClick={() => setIssuing(null)}>Done</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setIssuing(null)}>Cancel</Button>
                <Button loading={issue.isPending} onClick={() => issuing && issue.mutate(issuing)}>{issuing?.mode === 'reset' ? 'Save password' : 'Create login'}</Button>
              </>
            )
          }
        >
          {issuing && (
            <div className="space-y-3">
              {!issuing.done ? (
                <>
                  <label className="block text-sm font-medium text-fg">Password</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 rounded border bg-surface px-3 py-1.5 font-mono text-sm text-fg"
                      value={issuing.password}
                      onChange={(e) => setIssuing({ ...issuing, password: e.target.value })}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setIssuing({ ...issuing, password: generateTemporaryPassword() })}
                    >
                      Generate
                    </Button>
                  </div>
                  <p className="text-xs text-fg-muted">Minimum 10 characters, including letters and numbers.</p>
                </>
              ) : (
                <TemporaryPasswordNotice password={issuing.password} name={name} />
              )}
            </div>
          )}
        </DialogContent>
      </DialogRoot>

      <ConfirmDialog
        open={revoking}
        onOpenChange={setRevoking}
        title={`Switch off ${name}'s login?`}
        description="They are signed out everywhere at once. Their records stay; you can switch it back on later."
        tone="danger"
        confirmLabel="Switch off"
        loading={revoke.isPending}
        onConfirm={() => revoke.mutate()}
      />
    </>
  );
}
