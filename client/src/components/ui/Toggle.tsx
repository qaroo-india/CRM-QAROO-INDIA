import { Check } from 'lucide-react';
import { Checkbox as CheckboxPrimitive, Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface CheckboxProps extends Omit<ComponentProps<typeof CheckboxPrimitive.Root>, 'children'> {
  label?: ReactNode;
  description?: ReactNode;
}

export function Checkbox({ label, description, className, id, ...props }: CheckboxProps) {
  const box = (
    <CheckboxPrimitive.Root
      id={id}
      className={cn(
        'peer grid size-4.5 shrink-0 place-items-center rounded-[5px] border border-border-strong bg-surface-sunken',
        'transition-colors duration-150 data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        'data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="text-primary-fg">
        {props.checked === 'indeterminate' ? (
          <span className="block h-0.5 w-2.5 rounded bg-current" />
        ) : (
          <Check aria-hidden className="size-3.5" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );

  if (!label) return box;
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5">
      <span className="mt-0.5">{box}</span>
      <span className="space-y-0.5">
        <span className="block text-sm text-fg">{label}</span>
        {description && <span className="block text-xs text-fg-muted">{description}</span>}
      </span>
    </label>
  );
}

interface SwitchProps extends ComponentProps<typeof SwitchPrimitive.Root> {
  label?: ReactNode;
  description?: ReactNode;
}

export function Switch({ label, description, className, id, ...props }: SwitchProps) {
  const control = (
    <SwitchPrimitive.Root
      id={id}
      className={cn(
        'relative inline-flex h-5.5 w-10 shrink-0 cursor-pointer items-center rounded-full border border-border-strong bg-surface-sunken',
        'transition-colors duration-200 data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'block size-4 translate-x-0.5 rounded-full bg-fg-muted shadow transition-transform duration-200',
          'data-[state=checked]:translate-x-[1.15rem] data-[state=checked]:bg-primary-fg',
        )}
      />
    </SwitchPrimitive.Root>
  );
  if (!label) return control;
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="space-y-0.5">
        <span className="block text-sm font-medium text-fg">{label}</span>
        {description && <span className="block text-xs text-fg-muted">{description}</span>}
      </label>
      {control}
    </div>
  );
}
