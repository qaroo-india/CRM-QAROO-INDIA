import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { number } from '@/utils/format';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
}

const SIZES = [10, 25, 50, 100].map((n) => ({ value: String(n), label: `${n} / page` }));

export function Pagination({ page, totalPages, total, limit, onPageChange, onLimitChange }: PaginationProps) {
  if (total === 0) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <nav aria-label="Pagination" className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-fg-muted">
      <p>
        Showing <span className="font-medium text-fg tabular-nums">{number(from)}–{number(to)}</span> of{' '}
        <span className="font-medium text-fg tabular-nums">{number(total)}</span>
      </p>
      <div className="flex items-center gap-2">
        {onLimitChange && (
          <Select
            aria-label="Rows per page"
            className="h-8 w-32 text-xs"
            value={String(limit)}
            options={SIZES}
            onChange={(e) => onLimitChange(Number(e.target.value))}
          />
        )}
        <Button variant="secondary" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft aria-hidden className="size-4" />
        </Button>
        <span className="tabular-nums" aria-live="polite">
          Page {page} of {totalPages}
        </span>
        <Button variant="secondary" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} aria-label="Next page">
          <ChevronRight aria-hidden className="size-4" />
        </Button>
      </div>
    </nav>
  );
}
