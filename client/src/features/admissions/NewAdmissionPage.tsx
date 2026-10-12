/**
 * Register an admission: student (existing, new, or from an enquiry), course
 * and fees, then submit once. The page holds one idempotency key for its
 * lifetime, so a double-click or a retry after a network blip returns the
 * same admission instead of creating two.
 */

import {
  dateOnlySchema,
  idSchema,
  moneyFieldSchema,
  optionalString,
  studentSchema,
  toDecimalString,
  toMinor,
  todayInZone,
  type AdmissionDto,
  type DuplicateMatch,
  type StudentDto,
} from '@ims/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Search, UserRoundCheck, UserRoundPlus } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Field, FormSection } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { api, ApiRequestError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { toastError, useZodForm } from '@/lib/forms';
import { getFormatConfig, money } from '@/utils/format';
import { useDuplicateCheck, useLead } from '../leads/api';
import { DuplicateWarning } from '../leads/DuplicateWarning';
import { newIdempotencyKey, toOptions, useCourses, useUserOptions } from '../shared/hooks';
import { useStudents } from '../students/api';
import { StudentFields, studentDefaults } from '../students/StudentFormDrawer';
import { FeePlanFields, feePlanPayload, useFeePlanState } from '../payments/FeePlanFields';

const feesFormSchema = z
  .object({
    courseId: idSchema,
    admissionDate: dateOnlySchema,
    counsellorId: z.string().optional(),
    notes: optionalString(4000),
    listFeeMinor: moneyFieldSchema,
    discountMinor: moneyFieldSchema,
    admissionFeeRequiredMinor: moneyFieldSchema,
  })
  .superRefine((v, ctx) => {
    if (v.discountMinor > v.listFeeMinor) ctx.addIssue({ code: 'custom', path: ['discountMinor'], message: 'Discount cannot exceed the course fee' });
    if (v.admissionFeeRequiredMinor > v.listFeeMinor - v.discountMinor) {
      ctx.addIssue({ code: 'custom', path: ['admissionFeeRequiredMinor'], message: 'Admission fee cannot exceed the agreed fee' });
    }
  });

function safeMinor(value: unknown): number | null {
  try {
    return toMinor(String(value ?? '').trim() || '0');
  } catch {
    return null;
  }
}

