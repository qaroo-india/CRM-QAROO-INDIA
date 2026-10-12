import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'violet';

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-border-strong bg-surface-raised text-fg-muted',
  primary: 'border-primary/30 bg-primary-soft text-primary',
  success: 'border-success/30 bg-success-soft text-success',
  warning: 'border-warning/30 bg-warning-soft text-warning',
  danger: 'border-danger/30 bg-danger-soft text-danger',
  violet: 'border-violet/30 bg-violet/10 text-violet',
};

export interface BadgeProps extends ComponentProps<'span'> {
  tone?: BadgeTone;
  /** Leading status dot. Colour alone never carries meaning -- keep a text label. */
  dot?: boolean;
}

export function Badge({ tone = 'neutral', dot = false, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
      {...props}
    >
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
