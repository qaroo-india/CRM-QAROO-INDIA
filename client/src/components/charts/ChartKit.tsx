/**
 * Chart building blocks (Recharts) following the dataviz method:
 *   - colours come from the validated series tokens, assigned in fixed order
 *     and bound to the series identity (never its rank);
 *   - 2px lines, ~10% area fills, bars <= 24px with 4px rounded data ends,
 *     hairline solid gridlines, no dual axes;
 *   - a crosshair tooltip on lines (values lead, series keyed by a short
 *     stroke) and a per-bar tooltip on bars;
 *   - a legend whenever there are 2+ series;
 *   - every chart has a table view (WCAG twin; also required because three
 *     light-mode slots sit below 3:1 contrast);
 *   - refetching keeps the previous render, dimmed -- no skeleton flash.
 */

import { Table2, BarChart3 } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';

export const SERIES = ['var(--color-series-1)', 'var(--color-series-2)', 'var(--color-series-3)', 'var(--color-series-4)'] as const;

export interface SeriesDef<T> {
  key: keyof T & string;
  label: string;
  /** Index into the fixed series order; defaults to position. */
  slot?: number;
}

interface ChartCardProps {
  title: string;
  subtitle?: string;
  loading?: boolean;
  stale?: boolean;
  /** Rendered in table view. */
  table: ReactNode;
  children: ReactNode;
  className?: string;
  height?: number;
  action?: ReactNode;
}

export function ChartCard({ title, subtitle, loading, stale, table, children, className, height = 260, action }: ChartCardProps) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className={cn('flex flex-col', className)}>
      <header className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          {subtitle && <p className="text-xs text-fg-subtle">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1">
          {action}
          <button
            type="button"
            onClick={() => setAsTable((v) => !v)}
            aria-pressed={asTable}
            className="grid size-8 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-raised hover:text-fg"
            aria-label={asTable ? `Show ${title} as a chart` : `Show ${title} as a table`}
            title={asTable ? 'Chart view' : 'Table view'}
          >
            {asTable ? <BarChart3 aria-hidden className="size-4" /> : <Table2 aria-hidden className="size-4" />}
          </button>
        </div>
      </header>
      <div className={cn('flex-1 px-3 pt-2 pb-4 transition-opacity duration-200', stale && 'opacity-60')}>
        {loading ? (
          <Skeleton className="mx-2 rounded-xl" style={{ height }} />
        ) : asTable ? (
          <div className="max-h-[22rem] overflow-auto px-2">{table}</div>
        ) : (
          <div style={{ height }}>{children}</div>
        )}
      </div>
    </Card>
  );
}