function StepCard({ step, title, description, children }: { step: number; title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="flex items-start gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary-soft text-xs font-semibold text-primary">{step}</span>
          <div>
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            {description && <p className="text-sm text-fg-muted">{description}</p>}
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function ExistingStudentPicker({ selected, onSelect }: { selected: StudentDto | null; onSelect: (s: StudentDto | null) => void }) {
  const [q, setQ] = useState('');
  const results = useStudents({ q, limit: 6 }, q.trim().length >= 2);
  if (selected) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-control border border-primary/30 bg-primary-soft p-3">
        <div>
          <p className="font-medium text-fg">{selected.fullName}</p>
          <p className="text-xs text-fg-muted"><span className="font-mono">{selected.studentCode}</span> · {selected.phone} · {selected.admissionCount} previous admission(s)</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onSelect(null)}>Change</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Input aria-label="Find a student" placeholder="Search by name, code or phone…" value={q} onChange={(e) => setQ(e.target.value)} leading={<Search aria-hidden className="size-4" />} autoFocus />
      {q.trim().length >= 2 && (
        <ul className="divide-y rounded-control border bg-surface">
          {results.data?.items.length === 0 && <li className="p-3 text-sm text-fg-muted">No matching students.</li>}
          {results.data?.items.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => onSelect(s)} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-surface-raised">
                <span>
                  <span className="block text-sm font-medium text-fg">{s.fullName}</span>
                  <span className="block text-xs text-fg-subtle"><span className="font-mono">{s.studentCode}</span> · {s.phone}</span>
                </span>
                <span className="text-xs text-fg-subtle">{s.latestCourseName ?? 'No admissions'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NewAdmissionPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const leadId = params.get('leadId');
  const lead = useLead(leadId);
  const courses = useCourses(true);
  const people = useUserOptions();
  const [idempotencyKey] = useState(newIdempotencyKey);

  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [existing, setExisting] = useState<StudentDto | null>(null);
  const [conflict, setConflict] = useState<DuplicateMatch[] | null>(null);

  const studentForm = useZodForm(studentSchema, { defaultValues: studentDefaults() });
  const feesForm = useZodForm(feesFormSchema, {
    defaultValues: {
      courseId: '',
      admissionDate: todayInZone(getFormatConfig().timeZone),
      counsellorId: '',
      notes: '',
      listFeeMinor: '',
      discountMinor: '0',
      admissionFeeRequiredMinor: '0',
    },
  });
  const plan = useFeePlanState();

  // Prefill from the enquiry being converted.
  useEffect(() => {
    if (!lead.data) return;
    studentForm.reset({ ...studentDefaults(), fullName: lead.data.name, phone: lead.data.phone, email: lead.data.email ?? '' });
    if (lead.data.counsellorId) feesForm.setValue('counsellorId', lead.data.counsellorId);
    if (lead.data.interestedCourseId) feesForm.setValue('courseId', lead.data.interestedCourseId, { shouldValidate: false });
  }, [lead.data, studentForm, feesForm]);

  // Course choice fills the fee defaults (still editable per admission).
  const courseId = feesForm.watch('courseId');
  const course = useMemo(() => courses.data?.find((c) => c.id === courseId), [courses.data, courseId]);
  useEffect(() => {
    if (!course) return;
    feesForm.setValue('listFeeMinor', toDecimalString(course.standardFeeMinor));
    feesForm.setValue('admissionFeeRequiredMinor', course.defaultAdmissionFeeMinor === null ? '0' : toDecimalString(course.defaultAdmissionFeeMinor));
    plan.applyCourseDefaults(course);
  }, [course, feesForm, plan.applyCourseDefaults]);

  const duplicates = useDuplicateCheck('students', mode === 'new' ? studentForm.watch('phone') : undefined, mode === 'new' ? (studentForm.watch('email') ?? undefined) : undefined);

  const list = safeMinor(feesForm.watch('listFeeMinor'));
  const discount = safeMinor(feesForm.watch('discountMinor'));
  const admissionFee = safeMinor(feesForm.watch('admissionFeeRequiredMinor'));
  const agreed = list !== null && discount !== null ? Math.max(0, list - discount) : null;

  const submit = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<AdmissionDto>('/admissions', payload, { headers: { 'Idempotency-Key': idempotencyKey } }),
    onSuccess: (admission) => {
      void queryClient.invalidateQueries({ queryKey: ['admissions'] });
      void queryClient.invalidateQueries({ queryKey: ['students'] });
      void queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast.success(`Admission ${admission.admissionNumber} registered`);
      navigate(`/students/${admission.studentId}?tab=admissions`, { replace: true });
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.code === 'DUPLICATE_STUDENT') {
        setConflict((error.details as { matches: DuplicateMatch[] }).matches);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      if (error instanceof ApiRequestError && error.fields?.length) {
        for (const field of error.fields) feesForm.setError(field.path as never, { message: field.message });
      }
      toastError(error);
    },
  });

  const onSubmit = async (allowDuplicate = false) => {
    const feesOk = await feesForm.trigger();
    const studentOk = mode === 'existing' ? !!existing : await studentForm.trigger();
    if (mode === 'existing' && !existing) toast.error('Choose the existing student, or switch to a new student.');
    const planError = plan.validate(agreed ?? 0, admissionFee ?? 0);
    if (planError) toast.error(planError);
    if (!feesOk || !studentOk || planError) return;

    const fees = feesFormSchema.parse(feesForm.getValues());
    const student = mode === 'new' ? studentSchema.parse(studentForm.getValues()) : undefined;
    submit.mutate({
      leadId: leadId ?? undefined,
      studentId: mode === 'existing' ? existing!.id : undefined,
      newStudent: student,
      allowDuplicate,
      courseId: fees.courseId,
      admissionDate: fees.admissionDate,
      counsellorId: fees.counsellorId || undefined,
      notes: fees.notes,
      listFeeMinor: fees.listFeeMinor,
      discountMinor: fees.discountMinor,
      admissionFeeRequiredMinor: fees.admissionFeeRequiredMinor,
      feePlan: feePlanPayload(plan.state, fees.admissionDate),
    });
  };

  const useStudent = (match: DuplicateMatch) => {
    setMode('existing');
    setConflict(null);
    void api.get<{ student: StudentDto }>(`/students/${match.id}`).then((p) => setExisting(p.student));
  };

  const fe = feesForm.formState.errors;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Register admission"
        description={lead.data ? `Converting enquiry ${lead.data.leadCode} from ${lead.data.sourceName}.` : 'Enrol an existing or new student on a course.'}
        breadcrumbs={[{ label: 'Admissions', to: '/admissions' }, { label: 'Register' }]}
        actions={<Button variant="ghost" onClick={() => navigate(-1)}><ArrowLeft aria-hidden className="size-4" /> Back</Button>}
      />

      <div className="space-y-5">
        {lead.data?.status === 'converted' && (
          <div role="alert" className="rounded-control border border-danger/35 bg-danger-soft p-3 text-sm text-danger">
            This enquiry has already been converted to an admission.
          </div>
        )}

        <StepCard step={1} title="Student" description="Returning students get a new admission on their existing profile.">
          <div role="radiogroup" aria-label="Student" className="grid gap-2 sm:grid-cols-2">
            {([
              ['new', 'New student', UserRoundPlus],
              ['existing', 'Existing student', UserRoundCheck],
            ] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => setMode(value)}
                className={cn('flex items-center gap-3 rounded-control border p-3 text-left text-sm transition-colors', mode === value ? 'border-primary/50 bg-primary-soft text-primary' : 'text-fg-muted hover:text-fg')}
              >
                <Icon aria-hidden className="size-4" /> {label}
              </button>
            ))}
          </div>

          {conflict && (
            <div className="space-y-3">
              <DuplicateWarning matches={conflict} onUseStudent={useStudent} />
              <Button variant="danger" size="sm" loading={submit.isPending} onClick={() => void onSubmit(true)}>
                It's a different person: register as new
              </Button>
            </div>
          )}

          {mode === 'existing' ? (
            <ExistingStudentPicker selected={existing} onSelect={setExisting} />
          ) : (
            <form noValidate className="space-y-4" onSubmit={(e) => e.preventDefault()}>
              <StudentFields form={studentForm} />
              {!conflict && <DuplicateWarning matches={duplicates.data} onUseStudent={useStudent} />}
            </form>
          )}
        </StepCard>

        <StepCard step={2} title="Course & fees" description="Fees default from the course and can be adjusted for this admission.">
          <form noValidate className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Course" error={fe.courseId?.message} required>
                <Select options={toOptions(courses.data)} placeholder="Select a course…" {...feesForm.register('courseId')} />
              </Field>
              <Field label="Admission date" error={fe.admissionDate?.message} required>
                <Input type="date" {...feesForm.register('admissionDate')} />
              </Field>
            </div>
            <FormSection title="Fees">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Course fee" error={fe.listFeeMinor?.message} required>
                  <MoneyInput {...feesForm.register('listFeeMinor')} />
                </Field>
                <Field label="Discount" error={fe.discountMinor?.message}>
                  <MoneyInput {...feesForm.register('discountMinor')} />
                </Field>
                <Field label="Admission fee due" hint="Collected before the admission becomes active." error={fe.admissionFeeRequiredMinor?.message}>
                  <MoneyInput {...feesForm.register('admissionFeeRequiredMinor')} />
                </Field>
              </div>
              <div className="flex items-center justify-between rounded-control border bg-surface-sunken px-4 py-3">
                <span className="text-sm text-fg-muted">Agreed fee</span>
                <span className="text-lg font-semibold text-fg">{agreed === null ? '—' : money(agreed)}</span>
              </div>
            </FormSection>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Counsellor">
                <Select options={toOptions(people.data)} placeholder="Unassigned" {...feesForm.register('counsellorId')} />
              </Field>
            </div>
            <Field label="Notes" error={fe.notes?.message}>
              <Textarea rows={2} {...feesForm.register('notes')} />
            </Field>
          </form>
        </StepCard>

        <StepCard step={3} title="Payment plan" description="How the agreed fee will be paid. You can also set this up later.">
          <FeePlanFields plan={plan} agreedMinor={agreed ?? 0} admissionFeeMinor={admissionFee ?? 0} />
        </StepCard>

        {lead.data && (
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            Linked enquiry <span className="font-mono">{lead.data.leadCode}</span> <StatusBadge status={lead.data.status} /> · source {lead.data.sourceName}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t pt-5">
          <Button variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
          <Button loading={submit.isPending} disabled={lead.data?.status === 'converted'} onClick={() => void onSubmit(false)}>
            Register admission
          </Button>
        </div>
      </div>
    </div>
  );
}
