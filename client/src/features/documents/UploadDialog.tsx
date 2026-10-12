import { DOCUMENT_KINDS, type AdmissionDto, type DocumentOwnerType } from '@ims/shared';
import { FileUp, Lock } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { DialogContent, DialogRoot } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Input, Select } from '@/components/ui/Input';
import { ApiRequestError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { toastError } from '@/lib/forms';
import { AdmissionPicker } from '../payments/AdmissionPicker';
import { useUploadDocument } from './api';

export const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt';

export interface FixedOwner {
  ownerType: DocumentOwnerType;
  ownerId: string;
  label: string;
}

const sizeText = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/**
 * Upload a document. With `owner` it is attached to that record; without, the
 * user chooses the institute, a student or an admission.
 */
export function UploadDialog({ open, onOpenChange, owner, defaultKind }: { open: boolean; onOpenChange: (open: boolean) => void; owner?: FixedOwner; defaultKind?: string }) {
  const { can, institute } = useAuth();
  const kindsId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState('');
  const [title, setTitle] = useState('');
  const [access, setAccess] = useState<'general' | 'restricted'>('general');
  const [target, setTarget] = useState<'institute' | 'student' | 'admission'>('student');
  const [admission, setAdmission] = useState<AdmissionDto | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setKind(defaultKind ?? '');
    setTitle('');
    setAccess('general');
    setAdmission(null);
    setErrors({});
  }, [open, defaultKind]);

  const mutation = useUploadDocument(() => onOpenChange(false));
  const ownerType: DocumentOwnerType = owner?.ownerType ?? target;
  const ownerId = owner?.ownerId ?? (target === 'institute' ? undefined : target === 'student' ? admission?.studentId : admission?.id);
  const forcedRestricted = ownerType === 'loan' || /identity/i.test(kind);
  const restricted = forcedRestricted || access === 'restricted';
  const maxMb = 10;

  const choose = (f: File | null | undefined) => {
    if (!f) return;
    setFile(f);
    setErrors((e) => ({ ...e, file: '' }));
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 160));
  };

  const submit = () => {
    const problems: Record<string, string> = {};
    if (!file) problems.file = 'Choose a file';
    if (!kind.trim()) problems.kind = 'Choose or type a document type';
    if (!title.trim()) problems.title = 'Give the document a title';
    if (!owner && target !== 'institute' && !admission) problems.ownerId = 'Find the student or admission';
    if (Object.keys(problems).length) return setErrors(problems);
    const form = new FormData();
    form.set('ownerType', ownerType);
    if (ownerId) form.set('ownerId', ownerId);
    form.set('kind', kind.trim());
    form.set('title', title.trim());
    form.set('accessLevel', restricted ? 'restricted' : 'general');
    form.set('file', file!);
    mutation.mutate(form, {
      onError: (error) => {
        if (error instanceof ApiRequestError && error.fields?.length) setErrors(Object.fromEntries(error.fields.map((f) => [f.path, f.message])));
        else toastError(error);
      },
    });
  };

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Upload a document"
        description={owner ? `Attached to ${owner.label}` : `${institute?.name ?? 'Institute'} document center`}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={mutation.isPending} disabled={restricted && !can('documents:restricted')} onClick={submit}>Upload</Button>
          </>
        }
      >
        <div className="space-y-4">
          {!owner && (
            <>
              <Field label="Belongs to">
                <Select value={target} onChange={(e) => { setTarget(e.target.value as typeof target); setAdmission(null); }} options={[{ value: 'student', label: 'A student' }, { value: 'admission', label: 'A specific admission' }, { value: 'institute', label: 'The institute (policies, agreements…)' }]} />
              </Field>
              {target !== 'institute' && (
                <Field label={target === 'student' ? 'Find the student' : 'Find the admission'} error={errors.ownerId} hint="Search by name, phone or admission number">
                  <div><AdmissionPicker value={admission} onChange={setAdmission} /></div>
                </Field>
              )}
            </>
          )}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); choose(e.dataTransfer.files[0]); }}
            className={cn('flex flex-col items-center gap-2 rounded-card border-2 border-dashed p-5 text-center transition-colors', dragging ? 'border-primary bg-primary-soft' : 'border-border-strong', errors.file && 'border-danger')}
          >
            <FileUp aria-hidden className="size-6 text-fg-subtle" />
            {file ? (
              <p className="text-sm text-fg">{file.name} <span className="text-fg-subtle">· {sizeText(file.size)}</span></p>
            ) : (
              <p className="text-sm text-fg-muted">Drop a file here, or</p>
            )}
            <Button type="button" size="sm" variant="secondary" onClick={() => inputRef.current?.click()}>{file ? 'Choose another' : 'Choose a file'}</Button>
            <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" aria-label="File" onChange={(e) => choose(e.target.files?.[0])} />
            <p className="text-xs text-fg-subtle">PDF, images, Word, Excel, CSV or text · up to {maxMb} MB</p>
            {errors.file && <p className="text-sm text-danger">{errors.file}</p>}
          </div>
          <Field label="Document type" error={errors.kind} required>
            <Input list={kindsId} value={kind} onChange={(e) => setKind(e.target.value)} placeholder="e.g. Identity proof" maxLength={60} />
          </Field>
          <datalist id={kindsId}>{DOCUMENT_KINDS.map((k) => <option key={k} value={k} />)}</datalist>
          <Field label="Title" error={errors.title} required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
          </Field>
          <Field label="Access" hint={forcedRestricted ? 'Loan paperwork and identity documents are always restricted.' : 'Restricted documents are hidden from staff without the restricted documents permission.'}>
            <Select value={restricted ? 'restricted' : 'general'} disabled={forcedRestricted} onChange={(e) => setAccess(e.target.value as 'general' | 'restricted')} options={[{ value: 'general', label: 'General: staff with document access' }, { value: 'restricted', label: 'Restricted: sensitive' }]} />
          </Field>
          {restricted && !can('documents:restricted') && (
            <p className="flex items-center gap-2 text-sm text-warning"><Lock aria-hidden className="size-4" /> You need the restricted documents permission to upload this.</p>
          )}
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
