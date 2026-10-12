import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/** Shimmering placeholder shaped like the content it stands in for. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div aria-hidden className={cn('skeleton rounded-md', className)} {...props} />;
}
