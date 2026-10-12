import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface FieldProps {
  label: ReactNode;
  /** The single control to label. Receives id, aria-invalid and aria-describedby. */
  children: ReactElement<Record<string, unknown>>;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  /** Visually hide the label but keep it for screen readers. */
  hideLabel?: boolean;
}

/**
 * Label + control + hint + error, wired for assistive technology: the label
 * targets the control, and the hint/error are announced with it.
 */
export function Field({ label, children, hint, error, required, className, hideLabel }: FieldProps) {
  const generatedId = useId();
  const childId = isValidElement(children) && typeof children.props.id === 'string' ? children.props.id : generatedId;
  const hintId = hint ? `${childId}-hint` : undefined;
  const errorId = error ? `${childId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const control = isValidElement(children)
    ? cloneElement(children, {
        id: childId,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
        'aria-required': required || undefined,
      })
    : children;

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={childId} className={cn('block text-sm font-medium text-fg', hideLabel && 'sr-only')}>
        {label}
        {required && (
          <span aria-hidden className="ml-0.5 text-danger">
            *
          </span>
        )}
      </label>
      {control}
      {hint && !error && (
        <p id={hintId} className="text-xs text-fg-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Group heading inside long forms. */
export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-1">
        <span className="text-sm font-semibold text-fg">{title}</span>
        {description && <span className="mt-0.5 block text-xs text-fg-muted">{description}</span>}
      </legend>
      {children}
    </fieldset>
  );
}
