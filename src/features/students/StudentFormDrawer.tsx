import { GENDERS, STUDENT_STATUSES, studentSchema, type DuplicateMatch, type StudentDto, type StudentInput } from '@ims/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { DialogRoot, DrawerContent } from '@/components/ui/Dialog';
import { Field, FormSection } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/Toggle';
import { api, ApiRequestError } from '@/lib/api';
import { handleFormError, useZodForm } from '@/lib/forms';
import { humanize } from '@/utils/format';
import { useDuplicateCheck } from '../leads/api';
import { DuplicateWarning } from '../leads/DuplicateWarning';

/** The contact fields of a student, reused by the admission form. */
export function StudentFields({ form }: { form: ReturnType<typeof useZodForm<typeof studentSchema>> }) {
  const errors = form.formState.errors;
  return (
    <>
      <Field label="Full name" error={errors.fullName?.message} required>
        <Input autoComplete="off" {...form.register('fullName')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone" error={errors.phone?.message} required>
          <Input type="tel" autoComplete="off" {...form.register('phone')} />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="off" {...form.register('email')} />
        </Field>
        <Field label="Date of birth" error={errors.dateOfBirth?.message}>
          <Input type="date" {...form.register('dateOfBirth')} />
        </Field>
        <Field label="City" error={errors.city?.message}>
          <Input {...form.register('city')} />
        </Field>
      </div>
      <Field label="Address" error={errors.address?.message}>
        <Textarea rows={2} {...form.register('address')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Emergency contact" error={errors.emergencyContactName?.message}>
          <Input {...form.register('emergencyContactName')} />
        </Field>
        <Field label="Emergency phone" error={errors.emergencyContactPhone?.message}>
          <Input type="tel" {...form.register('emergencyContactPhone')} />
        </Field>
      </div>
    </>
  );
}

/** Background, guardian and status: the full profile, edited from the drawer. */
function StudentProfileFields({ form, isEdit }: { form: ReturnType<typeof useZodForm<typeof studentSchema>>; isEdit: boolean }) {
  const errors = form.formState.errors;
  return (
    <>
      <FormSection title="Background">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Gender" error={errors.gender?.message}>
            <Select placeholder="Not set" options={GENDERS.map((g) => ({ value: g, label: g === 'undisclosed' ? 'Prefer not to say' : humanize(g) }))} {...form.register('gender')} />
          </Field>
          <Field label="Highest qualification" error={errors.qualification?.message}>
            <Input placeholder="B.Com, Diploma in EEE" {...form.register('qualification')} />
          </Field>
          <Field label="Year of passing" error={errors.yearOfPassing?.message}>
            <Input type="number" inputMode="numeric" min={1950} max={2100} {...form.register('yearOfPassing')} />
          </Field>
          <Field label="State" error={errors.state?.message}>
            <Input {...form.register('state')} />
          </Field>
          <Field label="PIN code" error={errors.pincode?.message}>
            <Input inputMode="numeric" {...form.register('pincode')} />
          </Field>
          {isEdit && (
            <Field label="Status" error={errors.status?.message} hint="Inactive or suspended students cannot sign in to the portal.">
              <Select options={STUDENT_STATUSES.map((v) => ({ value: v, label: humanize(v) }))} {...form.register('status')} />
            </Field>
          )}
        </div>
      </FormSection>
      <FormSection title="Parent or guardian">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={errors.guardianName?.message}>
            <Input {...form.register('guardianName')} />
          </Field>
          <Field label="Phone" error={errors.guardianPhone?.message}>
            <Input type="tel" {...form.register('guardianPhone')} />
          </Field>
        </div>
      </FormSection>
    </>
  );
}

export function studentDefaults(student?: StudentDto | null): StudentInput {
  return {
    fullName: student?.fullName ?? '',
    phone: student?.phone ?? '',
    email: student?.email ?? '',
    address: student?.address ?? '',
    city: student?.city ?? '',
    dateOfBirth: student?.dateOfBirth ?? '',
    emergencyContactName: student?.emergencyContactName ?? '',
    emergencyContactPhone: student?.emergencyContactPhone ?? '',
    notes: student?.notes ?? '',
    gender: (student?.gender ?? '') as StudentInput['gender'],
    qualification: student?.qualification ?? '',
    yearOfPassing: student?.yearOfPassing ?? '',
    state: student?.state ?? '',
    pincode: student?.pincode ?? '',
    guardianName: student?.guardianName ?? '',
    guardianPhone: student?.guardianPhone ?? '',
    status: (student?.status ?? 'active') as StudentInput['status'],
  };
}

interface StudentFormDrawerProps {
  student: StudentDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (student: StudentDto) => void;
}

export function StudentFormDrawer({ student, open, onOpenChange, onSaved }: StudentFormDrawerProps) {
  const queryClient = useQueryClient();
  const defaults = useMemo(() => studentDefaults(student), [student]);
  const form = useZodForm(studentSchema, { defaultValues: defaults });
  const [conflict, setConflict] = useState<DuplicateMatch[] | null>(null);
  const [enablePortal, setEnablePortal] = useState(true);
  const [portalPassword, setPortalPassword] = useState('Student@1234');

  useEffect(() => {
    if (open) {
      form.reset(defaults);
      setConflict(null);
      setEnablePortal(true);
      setPortalPassword('Student@1234');
    }
  }, [open, defaults, form]);

  const duplicates = useDuplicateCheck('students', form.watch('phone'), form.watch('email') ?? undefined, student?.id);

  const save = useMutation({
    mutationFn: ({ values, allowDuplicate }: { values: StudentInput & { portalPassword?: string }; allowDuplicate?: boolean }) =>
      student ? api.put<StudentDto>(`/students/${student.id}`, values) : api.post<StudentDto>('/students', { ...values, allowDuplicate }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['students'] });
      toast.success(student ? 'Student updated' : `Student ${saved.studentCode} registered`);
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.code === 'DUPLICATE_STUDENT') {
        setConflict((error.details as { matches: DuplicateMatch[] }).matches);
        return;
      }
      handleFormError(form, error);
    },
  });

  const submit = (allowDuplicate = false) =>
    form.handleSubmit((values) =>
      save.mutate({
        values: {
          ...(values as StudentInput),
          ...(enablePortal && portalPassword ? { portalPassword } : {}),
        },
        allowDuplicate,
      }),
    )();

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={student ? `Edit ${student.fullName}` : 'Register student'}
        description="One profile per person: returning students get a new admission, not a new profile."
        dismissible={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            {conflict ? (
              <Button variant="danger" loading={save.isPending} onClick={() => void submit(true)}>
                Different person, register anyway
              </Button>
            ) : (
              <Button loading={save.isPending} onClick={() => void submit()}>
                {student ? 'Save changes' : 'Register student'}
              </Button>
            )}
          </>
        }
      >
        <form noValidate className="space-y-6" onSubmit={(e) => e.preventDefault()}>
          <FormSection title="Contact">
            <StudentFields form={form} />
          </FormSection>
          {Boolean(form.watch('email')) && (
            <FormSection title="Student portal login">
              <div className="space-y-3 rounded-control border bg-surface-sunken p-3">
                <Checkbox
                  id="enable-portal"
                  checked={enablePortal}
                  onCheckedChange={(checked) => setEnablePortal(Boolean(checked))}
                  label={<span className="text-sm font-medium text-fg">Enable student portal login</span>}
                />
                {enablePortal && (
                  <div className="space-y-2 pt-1">
                    <label className="block text-xs font-medium text-fg-muted">Portal password for {form.watch('email')}</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className="flex-1 rounded border bg-surface px-3 py-1.5 font-mono text-sm text-fg"
                        value={portalPassword}
                        onChange={(e) => setPortalPassword(e.target.value)}
                        placeholder="Minimum 10 characters"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
                          const rand = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
                          setPortalPassword(`Student@${rand}2026`);
                        }}
                      >
                        Generate
                      </Button>
                    </div>
                    <p className="text-xs text-fg-subtle">The student can sign in with their email and this password immediately.</p>
                  </div>
                )}
              </div>
            </FormSection>
          )}
          <DuplicateWarning matches={conflict ?? duplicates.data} />
          <StudentProfileFields form={form} isEdit={Boolean(student)} />
          <Field label="Notes" error={form.formState.errors.notes?.message}>
            <Textarea {...form.register('notes')} />
          </Field>
        </form>
      </DrawerContent>
    </DialogRoot>
  );
}
