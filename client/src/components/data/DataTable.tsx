/**
 * The list table used across the app. Sorting and paging happen on the server
 * (lists can hold years of receipts); this component renders, reports intent,
 * and handles the UI-only concerns: column visibility, selection, keyboard rows.
 */

import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from 'lucide-react';
import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/Feedback';
import { Menu, MenuContent, MenuLabel, MenuTrigger } from '@/components/ui/Menu';
import { Skeleton } from '@/components/ui/Skeleton';
import { Checkbox } from '@/components/ui/Toggle';
import { cn } from '@/lib/cn';

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Server sort field; makes the header a sort toggle. */
  sortKey?: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
  headerClassName?: string;
  /** Primary columns cannot be hidden. Defaults to true. */
  hideable?: boolean;
  defaultHidden?: boolean;
}

export interface SortState {
  key: string;
  order: 'asc' | 'desc';
}

/* ------------------------------------------------------------------ *
 * Column visibility (remembered per table on this device)
 * ------------------------------------------------------------------ */

export interface ColumnVisibility {
  hidden: ReadonlySet<string>;
  toggle: (id: string) => void;
}

export function useColumnVisibility<T>(tableId: string, columns: Column<T>[]): ColumnVisibility {
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      const stored = window.localStorage.getItem(`ims-table:${tableId}`);
      if (stored) return new Set(JSON.parse(stored) as string[]);
    } catch {
      // Storage unavailable: fall back to the defaults.
    }
    return new Set(columns.filter((c) => c.defaultHidden).map((c) => c.id));
  });

  const toggle = (id: string) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(`ims-table:${tableId}`, JSON.stringify([...next]));
      } catch {
        // Not persisted this time; the choice still applies.
      }
      return next;
    });
  };

  return { hidden, toggle };
}

