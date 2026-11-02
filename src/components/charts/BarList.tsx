/**
 * Ranked horizontal bars for "magnitude by category" (expenses by category,
 * admissions by source). One series, so one hue (slot 1); sorted descending;
 * every value is printed beside its bar, so nothing depends on colour or a
 * tooltip (dataviz: direct labels satisfy the contrast-relief rule).
 */

import { cn } from '@/lib/cn';

export interface BarItem {
  key: string;
  label: string;
  value: number;
  /** Formatted value shown at the bar end. */
  display: string;
  href?: string;
  secondary?: string;
}

export function BarList({ items, emptyText = 'No data in this period', className }: { items: BarItem[]; emptyText?: string; className?: string }) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-fg-subtle">{emptyText}</p>;
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const max = Math.max(...sorted.map((i) => i.value), 1);
  return (
    <ul className={cn('space-y-2.5', className)}>
      {sorted.map((item) => {
        const pct = Math.max(1.5, (item.value / max) * 100);
        const body = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-fg">{item.label}</span>
              <span className="shrink-0 text-fg tabular-nums">
                {item.display}
                {item.secondary && <span className="ml-1.5 text-xs text-fg-subtle">{item.secondary}</span>}
              </span>
            </div>
            <div className="h-2 rounded-full bg-surface-sunken" aria-hidden>
              <div className="h-2 rounded-full bg-series-1 transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
            </div>
          </>
        );
        return (
          <li key={item.key}>
            {item.href ? (
              <a href={item.href} className="block rounded-md transition-colors hover:bg-surface-raised">
                {body}
              </a>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
