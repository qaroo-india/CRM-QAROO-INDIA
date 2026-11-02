import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return <section data-spotlight="" className={cn('spotlight rounded-card border bg-surface shadow-card', className)} {...props} />;
}

export function CardHeader({ className, ...props }: ComponentProps<'header'>) {
  return <header className={cn('flex items-start justify-between gap-4 p-5 pb-0', className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 className={cn('text-sm font-semibold tracking-tight text-fg', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-fg-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-5', className)} {...props} />;
}
