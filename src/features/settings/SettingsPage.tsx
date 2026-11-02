import { updateSettingsSchema, type InstituteInfo, type SessionResponse, type UpdateSettingsInput } from '@ims/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Controller } from 'react-hook-form';
import { toast } from 'sonner';
import { sessionQueryKey, useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Field, FormSection } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Menu';
import { PageHeader } from '@/components/ui/PageHeader';
import { Switch } from '@/components/ui/Toggle';
import { api } from '@/lib/api';
import { handleFormError, useZodForm } from '@/lib/forms';
import { LookupManager } from './LookupManager';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function SettingsForm({ institute, canWrite }: { institute: InstituteInfo; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const form = useZodForm(updateSettingsSchema, { defaultValues: institute });

  useEffect(() => form.reset(institute), [institute, form]);

  const save = useMutation({
    mutationFn: (values: UpdateSettingsInput) => api.patch<InstituteInfo>('/settings', values),
    onSuccess: (updated) => {
      queryClient.setQueryData<SessionResponse | null>(sessionQueryKey, (session) => (session ? { ...session, institute: updated } : session));
      toast.success('Settings saved');
    },
    onError: (error) => handleFormError(form, error),
  });

  const errors = form.formState.errors;
  const submit = form.handleSubmit((values) => save.mutate(values));
  const footer = canWrite && (
    <div className="flex justify-end border-t pt-4">
      <Button loading={save.isPending} disabled={!form.formState.isDirty} onClick={() => void submit()}>
        Save changes
      </Button>
    </div>
  );

  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <fieldset disabled={!canWrite} className="contents">
        <TabsContent value="profile" className="space-y-6">
          <FormSection title="Identity" description="Printed on receipts, report headers and emails.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Institute name" error={errors.name?.message} required>
                <Input {...form.register('name')} />
              </Field>
              <Field label="Legal name" error={errors.legalName?.message}>
                <Input {...form.register('legalName')} />
              </Field>
              <Field label="Tagline" error={errors.tagline?.message}>
                <Input {...form.register('tagline')} />
              </Field>
              <Field label="Logo URL" hint="An https link to a PNG or SVG." error={errors.logoUrl?.message}>
                <Input type="url" {...form.register('logoUrl')} />
              </Field>
              <Field label="Tax registration (GSTIN)" error={errors.taxId?.message}>
                <Input {...form.register('taxId')} />
              </Field>
              <Field label="Website" error={errors.website?.message}>
                <Input {...form.register('website')} />
              </Field>
              <Field label="Email" error={errors.email?.message}>
                <Input type="email" {...form.register('email')} />
              </Field>
              <Field label="Phone" error={errors.phone?.message}>
                <Input type="tel" {...form.register('phone')} />
              </Field>
            </div>
            <Field label="Address" error={errors.address?.message}>
              <Textarea {...form.register('address')} />
            </Field>
          </FormSection>
          {footer}
        </TabsContent>

        <TabsContent value="operations" className="space-y-6">
          <FormSection title="Calendar" description="Defines 'this week' and the financial year in every report.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Financial year starts in">
                <Select options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} {...form.register('fiscalYearStartMonth', { valueAsNumber: true })} />
              </Field>
              <Field label="Week starts on">
                <Select options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} {...form.register('weekStartsOn', { valueAsNumber: true })} />
              </Field>
            </div>
            <p className="text-xs text-fg-subtle">
              Time zone: <span className="font-mono">{institute.timezone}</span> · Currency: <span className="font-mono">{institute.currency}</span>. These are fixed after setup so historical reports never shift.
            </p>
          </FormSection>

          <FormSection title="Reminders and approvals">
            <Controller
              control={form.control}
              name="expenseApprovalRequired"
              render={({ field }) => (
                <Switch
                  id="expense-approval"
                  checked={!!field.value}
                  onCheckedChange={field.onChange}
                  label="Expenses need owner approval"
                  description="New expenses wait as 'pending' and are excluded from totals until approved."
                />
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Instalment reminder (days before due)" error={errors.dueReminderDays?.message}>
                <Input type="number" min={0} max={30} {...form.register('dueReminderDays', { valueAsNumber: true })} />
              </Field>
              <Field label="Unassigned student alert (days)" error={errors.unassignedAlertDays?.message}>
                <Input type="number" min={1} max={90} {...form.register('unassignedAlertDays', { valueAsNumber: true })} />
              </Field>
            </div>
            <Controller
              control={form.control}
              name="reportRecipients"
              render={({ field, fieldState }) => (
                <Field
                  label="Additional report recipients"
                  hint="Comma-separated emails allowed to receive reports, beyond staff accounts."
                  error={fieldState.error?.message ?? (Array.isArray(errors.reportRecipients) ? 'One of the emails is invalid' : undefined)}
                >
                  <Input
                    defaultValue={(field.value ?? []).join(', ')}
                    onBlur={(e) => field.onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                  />
                </Field>
              )}
            />
          </FormSection>
          {footer}
        </TabsContent>

        <TabsContent value="codes" className="space-y-6">
          <FormSection title="Code prefixes" description="Used for new records only; existing codes never change.">
            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  ['studentCodePrefix', 'Students', 'STU'],
                  ['admissionNumberPrefix', 'Admissions', 'ADM'],
                  ['receiptNumberPrefix', 'Receipts', 'RCT'],
                  ['leadCodePrefix', 'Leads', 'LEAD'],
                  ['expenseCodePrefix', 'Expenses', 'EXP'],
                ] as const
              ).map(([name, label, example]) => (
                <Field key={name} label={label} hint={`e.g. ${example}-2026-00042`} error={errors[name]?.message}>
                  <Input className="font-mono uppercase" maxLength={6} {...form.register(name)} />
                </Field>
              ))}
            </div>
          </FormSection>
          {footer}
        </TabsContent>
      </fieldset>
    </form>
  );
}

export function SettingsPage() {
  const auth = useAuth();
  const canWrite = auth.can('settings:write');
  if (!auth.institute) return null;

  return (
    <>
      <PageHeader
        title="Institute settings"
        description="Identity, reporting calendar, reminders, code formats and the lists your team picks from."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Institute settings' }]}
      />
      <Card>
        <CardContent>
          <Tabs defaultValue="profile">
            <TabsList className="mb-6">
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="operations">Operations</TabsTrigger>
              <TabsTrigger value="codes">Codes</TabsTrigger>
              <TabsTrigger value="lead-sources">Lead sources</TabsTrigger>
              <TabsTrigger value="expense-categories">Expense categories</TabsTrigger>
              <TabsTrigger value="job-categories">Job categories</TabsTrigger>
            </TabsList>

            <SettingsForm institute={auth.institute} canWrite={canWrite} />

            <TabsContent value="lead-sources" className="max-w-xl">
              <LookupManager path="lead-sources" noun="Lead source" canWrite={canWrite} />
            </TabsContent>
            <TabsContent value="expense-categories" className="max-w-xl">
              <LookupManager path="expense-categories" noun="Expense category" canWrite={canWrite} />
            </TabsContent>
            <TabsContent value="job-categories" className="grid gap-6 lg:grid-cols-2">
              <section>
                <h3 className="mb-3 text-sm font-semibold text-fg">Technical</h3>
                <LookupManager path="job-categories" noun="Job category" track="technical" canWrite={canWrite} />
              </section>
              <section>
                <h3 className="mb-3 text-sm font-semibold text-fg">Non-technical</h3>
                <LookupManager path="job-categories" noun="Job category" track="non_technical" canWrite={canWrite} />
              </section>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </>
  );
}
