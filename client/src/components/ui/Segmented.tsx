/**
 * Segmented tab bar: a row of view switches with a highlight that slides to
 * the selected item. Used for page views (List / Board, Mine / Team...).
 *
 *   <SegmentedList label="Lead views" className="mb-4 inline-flex gap-1 rounded-control border bg-surface p-1">
 *     <SegmentedItem selected={view === 'list'} onClick={() => setView('list')}>List</SegmentedItem>
 *   </SegmentedList>
 */

import { motion } from 'motion/react';
import { createContext, use, useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

const GroupContext = createContext<string>('segmented');

export function SegmentedList({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const id = useId();
  return (
    <GroupContext value={id}>
      <div role="tablist" aria-label={label} className={cn('relative', className)}>
        {children}
      </div>
    </GroupContext>
  );
}

interface SegmentedItemProps extends Omit<ComponentProps<'button'>, 'type' | 'role'> {
  selected: boolean;
}

export function SegmentedItem({ selected, className, children, ...props }: SegmentedItemProps) {
  const group = use(GroupContext);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={cn(
        'relative inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap',
        'transition-colors duration-200',
        selected ? 'text-primary' : 'text-fg-muted hover:bg-surface-raised/60 hover:text-fg',
        className,
      )}
      {...props}
    >
      {selected && (
        <motion.span
          layoutId={`${group}-pill`}
          aria-hidden
          className="absolute inset-0 rounded-lg bg-primary-soft ring-1 ring-primary/15"
          transition={{ type: 'spring', bounce: 0.18, duration: 0.38 }}
        />
      )}
      <span className="relative inline-flex items-center gap-1.5">{children}</span>
    </button>
  );
}
