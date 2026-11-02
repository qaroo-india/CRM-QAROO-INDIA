/**
 * The filter row that sits above a list or chart group. Filters live in the
 * URL (see useListParams), so a filtered view can be bookmarked or shared and
 * survives a page reload.
 */

import { RotateCcw, Search, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Select, type SelectOption } from '@/components/ui/Input';
import { cn } from '@/lib/cn';

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-4 flex flex-wrap items-end gap-2', className)}>{children}</div>;
}

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Delay before reporting, so typing does not fire a request per key. */
  debounceMs?: number;
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className, debounceMs = 300 }: SearchInputProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    if (draft === value) return;
    const id = window.setTimeout(() => onChange(draft), debounceMs);
    return () => window.clearTimeout(id);
  }, [draft, value, onChange, debounceMs]);

  return (
    <div className={cn('w-full sm:w-72', className)}>
      <Input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        leading={<Search aria-hidden className="size-4" />}
        trailing={
          draft ? (
            <button
              type="button"
              onClick={() => {
                setDraft('');
                onChange('');
              }}
              className="grid size-6 place-items-center rounded text-fg-subtle hover:text-fg"
              aria-label="Clear search"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          ) : null
        }
      />
    </div>
  );
}

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  allLabel?: string;
  className?: string;
}

export function FilterSelect({ label, value, onChange, options, allLabel = 'All', className }: FilterSelectProps) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="text-xs text-fg-subtle">{label}</span>
      <Select className="h-9 min-w-36 text-sm" value={value} onChange={(e) => onChange(e.target.value)} options={options} placeholder={allLabel} />
    </label>
  );
}

interface DateFilterProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
}

export function DateFilter({ label, value, onChange, min, max }: DateFilterProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-fg-subtle">{label}</span>
      <Input type="date" className="h-9 w-40" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function ResetFilters({ onReset, disabled }: { onReset: () => void; disabled?: boolean }) {
  return (
    <Button variant="ghost" size="sm" className="h-9" onClick={onReset} disabled={disabled}>
      <RotateCcw aria-hidden className="size-3.5" />
      Reset
    </Button>
  );
}
