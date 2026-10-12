import { useState, type ReactNode } from 'react';
import { Button } from './Button';
import { DialogContent, DialogRoot } from './Dialog';
import { Field } from './Field';
import { Textarea } from './Input';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: 'default' | 'danger';
  /** Require a written reason (reversals, voids, cancellations). */
  requireReason?: boolean;
  reasonLabel?: string;
  loading?: boolean;
  onConfirm: (reason: string) => void;
  children?: ReactNode;
}

/**
 * Confirmation for destructive or financial actions. When a reason is
 * required, the confirm button stays disabled until one is written -- the
 * reason ends up in the audit trail.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'default',
  requireReason = false,
  reasonLabel = 'Reason',
  loading = false,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  const blocked = requireReason && trimmed.length < 3;

  return (
    <DialogRoot
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason('');
        onOpenChange(next);
      }}
    >
      <DialogContent
        title={title}
        description={description}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button variant={tone === 'danger' ? 'danger' : 'primary'} disabled={blocked} loading={loading} onClick={() => onConfirm(trimmed)}>
              {confirmLabel}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {children}
          {requireReason && (
            <Field label={reasonLabel} required hint="Recorded in the audit history.">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
            </Field>
          )}
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