/** "Columns" menu; place it in the page's toolbar. */
export function ColumnToggle<T>({ columns, visibility }: { columns: Column<T>[]; visibility: ColumnVisibility }) {
  const hideable = columns.filter((c) => c.hideable !== false);
  if (hideable.length < 2) return null;
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="secondary" size="sm" className="h-9" aria-label="Choose columns">
          <Columns3 aria-hidden className="size-4" />
          <span className="hidden sm:inline">Columns</span>
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>Show columns</MenuLabel>
        {hideable.map((column) => (
          <MenuPrimitive.CheckboxItem
            key={column.id}
            checked={!visibility.hidden.has(column.id)}
            onCheckedChange={() => visibility.toggle(column.id)}
            onSelect={(e) => e.preventDefault()}
            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-sunken"
          >
            <span className="grid size-4 place-items-center rounded border border-border-strong">
              <MenuPrimitive.ItemIndicator>
                <span className="block size-2 rounded-sm bg-primary" />
              </MenuPrimitive.ItemIndicator>
            </span>
            {column.header}
          </MenuPrimitive.CheckboxItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

/* ------------------------------------------------------------------ *
 * Table
 * ------------------------------------------------------------------ */

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  /** Refetching with previous rows on screen: dim instead of flashing. */
  fetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  onRowClick?: (row: T) => void;
  selection?: { selected: Set<string>; onChange: (next: Set<string>) => void };
  empty?: ReactNode;
  /** Totals or summary row(s), rendered in <tfoot>. */
  footer?: ReactNode;
  caption?: string;
  /** From useColumnVisibility(); otherwise only defaultHidden columns hide. */
  visibility?: ColumnVisibility;
  className?: string;
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  fetching,
  error,
  onRetry,
  sort,
  onSortChange,
  onRowClick,
  selection,
  empty,
  footer,
  caption,
  visibility,
  className,
}: DataTableProps<T>) {
  const hidden = visibility?.hidden ?? new Set(columns.filter((c) => c.defaultHidden).map((c) => c.id));
  const visible = columns.filter((c) => !hidden.has(c.id));
  const span = visible.length + (selection ? 1 : 0);

  const allKeys = rows?.map(rowKey) ?? [];
  const allSelected = !!selection && allKeys.length > 0 && allKeys.every((k) => selection.selected.has(k));
  const someSelected = !!selection && allKeys.some((k) => selection.selected.has(k));

  const toggleAll = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (allSelected) allKeys.forEach((k) => next.delete(k));
    else allKeys.forEach((k) => next.add(k));
    selection.onChange(next);
  };

  const toggleRow = (key: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selection.onChange(next);
  };

  const headerCell = (column: Column<T>) => {
    const active = !!sort && !!column.sortKey && sort.key === column.sortKey;
    const content =
      column.sortKey && onSortChange ? (
        <button
          type="button"
          onClick={() => onSortChange({ key: column.sortKey!, order: active && sort?.order === 'desc' ? 'asc' : 'desc' })}
          className={cn(
            'inline-flex items-center gap-1 rounded uppercase transition-colors hover:text-fg',
            column.align === 'right' && 'flex-row-reverse',
            active && 'text-fg',
          )}
        >
          {column.header}
          {active ? (
            sort?.order === 'desc' ? (
              <ArrowDown aria-hidden className="size-3" />
            ) : (
              <ArrowUp aria-hidden className="size-3" />
            )
          ) : (
            <ArrowUpDown aria-hidden className="size-3 opacity-40" />
          )}
        </button>
      ) : (
        column.header
      );
    return (
      <th
        key={column.id}
        scope="col"
        aria-sort={active ? (sort?.order === 'desc' ? 'descending' : 'ascending') : undefined}
        className={cn(
          'border-b bg-surface px-3 py-2.5 text-xs font-medium tracking-wide whitespace-nowrap text-fg-subtle uppercase',
          ALIGN[column.align ?? 'left'],
          column.headerClassName,
        )}
      >
        {content}
      </th>
    );
  };

  let body: ReactNode;
  if (error) {
    body = (
      <tr>
        <td colSpan={span}>
          <ErrorState error={error} onRetry={onRetry} />
        </td>
      </tr>
    );
  } else if (loading && !rows) {
    body = Array.from({ length: 6 }, (_, i) => (
      <tr key={i} className="border-b last:border-b-0">
        {selection && <td className="w-10 px-3 py-3" />}
        {visible.map((column) => (
          <td key={column.id} className="px-3 py-3">
            <Skeleton className="h-4 w-full max-w-40" />
          </td>
        ))}
      </tr>
    ));
  } else if (!rows || rows.length === 0) {
    body = (
      <tr>
        <td colSpan={span}>{empty}</td>
      </tr>
    );
  } else {
    body = rows.map((row) => {
      const key = rowKey(row);
      const selected = selection?.selected.has(key) ?? false;
      return (
        <tr
          key={key}
          tabIndex={onRowClick ? 0 : undefined}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          onKeyDown={
            onRowClick
              ? (event) => {
                  if (event.key === 'Enter' && event.target === event.currentTarget) onRowClick(row);
                }
              : undefined
          }
          className={cn(
            'border-b transition-colors duration-150 last:border-b-0',
            onRowClick && 'cursor-pointer hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none',
            selected && 'bg-primary-soft',
          )}
        >
          {selection && (
            <td className="w-10 px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
              <Checkbox checked={selected} onCheckedChange={() => toggleRow(key)} aria-label="Select row" />
            </td>
          )}
          {visible.map((column) => (
            <td key={column.id} className={cn('px-3 py-2.5 text-sm text-fg', ALIGN[column.align ?? 'left'], column.className)}>
              {column.cell(row)}
            </td>
          ))}
        </tr>
      );
    });
  }

  return (
    <div
      className={cn(
        'overflow-x-auto rounded-card border bg-surface shadow-card transition-opacity duration-200',
        fetching && rows && 'opacity-60',
        className,
      )}
    >
      <table className="w-full border-collapse">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {selection && (
              <th scope="col" className="w-10 border-b bg-surface px-3 py-2.5">
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={toggleAll}
                  aria-label="Select all rows on this page"
                />
              </th>
            )}
            {visible.map(headerCell)}
          </tr>
        </thead>
        <tbody className="stagger">{body}</tbody>
        {footer && rows && rows.length > 0 && <tfoot className="border-t-2 bg-surface-raised">{footer}</tfoot>}
      </table>
    </div>
  );
}