/** The accessible twin of a chart. */
export function DataTableView<T>({ rows, columns }: { rows: T[]; columns: { key: string; label: string; render: (row: T) => ReactNode; align?: 'right' }[] }) {
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-fg-subtle">No data in this period.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs text-fg-subtle uppercase">
          {columns.map((c) => <th key={c.key} scope="col" className={cn('px-2 py-1.5 font-medium', c.align === 'right' && 'text-right')}>{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-b last:border-b-0">
            {columns.map((c) => <td key={c.key} className={cn('px-2 py-1.5 tabular-nums', c.align === 'right' && 'text-right')}>{c.render(row)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ *
 * Shared chrome
 * ------------------------------------------------------------------ */

const axisProps = {
  stroke: 'var(--color-chart-grid)',
  tick: { fill: 'var(--color-fg-subtle)', fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: 'var(--color-chart-grid)' },
} as const;

interface TooltipItem {
  dataKey?: unknown;
  color?: string;
  value?: unknown;
  name?: unknown;
}

function ChartTooltip({ active, payload, label, formatValue, formatLabel }: { active?: boolean; payload?: readonly TooltipItem[]; label?: string | number; formatValue: (v: number) => string; formatLabel?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-lg border bg-surface-raised px-3 py-2 text-xs shadow-card">
      <p className="mb-1 text-fg-subtle">{formatLabel ? formatLabel(String(label)) : String(label)}</p>
      <ul className="space-y-0.5">
        {payload.map((item) => (
          <li key={String(item.dataKey)} className="flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: item.color }} />
            <span className="font-semibold text-fg tabular-nums">{formatValue(Number(item.value ?? 0))}</span>
            <span className="text-fg-muted">{String(item.name ?? '')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Legend({ series }: { series: { label: string; color: string; kind: 'line' | 'rect' }[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="mb-1 flex flex-wrap gap-x-4 gap-y-1 px-2 text-xs text-fg-muted">
      {series.map((s) => (
        <li key={s.label} className="flex items-center gap-1.5">
          <span aria-hidden className={s.kind === 'line' ? 'h-0.5 w-3 rounded-full' : 'size-2.5 rounded-sm'} style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

interface CartesianProps<T> {
  data: T[];
  xKey: keyof T & string;
  series: SeriesDef<T>[];
  formatValue: (v: number) => string;
  formatAxis?: (v: number) => string;
  formatX?: (v: string) => string;
}

/** Trend over time. One series renders as a soft area; several as lines. */
/** Lines glow softly in their own colour. */
const glow = (color: string) => ({ filter: `drop-shadow(0 0 6px color-mix(in oklch, ${color} 55%, transparent))` });

export function TrendChart<T>({ data, xKey, series, formatValue, formatAxis, formatX }: CartesianProps<T>) {
  const fillId = `trend-fill-${useId().replace(/:/g, '')}`;
  const colors = series.map((s, i) => SERIES[s.slot ?? i] ?? SERIES[0]);
  const single = series.length === 1;
  const x: string = xKey;
  const first: string = series[0]!.key;
  const common = (
    <>
      <CartesianGrid vertical={false} stroke="var(--color-chart-grid)" strokeDasharray="0" />
      <XAxis dataKey={x} {...axisProps} tickFormatter={formatX} minTickGap={24} />
      <YAxis {...axisProps} axisLine={false} width={56} tickFormatter={formatAxis ?? formatValue} allowDecimals={false} />
      <Tooltip cursor={{ stroke: 'var(--color-fg-subtle)', strokeWidth: 1 }} content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} formatValue={formatValue} formatLabel={formatX} />} />
    </>
  );
  return (
    <div className="flex h-full flex-col">
      <Legend series={series.map((s, i) => ({ label: s.label, color: colors[i]!, kind: 'line' }))} />
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          {single ? (
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors[0]} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={colors[0]} stopOpacity={0} />
                </linearGradient>
              </defs>
              {common}
              <Area type="monotone" dataKey={first} name={series[0]!.label} stroke={colors[0]} strokeWidth={2.25} fill={`url(#${fillId})`} fillOpacity={1} style={glow(colors[0]!)} animationDuration={900} animationEasing="ease-out" activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--color-surface)' }} dot={false} />
            </AreaChart>
          ) : (
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              {common}
              {series.map((s, i) => (
                <Line key={s.key} type="monotone" dataKey={s.key as string} name={s.label} stroke={colors[i]} strokeWidth={2.25} style={glow(colors[i]!)} animationDuration={900} animationEasing="ease-out" dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--color-surface)' }} />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Columns for categories or periods; up to four series side by side. */
export function ColumnChart<T>({ data, xKey, series, formatValue, formatAxis, formatX, stacked = false }: CartesianProps<T> & { stacked?: boolean }) {
  const colors = series.map((s, i) => SERIES[s.slot ?? i] ?? SERIES[0]);
  const x: string = xKey;
  return (
    <div className="flex h-full flex-col">
      <Legend series={series.map((s, i) => ({ label: s.label, color: colors[i]!, kind: 'rect' }))} />
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--color-chart-grid)" />
            <XAxis dataKey={x} {...axisProps} tickFormatter={formatX} interval="preserveStartEnd" minTickGap={8} />
            <YAxis {...axisProps} axisLine={false} width={56} tickFormatter={formatAxis ?? formatValue} allowDecimals={false} />
            <Tooltip cursor={{ fill: 'var(--color-surface-raised)' }} content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} formatValue={formatValue} formatLabel={formatX} />} />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key as string}
                name={s.label}
                fill={colors[i]}
                maxBarSize={24}
                animationDuration={800}
                animationEasing="ease-out"
                stackId={stacked ? 'stack' : undefined}
                radius={stacked ? (i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]) : [4, 4, 0, 0]}
                stroke={stacked ? 'var(--color-surface)' : undefined}
                strokeWidth={stacked ? 2 : 0}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
