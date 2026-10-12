/**
 * KPI stat tile, following the dataviz figure contract:
 *   label (sentence case) · value (semibold, compacted, proportional figures)
 *   · delta (signed, vs a named period, colour = direction x whether up is good,
 *     always with an arrow and sign so colour never carries it alone)
 *   · optional 12-point sparkline in the de-emphasis grey with the current
 *     point in the accent.
 * A tooltip explains the metric; the whole tile links to the underlying rows.
 */

import { ArrowDownRight, ArrowUpRight, Info, Minus, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/cn';
import { percent } from '@/utils/format';
import { Tooltip } from './Menu';
import { Skeleton } from './Skeleton';

export interface StatDelta {
  current: number;
  previous: number;
  /** Is a rise good news (collections) or bad news (overdue)? */
  upIsGood?: boolean;
  /** "vs previous month" */
  label: string;
}

interface StatCardProps {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  delta?: StatDelta;
  sparkline?: number[];
  /** Plain-language definition shown in the info tooltip. */
  hint?: string;
  /** Drill-down to the filtered records. */
  to?: string;
  loading?: boolean;
  /** Refetching: hold the previous value, dimmed, instead of flashing a skeleton. */
  stale?: boolean;
  className?: string;
}

function DeltaBadge({ delta }: { delta: StatDelta }) {
  const { current, previous, upIsGood = true, label } = delta;
  if (previous === 0 && current === 0) {
    return <span className="inline-flex items-center gap-1 text-xs text-fg-subtle"><Minus aria-hidden className="size-3" />No change {label}</span>;
  }
  if (previous === 0) {
    return <span className="text-xs text-fg-subtle">New {label}</span>;
  }
  const change = (current - previous) / Math.abs(previous);
  const up = change > 0;
  const flat = Math.abs(change) < 0.0005;
  const good = flat ? null : up === upIsGood;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 text-xs">
      <span className={cn('inline-flex items-center gap-0.5 font-medium', good === true && 'text-success', good === false && 'text-danger', good === null && 'text-fg-muted')}>
        <Icon aria-hidden className="size-3.5" />
        {flat ? '0%' : `${up ? '+' : '−'}${percent(Math.abs(change))}`}
      </span>
      <span className="text-fg-subtle">{label}</span>
    </span>
  );
}

/** Tiny trend line. Decorative: the value and delta carry the information. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const width = 96;
  const height = 28;
  const pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((v, i) => {
    const x = pad + (i * (width - pad * 2)) / (values.length - 1);
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const last = points[points.length - 1]!;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn('h-7 w-24 overflow-visible', className)} aria-hidden>
      <polyline
        points={points.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none"
        stroke="var(--color-chart-deemphasis)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r={4} fill="var(--color-series-1)" stroke="var(--color-surface)" strokeWidth={2} />
    </svg>
  );
}

export function StatCard({ label, value, icon: Icon, delta, sparkline, hint, to, loading, stale, className }: StatCardProps) {
  const body = (
    <div className={cn('flex h-full flex-col gap-3 p-4 transition-opacity duration-200', stale && 'opacity-60')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <p className="text-sm text-fg-muted">{label}</p>
          {hint && (
            <Tooltip content={hint}>
              <button
                type="button"
                className="relative z-10 text-fg-subtle transition-colors hover:text-fg"
                aria-label={`About ${label}`}
              >
                <Info aria-hidden className="size-3.5" />
              </button>
            </Tooltip>
          )}
        </div>
        {Icon && (
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-surface-raised text-fg-muted">
            <Icon aria-hidden className="size-4" />
          </span>
        )}
      </div>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3.5 w-36" />
        </div>
      ) : (
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <p className="truncate text-2xl font-semibold tracking-tight text-fg">{value}</p>
            {delta && <DeltaBadge delta={delta} />}
          </div>
          {sparkline && <Sparkline values={sparkline} />}
        </div>
      )}
    </div>
  );

  // Stretched link: the overlay link covers the tile while the info button
  // sits above it, so no interactive element is nested inside another.
  return (
    <div
      className={cn(
        'relative rounded-card border bg-surface shadow-card transition-[border-color,box-shadow,transform] duration-200',
        to && 'hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow has-[a:focus-visible]:border-primary/60',
        className,
      )}
    >
      {body}
      {to && (
        <Link to={to} className="absolute inset-0 rounded-card focus-visible:outline-offset-0">
          <span className="sr-only">{label}: view records</span>
        </Link>
      )}
    </div>
  );
}
