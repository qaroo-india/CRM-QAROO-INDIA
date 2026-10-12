import type { AdmissionDto } from '@ims/shared';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { money } from '@/utils/format';
import { useAdmissions } from '../students/api';

/** Find an admission by student name, phone or admission number. */
export function AdmissionPicker({ value, onChange, outstandingOnly = false }: { value: AdmissionDto | null; onChange: (a: AdmissionDto | null) => void; outstandingOnly?: boolean }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(id);
  }, [q]);
  const results = useAdmissions({ q: debounced, limit: 6, status: 'pending_payment,active,completed,withdrawn', ...(outstandingOnly && { outstanding: 'true' }) }, debounced.length >= 2);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-control border border-primary/30 bg-primary-soft p-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{value.studentName}</p>
          <p className="truncate text-xs text-fg-muted">
            <span className="font-mono">{value.admissionNumber}</span> · {value.courseName} · outstanding {money(value.outstandingMinor)}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>Change</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Input aria-label="Find an admission" placeholder="Student name, phone or admission number…" value={q} onChange={(e) => setQ(e.target.value)} leading={<Search aria-hidden className="size-4" />} autoFocus />
      {debounced.length >= 2 && (
        <ul className="divide-y rounded-control border bg-surface">
          {results.data?.items.length === 0 && <li className="p-3 text-sm text-fg-muted">No matching admissions{outstandingOnly ? ' with a balance' : ''}.</li>}
          {results.data?.items.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => onChange(a)} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-surface-raised">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">{a.studentName}</span>
                  <span className="block truncate text-xs text-fg-subtle"><span className="font-mono">{a.admissionNumber}</span> · {a.courseName}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <StatusBadge status={a.status} />
                  <span className="text-xs text-fg-muted tabular-nums">{money(a.outstandingMinor)} due</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
