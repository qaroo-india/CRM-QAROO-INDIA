import { LoaderCircle, RefreshCw, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ApiRequestError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-sm text-fg-muted', className)}>
      <LoaderCircle aria-hidden className="size-4 animate-spin" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

/** Shown when a list legitimately has nothing yet -- always with a next step. */
export function EmptyState({ icon: Icon, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-2 py-8' : 'gap-3 py-14', className)}>
      {Icon && (
        <span className="relative grid size-11 place-items-center rounded-2xl border bg-surface-raised text-primary">
          <span aria-hidden className="orbit-ring" />
          <Icon aria-hidden className="size-5" />
        </span>
      )}
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-semibold text-fg">{title}</p>
        {description && <p className="text-sm text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  title?: string;
  className?: string;
}

/** A failed load, with the server's message and request id when available. */
export function ErrorState({ error, onRetry, retrying, title = 'Could not load this', className }: ErrorStateProps) {
  const apiError = error as Partial<ApiRequestError> | undefined;
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center gap-3 py-12 text-center', className)}>
      <span className="grid size-11 place-items-center rounded-2xl border border-danger/30 bg-danger-soft text-danger">
        <TriangleAlert aria-hidden className="size-5" />
      </span>
      <div className="max-w-md space-y-1">
        <p className="text-sm font-semibold text-fg">{title}</p>
        <p className="text-sm text-fg-muted">{message}</p>
        {apiError?.requestId && (
          <p className="text-xs text-fg-subtle">
            Request ID <span className="font-mono">{apiError.requestId}</span>
          </p>
        )}
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} loading={retrying}>
          {!retrying && <RefreshCw aria-hidden className="size-3.5" />}
          Try again
        </Button>
      )}
    </div>
  );
}

/** Full-area loading placeholder for a page section. */
export function LoadingBlock({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div aria-busy="true" className={cn('grid place-items-center py-16 animate-fade-in [animation-delay:150ms]', className)}>
      <span className="inline-flex flex-col items-center gap-3 text-sm text-fg-muted">
        <span aria-hidden className="orbit-loader" />
        {label}
      </span>
    </div>
  );
}
