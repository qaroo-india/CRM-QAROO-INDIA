import { cn } from '@/lib/cn';

export type StatusDotTone = 'success' | 'warning' | 'danger' | 'neutral';

const TONES: Record<StatusDotTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-fg-subtle',
};

interface StatusDotProps {
  tone: StatusDotTone;
  /** A slow ripple signalling "live". Suppressed automatically under reduced motion. */
  pulse?: boolean;
  className?: string;
}

/** Decorative indicator: always pair it with a visible text status. */
export function StatusDot({ tone, pulse = false, className }: StatusDotProps) {
  return (
    <span aria-hidden className={cn('relative inline-flex size-2.5', className)}>
      {pulse && (
        <span className={cn('absolute inset-0 rounded-full animate-pulse-ring motion-reduce:hidden', TONES[tone])} />
      )}
      <span className={cn('relative inline-flex size-full rounded-full', TONES[tone])} />
    </span>
  );
}
