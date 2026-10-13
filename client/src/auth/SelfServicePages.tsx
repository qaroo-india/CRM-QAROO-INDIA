/**
 * Signed-out self-service: forgot password, set a password from an emailed
 * link (reset or activation), student activation, and the public
 * certificate check.
 */

import { passwordSchema, type CertificateVerification } from '@ims/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BadgeCheck, CircleCheck, CircleX, LockKeyhole, Mail, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { api, ApiRequestError } from '@/lib/api';
import { date } from '@/utils/format';
import { AuthLayout } from './AuthLayout';

function Heading({ title, text }: { title: string; text: string }) {
  return (
    <div className="space-y-1.5">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
      <p className="text-sm text-fg-muted">{text}</p>
    </div>
  );
}

function BackToSignIn() {
  return (
    <p className="text-center text-sm">
      <Link to="/login" className="text-primary hover:underline">Back to sign in</Link>
    </p>
  );
}

function Notice({ tone, children }: { tone: 'success' | 'danger'; children: React.ReactNode }) {
  const Icon = tone === 'success' ? CircleCheck : CircleX;
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`flex gap-2 rounded-control border px-3 py-2.5 text-sm ${tone === 'success' ? 'border-success/35 bg-success-soft text-fg' : 'border-danger/35 bg-danger-soft text-danger'}`}>
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${tone === 'success' ? 'text-success' : ''}`} />
      <div>{children}</div>
    </div>
  );
}

/** Request a link by email. The answer is the same whether or not the address exists. */
function EmailLinkPage({ kind }: { kind: 'reset' | 'activate' }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => api.post(kind === 'reset' ? '/auth/forgot-password' : '/auth/activate', { email }),
    onError: (e) => setError(e instanceof ApiRequestError ? (e.fields?.[0]?.message ?? e.message) : 'Could not send. Please try again.'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    send.mutate();
  };
  return (
    <AuthLayout>
      <Heading
        title={kind === 'reset' ? 'Forgot your password?' : 'Activate your student portal'}
        text={kind === 'reset' ? 'Enter your email and we will send you a link to choose a new password.' : 'Use the email address you gave the institute at admission. We will email you a link to set your password.'}
      />
      {send.isSuccess ? (
        <Notice tone="success">
          If <strong>{email}</strong> {kind === 'reset' ? 'belongs to an account' : 'is on a student record with an admission'}, a link is on its way. It works once and expires in {kind === 'reset' ? '30 minutes' : '24 hours'}. Check your spam folder too.
        </Notice>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Email" required>
            <Input type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} leading={<Mail aria-hidden className="size-4" />} />
          </Field>
          <Button type="submit" className="w-full" loading={send.isPending} disabled={!email.trim()}>
            Send link
          </Button>
        </form>
      )}
      <BackToSignIn />
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  return <EmailLinkPage kind="reset" />;
}

export function ActivatePage() {
  return <EmailLinkPage kind="activate" />;
}

/** Landing page of an emailed link: choose the new password. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const activating = params.get('activate') === '1';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.post<{ email: string }>('/auth/reset-password', { token, newPassword: password }),
    onSuccess: (r) => navigate(`/login?reset=1&email=${encodeURIComponent(r.email)}${activating ? '&as=student' : ''}`, { replace: true }),
    onError: (e) => setError(e instanceof ApiRequestError ? (e.fields?.[0]?.message ?? e.message) : 'Could not save. Please try again.'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const check = passwordSchema.safeParse(password);
    if (!check.success) return setError(check.error.issues[0]!.message);
    if (password !== confirm) return setError('The two passwords do not match.');
    setError(null);
    save.mutate();
  };
  return (
    <AuthLayout>
      <Heading title={activating ? 'Set your portal password' : 'Choose a new password'} text="At least 10 characters, with a letter and a number. You will sign in with it next." />
      {!token ? (
        <Notice tone="danger">This link is incomplete. Open it again from your email, or request a new one.</Notice>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="New password" required>
            <Input type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} leading={<LockKeyhole aria-hidden className="size-4" />} />
          </Field>
          <Field label="Repeat the password" required>
            <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} leading={<LockKeyhole aria-hidden className="size-4" />} />
          </Field>
          <Button type="submit" className="w-full" loading={save.isPending}>
            Save password
          </Button>
        </form>
      )}
      <p className="text-center text-sm">
        <Link to={activating ? '/activate' : '/forgot-password'} className="text-primary hover:underline">Request a new link</Link>
      </p>
    </AuthLayout>
  );
}

/** Public: anyone (an employer) can check a certificate reference. */
export function VerifyCertificatePage() {
  const { reference: initial } = useParams();
  const navigate = useNavigate();
  const [reference, setReference] = useState(initial ?? '');
  const check = useQuery({
    queryKey: ['verify', initial],
    queryFn: () => api.get<CertificateVerification>(`/verify/certificates/${encodeURIComponent(initial!)}`),
    enabled: Boolean(initial),
    retry: false,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (reference.trim()) navigate(`/verify/${encodeURIComponent(reference.trim().toUpperCase())}`);
  };
  const result = check.data;
  return (
    <AuthLayout>
      <Heading title="Verify a certificate" text="Enter the reference printed on the certificate, e.g. CERT-2026-00012." />
      <form onSubmit={submit} className="flex gap-2">
        <Input aria-label="Certificate reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="CERT-2026-00012" leading={<Search aria-hidden className="size-4" />} />
        <Button type="submit" loading={check.isFetching}>Check</Button>
      </form>
      {check.isError && <Notice tone="danger">{check.error instanceof Error ? check.error.message : 'Could not check right now.'}</Notice>}
      {result &&
        (result.valid ? (
          <div className="rounded-card border border-success/35 bg-success-soft p-4 text-sm">
            <p className="mb-2 flex items-center gap-2 font-semibold text-fg"><BadgeCheck aria-hidden className="size-5 text-success" /> Genuine certificate</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-fg-muted">Student</dt><dd className="text-fg">{result.studentName}</dd>
              <dt className="text-fg-muted">Course</dt><dd className="text-fg">{result.courseName}</dd>
              <dt className="text-fg-muted">Issued</dt><dd className="text-fg">{date(result.issuedOn)}</dd>
              <dt className="text-fg-muted">By</dt><dd className="text-fg">{result.institute}</dd>
              <dt className="text-fg-muted">Reference</dt><dd className="font-mono text-fg">{result.referenceNumber}</dd>
            </dl>
          </div>
        ) : (
          <Notice tone="danger">No issued certificate has the reference <strong>{result.referenceNumber}</strong>. Check for typing mistakes.</Notice>
        ))}
      <BackToSignIn />
    </AuthLayout>
  );
}
