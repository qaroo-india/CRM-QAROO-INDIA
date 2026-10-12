import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Shared control styling: inputs, selects and textareas look identical. */
export const controlClass =
  'w-full rounded-control border border-border-strong bg-surface-sunken text-sm text-fg placeholder:text-fg-subtle ' +
  'transition-[border-color,box-shadow] duration-150 outline-none ' +
  'hover:border-fg-subtle/60 focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20 ' +
  'disabled:cursor-not-allowed disabled:opacity-60 ' +
  'aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/20';

export interface InputProps extends ComponentProps<'input'> {
  /** Icon or text shown inside the left edge (e.g. a search icon, "₹"). */
  leading?: ReactNode;
  trailing?: ReactNode;
}

export function Input({ className, leading, trailing, ...props }: InputProps) {
  if (!leading && !trailing) {
    return <input className={cn(controlClass, 'h-10 px-3', className)} {...props} />;
  }
  return (
    <div className="relative">
      {leading && (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-fg-subtle">
          {leading}
        </span>
      )}
      <input
        className={cn(controlClass, 'h-10 px-3', leading && 'pl-9', trailing && 'pr-10', className)}
        {...props}
      />
      {trailing && <span className="absolute inset-y-0 right-2 flex items-center">{trailing}</span>}
    </div>
  );
}

export function Textarea({ className, rows = 3, ...props }: ComponentProps<'textarea'>) {
  return <textarea rows={rows} className={cn(controlClass, 'min-h-20 px-3 py-2 leading-relaxed', className)} {...props} />;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<ComponentProps<'select'>, 'children'> {
  options: readonly SelectOption[];
  /** Adds an empty first option, e.g. "All courses" or "Select…". */
  placeholder?: string;
}

/**
 * Native select, styled. Native keeps full keyboard, screen-reader and mobile
 * picker support for free -- important for staff entering data on phones.
 */
export function Select({ className, options, placeholder, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        controlClass,
        'h-10 appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-8 pl-3',
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
        className,
      )}
      {...props}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
