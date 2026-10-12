/**
 * Two-step bulk import: upload -> review every row (errors, duplicates) ->
 * import only the confirmed rows. Nothing is saved until the second step.
 */

import type { ImportPreview, ImportResult } from '@ims/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Download, FileUp, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DialogContent, DialogRoot } from '@/components/ui/Dialog';
import { Checkbox, Switch } from '@/components/ui/Toggle';
import { api, fetchFile, saveBlob, upload } from '@/lib/api';
import { cn } from '@/lib/cn';
import { toastError } from '@/lib/forms';
import { number } from '@/utils/format';

const COLUMNS: Record<'leads' | 'students', { key: string; label: string }[]> = {
  leads: [
    { key: 'name', label: 'Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'enquiryDate', label: 'Enquiry date' },
    { key: 'sourceName', label: 'Source' },
    { key: 'courseName', label: 'Course' },
  ],
  students: [
    { key: 'fullName', label: 'Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'city', label: 'City' },
    { key: 'dateOfBirth', label: 'Date of birth' },
  ],
};

export function ImportDialog({ entity, open, onOpenChange }: { entity: 'leads' | 'students'; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    if (open) {
      setPreview(null);
      setResult(null);
      setSelected(new Set());
      setAllowDuplicates(false);
    }
  }, [open]);

  const parse = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.set('file', file);
      return upload<ImportPreview>(`/import/${entity}/preview`, form);
    },
    onSuccess: (p) => {
      setPreview(p);
      setSelected(new Set(p.rows.filter((r) => r.errors.length === 0 && r.duplicates.length === 0).map((r) => r.row)));
    },
    onError: (e) => toastError(e),
  });
  const commit = useMutation({
    mutationFn: () => api.post<ImportResult>(`/import/${entity}/commit`, { token: preview!.token, rows: [...selected], allowDuplicates }),
    onSuccess: (r) => {
      setResult(r);
      void queryClient.invalidateQueries({ queryKey: [entity] });
      toast.success(`Imported ${r.created} ${entity}`);
    },
    onError: (e) => toastError(e),
  });
  const template = useMutation({ mutationFn: () => fetchFile(`/import/${entity}/template`, { fallbackName: `${entity}-template.csv` }), onSuccess: saveBlob, onError: (e) => toastError(e) });

  const importable = useMemo(() => (preview ? preview.rows.filter((r) => r.errors.length === 0 && (allowDuplicates || r.duplicates.length === 0)) : []), [preview, allowDuplicates]);
  const chosen = importable.filter((r) => selected.has(r.row)).length;
  const toggle = (row: number) => setSelected((s) => { const n = new Set(s); if (n.has(row)) n.delete(row); else n.add(row); return n; });

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Import ${entity}`}
        description={result ? 'Import finished' : preview ? `${preview.fileName}: review before importing` : 'Upload a CSV or Excel file. Nothing is saved until you confirm.'}
        size="xl"
        dismissible={!commit.isPending}
        footer={
          result ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : preview ? (
            <>
              <Button variant="ghost" onClick={() => setPreview(null)}>Choose another file</Button>
              <Button loading={commit.isPending} disabled={chosen === 0} onClick={() => commit.mutate()}>Import {number(chosen)} row{chosen === 1 ? '' : 's'}</Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          )
        }
      >
        {result ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-fg"><CircleCheck aria-hidden className="size-5 text-success" /> Created {number(result.created)} · skipped {number(result.skipped)}</p>
            {result.failures.length > 0 && (
              <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-3 text-sm">
                {result.failures.map((f) => <li key={f.row}><span className="font-medium">Row {f.row}:</span> <span className="text-fg-muted">{f.message}</span></li>)}
              </ul>
            )}
          </div>
        ) : !preview ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 rounded-card border-2 border-dashed border-border-strong p-8 text-center">
              <FileUp aria-hidden className="size-7 text-fg-subtle" />
              <p className="text-sm text-fg-muted">The first row must be column headers. Dates like 12/10/2026 are read as day/month/year.</p>
              <Button loading={parse.isPending} onClick={() => inputRef.current?.click()}>Choose CSV or Excel file</Button>
              <input ref={inputRef} type="file" accept=".csv,.xlsx" className="sr-only" aria-label="Import file" onChange={(e) => { const f = e.target.files?.[0]; if (f) parse.mutate(f); e.target.value = ''; }} />
            </div>
            <Button variant="ghost" size="sm" loading={template.isPending} onClick={() => template.mutate()}><Download aria-hidden className="size-4" /> Download a template</Button>
            {entity === 'leads' && <p className="text-xs text-fg-subtle">Required columns: Name, Phone, Source (must match a lead source in Settings). Optional: Email, Enquiry date (defaults to today), Course, Counsellor (name or email), Follow-up date, Priority, Campaign, UTM fields, Notes.</p>}
            {entity === 'students' && <p className="text-xs text-fg-subtle">Required columns: Full name, Phone. Optional: Email, Address, City, Date of birth, Emergency contact name and phone, Notes.</p>}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge>{number(preview.summary.total)} rows</Badge>
              <Badge tone="success">{number(preview.summary.valid)} valid</Badge>
              {preview.summary.invalid > 0 && <Badge tone="danger">{number(preview.summary.invalid)} with errors</Badge>}
              {preview.summary.duplicates > 0 && <Badge tone="warning">{number(preview.summary.duplicates)} possible duplicates</Badge>}
              <span className="ml-auto"><Switch label="Import possible duplicates too" checked={allowDuplicates} onCheckedChange={(v: boolean) => setAllowDuplicates(v)} /></span>
            </div>
            <div className="max-h-[50dvh] overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-raised text-left text-xs text-fg-subtle uppercase">
                  <tr>
                    <th className="w-10 px-2 py-2"><span className="sr-only">Import</span></th>
                    <th className="px-2 py-2">Row</th>
                    {COLUMNS[entity].map((c) => <th key={c.key} className="px-2 py-2 font-medium">{c.label}</th>)}
                    <th className="px-2 py-2 font-medium">Problems</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => {
                    const blocked = r.errors.length > 0 || (!allowDuplicates && r.duplicates.length > 0);
                    return (
                      <tr key={r.row} className={cn('border-t align-top', r.errors.length > 0 && 'bg-danger-soft/40')}>
                        <td className="px-2 py-1.5"><Checkbox aria-label={`Import row ${r.row}`} checked={!blocked && selected.has(r.row)} disabled={blocked} onCheckedChange={() => toggle(r.row)} /></td>
                        <td className="px-2 py-1.5 text-fg-subtle tabular-nums">{r.row}</td>
                        {COLUMNS[entity].map((c) => <td key={c.key} className="max-w-48 truncate px-2 py-1.5">{String(r.data[c.key] ?? '') || <span className="text-fg-subtle">—</span>}</td>)}
                        <td className="px-2 py-1.5 text-xs">
                          {r.errors.map((e) => <p key={e.field + e.message} className="text-danger">{e.field}: {e.message}</p>)}
                          {r.duplicates.map((d) => <p key={d.label} className="flex items-center gap-1 text-warning"><TriangleAlert aria-hidden className="size-3" />{d.label}</p>)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-fg-subtle">Rows with errors are never imported. This preview expires in 30 minutes.</p>
          </div>
        )}
      </DialogContent>
    </DialogRoot>
  );
}
