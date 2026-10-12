import type { ReportJobDto } from '@ims/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { DialogContent, DialogRoot } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { api, ApiRequestError } from '@/lib/api';
import { toastError } from '@/lib/forms';
import { useEmailStatus } from './api';

export const splitEmails = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);

/** Says plainly when "sent" would not actually leave the server. */
export function EmailTransportNotice() {
  const status = useEmailStatus();
  if (!status.data || status.data.delivers) return null;
  return (
    <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-fg">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
      {status.data.transport === 'log'
        ? 'Development mode: emails are written to the server log and NOT delivered. Configure SMTP (EMAIL_TRANSPORT=smtp) to send real email.'
        : 'Email is disabled on this server (EMAIL_TRANSPORT=disabled). Sending will be recorded as failed.'}
    </p>
  );
}

export function EmailDialog({ open, onOpenChange, query, label }: { open: boolean; onOpenChange: (open: boolean) => void; query: Record<string, unknown>; label: string }) {
  const { institute } = useAuth();
  const queryClient = useQueryClient();
  const [recipients, setRecipients] = useState('');
  const [format, setFormat] = useState<'pdf' | 'excel'>('pdf');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setRecipients((institute?.reportRecipients ?? []).join(', '));
      setSubject('');
      setMessage('');
      setErrors({});
    }
  }, [open, institute]);

  const send = useMutation({
    mutationFn: () => api.post<ReportJobDto>('/reports/email', { ...query, format, recipients: splitEmails(recipients), subject: subject || undefined, message: message || undefined }),
    onSuccess: (job) => {
      void queryClient.invalidateQueries({ queryKey: ['reports', 'jobs'] });
      const delivery = job.deliveries[0];
      if (delivery?.status === 'sent') {
        if (delivery.transport === 'log') toast.warning('Recorded, but NOT delivered: the server is in development email mode.');
        else toast.success(`Report sent to ${delivery.recipients.join(', ')}`);
        onOpenChange(false);
      } else {
        toast.error(`Email failed: ${delivery?.lastError ?? 'unknown error'}. You can retry from History.`);
        onOpenChange(false);
      }
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.fields?.length) {
        setErrors(Object.fromEntries(error.fields.map((f) => [f.path.split('.')[0]!, f.message])));
      } else toastError(error);
    },
  });

  const count = splitEmails(recipients).length;
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Email this report"
        description={label}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={send.isPending} disabled={count === 0} onClick={() => send.mutate()}>
              Send to {count || '…'} recipient{count === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <EmailTransportNotice />
          <Field label="Recipients" hint="Separate addresses with commas. Defaults come from Settings → Reports." error={errors.recipients} required>
            <Textarea rows={2} value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="director@institute.com, accounts@institute.com" />
          </Field>
          <Field label="Attach as">
            <Select value={format} onChange={(e) => setFormat(e.target.value as 'pdf' | 'excel')} options={[{ value: 'pdf', label: 'PDF (for reading)' }, { value: 'excel', label: 'Excel (for analysis)' }]} />
          </Field>
          <Field label="Subject" hint="Leave blank for the default." error={errors.subject}>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
          </Field>
          <Field label="Message" error={errors.message}>
            <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
          </Field>
          <p className="text-xs text-fg-subtle">The email includes the headline figures; the attachment holds the full report with the same filters as this screen.</p>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
