/**
 * Modal dialog and side drawer, on Radix Dialog: focus is trapped inside,
 * Escape closes, focus returns to the trigger, and the background is inert
 * to screen readers.
 */

import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const DialogRoot = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const SIZES = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const;

interface ContentProps {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof SIZES;
  className?: string;
  /** Prevent closing by clicking outside (forms with unsaved input). */
  dismissible?: boolean;
}

function Overlay() {
  return (
    <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px] data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in" />
  );
}

export function DialogContent({ title, description, children, footer, size = 'md', className, dismissible = true }: ContentProps) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        onInteractOutside={dismissible ? undefined : (event) => event.preventDefault()}
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[min(90dvh,860px)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col',
          'rounded-card border bg-surface shadow-card outline-none',
          'data-[state=closed]:animate-dialog-out data-[state=open]:animate-dialog-in',
          SIZES[size],
          className,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="space-y-1">
            <DialogPrimitive.Title className="text-base font-semibold tracking-tight text-fg">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-sm text-fg-muted">{description}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="-mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
            aria-label="Close"
          >
            <X aria-hidden className="size-4" />
          </DialogPrimitive.Close>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3">{footer}</footer>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

interface DrawerProps extends ContentProps {
  side?: 'right' | 'left';
  width?: 'md' | 'lg' | 'xl';
}

const DRAWER_WIDTHS = { md: 'sm:max-w-md', lg: 'sm:max-w-xl', xl: 'sm:max-w-3xl' } as const;

/** Side sheet for detail views and longer forms, keeping the list visible. */
export function DrawerContent({ title, description, children, footer, side = 'right', width = 'lg', className, dismissible = true }: DrawerProps) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        onInteractOutside={dismissible ? undefined : (event) => event.preventDefault()}
        className={cn(
          'fixed inset-y-0 z-50 flex w-full flex-col border-border bg-surface shadow-card outline-none',
          side === 'right'
            ? 'right-0 border-l data-[state=closed]:animate-drawer-out data-[state=open]:animate-drawer-in'
            : 'left-0 border-r data-[state=closed]:animate-drawer-left-out data-[state=open]:animate-drawer-left-in',
          DRAWER_WIDTHS[width],
          className,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0 space-y-1">
            <DialogPrimitive.Title className="truncate text-base font-semibold tracking-tight text-fg">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-sm text-fg-muted">{description}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="-mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
            aria-label="Close"
          >
            <X aria-hidden className="size-4" />
          </DialogPrimitive.Close>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3">{footer}</footer>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
