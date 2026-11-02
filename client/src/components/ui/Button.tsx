import { LoaderCircle } from 'lucide-react';
import type { ComponentProps, PointerEvent } from 'react';
import { cn } from '@/lib/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'icon';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'shine bg-primary text-primary-fg hover:brightness-110 hover:shadow-glow',
  secondary:
    'border border-border-strong bg-surface-raised text-fg hover:border-primary/50 hover:bg-surface-sunken',
  ghost: 'text-fg-muted hover:bg-surface-raised hover:text-fg',
  danger: 'border border-danger/35 bg-danger-soft text-danger hover:border-danger/60',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  icon: 'size-9',
};

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets aria-busy and blocks repeat clicks while true. */
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  onPointerDown,
  ...props
}: ButtonProps) {
  // A ripple spreads from where the button was pressed.
  const ripple = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(event);
    if (event.button !== 0 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const button = event.currentTarget;
    const box = button.getBoundingClientRect();
    const size = Math.max(box.width, box.height) * 2.2;
    const dot = document.createElement('span');
    dot.className = 'ripple';
    dot.setAttribute('aria-hidden', 'true');
    dot.style.cssText = `width:${size}px;height:${size}px;left:${event.clientX - box.left}px;top:${event.clientY - box.top}px`;
    dot.addEventListener('animationend', () => dot.remove());
    button.appendChild(dot);
  };
  return (
    <button
      type={type}
      onPointerDown={ripple}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center gap-2 overflow-hidden rounded-control font-medium whitespace-nowrap select-none',
        'transition-[background-color,border-color,color,box-shadow,filter,transform] duration-200 ease-standard',
        'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
}
