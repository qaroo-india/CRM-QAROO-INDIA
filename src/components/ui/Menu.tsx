/**
 * Dropdown menu, tabs, tooltip and popover -- thin styled wrappers over Radix,
 * which supplies keyboard navigation, focus management and ARIA roles.
 */

import { DropdownMenu as MenuPrimitive, Popover as PopoverPrimitive, Tabs as TabsPrimitive, Tooltip as TooltipPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

const floatingSurface =
  'glass z-50 rounded-xl border p-1 outline-none data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in';

/* ------------------------------------------------------------------ *
 * Dropdown menu
 * ------------------------------------------------------------------ */

export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;

export function MenuContent({ className, align = 'end', sideOffset = 6, ...props }: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content align={align} sideOffset={sideOffset} className={cn(floatingSurface, 'min-w-52', className)} {...props} />
    </MenuPrimitive.Portal>
  );
}

interface MenuItemProps extends ComponentProps<typeof MenuPrimitive.Item> {
  icon?: ReactNode;
  tone?: 'default' | 'danger';
  shortcut?: string;
}

export function MenuItem({ className, icon, tone = 'default', shortcut, children, ...props }: MenuItemProps) {
  return (
    <MenuPrimitive.Item
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none select-none',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        tone === 'danger'
          ? 'text-danger data-[highlighted]:bg-danger-soft'
          : 'text-fg data-[highlighted]:bg-surface-sunken data-[highlighted]:text-fg',
        className,
      )}
      {...props}
    >
      {icon && <span className="grid size-4 place-items-center text-fg-muted [&>svg]:size-4">{icon}</span>}
      <span className="flex-1">{children}</span>
      {shortcut && <span className="font-mono text-[11px] text-fg-subtle">{shortcut}</span>}
    </MenuPrimitive.Item>
  );
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
  return <MenuPrimitive.Label className={cn('px-2.5 py-1.5 text-xs text-fg-subtle', className)} {...props} />;
}

export function MenuSeparator() {
  return <MenuPrimitive.Separator className="my-1 h-px bg-border" />;
}

/* ------------------------------------------------------------------ *
 * Tabs
 * ------------------------------------------------------------------ */

export const Tabs = TabsPrimitive.Root;
export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('data-[state=active]:animate-fade-in', className)} {...props} />;
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('-mb-px flex gap-1 overflow-x-auto border-b [scrollbar-width:none]', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'relative shrink-0 px-3 py-2.5 text-sm font-medium whitespace-nowrap text-fg-muted transition-colors duration-200',
        'hover:text-fg data-[state=active]:text-fg',
        // The underline grows out from the centre when a tab becomes active.
        'after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:origin-center after:scale-x-0 after:rounded-full after:bg-primary after:transition-transform after:duration-300 after:ease-out-expo data-[state=active]:after:scale-x-100',
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Tooltip
 * ------------------------------------------------------------------ */

export const TooltipProvider = TooltipPrimitive.Provider;

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Render nothing extra when there is no tooltip text. */
  disabled?: boolean;
}

export function Tooltip({ content, children, side = 'top', disabled }: TooltipProps) {
  if (disabled || !content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="glass z-50 max-w-xs rounded-lg border px-2.5 py-1.5 text-xs leading-relaxed text-fg data-[state=closed]:animate-pop-out data-[state=delayed-open]:animate-pop-in"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ------------------------------------------------------------------ *
 * Popover
 * ------------------------------------------------------------------ */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({ className, align = 'start', sideOffset = 6, ...props }: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content align={align} sideOffset={sideOffset} className={cn(floatingSurface, 'p-3', className)} {...props} />
    </PopoverPrimitive.Portal>
  );
}
