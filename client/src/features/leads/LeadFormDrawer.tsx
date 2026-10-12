import { LEAD_PRIORITIES, leadSchema, todayInZone, type LeadDetail, type LeadDto, type LeadInput } from '@ims/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { DialogRoot, DrawerContent } from '@/components/ui/Dialog';
import { Field, FormSection } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { api } from '@/lib/api';
import { handleFormError, useZodForm } from '@/lib/forms';
import { getFormatConfig, humanize } from '@/utils/format';
import { toOptions, useCourses, useLeadSources, useUserOptions } from '../shared/hooks';
import { leadKeys, useDuplicateCheck } from './api';
import { DuplicateWarning } from './DuplicateWarning';

interface LeadFormDrawerProps {
  lead: LeadDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (lead: LeadDetail) => void;
}

export function LeadFormDrawer({ lead, open, onOpenChange, onSaved }: LeadFormDrawerProps) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const sources = useLeadSources();
  const courses = useCourses(true);
  const people = useUserOptions();
  const [showTracking, setShowTracking] = useState(false);

  const defaults = useMemo<LeadInput>(
    () =>
      lead
        ? {
            name: lead.name,
            phone: lead.phone,
            email: lead.email ?? '',
            enquiryDate: lead.enquiryDate,
            leadSourceId: lead.leadSourceId,
            campaignName: lead.campaignName ?? '',
            adReference: lead.adReference ?? '',
            utmSource: lead.utmSource ?? '',
            utmMedium: lead.utmMedium ?? '',
            utmCampaign: lead.utmCampaign ?? '',
            utmTerm: lead.utmTerm ?? '',
            utmContent: lead.utmContent ?? '',
            interestedCourseId: lead.interestedCourseId ?? '',
            counsellorId: lead.counsellorId ?? '',
            followUpDate: lead.followUpDate ?? '',
            priority: lead.priority,
            notes: lead.notes ?? '',
          }
        : {
            name: '',
            phone: '',
            email: '',
            enquiryDate: todayInZone(getFormatConfig().timeZone),
            leadSourceId: '',
            interestedCourseId: '',
            counsellorId: auth.user?.id ?? '',
            followUpDate: '',
            priority: 'medium',
            notes: '',
          },
    [lead, auth.user?.id],
  );

  const form = useZodForm(leadSchema, { defaultValues: defaults });
  useEffect(() => {
    if (open) {
      form.reset(defaults);
      setShowTracking(Boolean(lead?.campaignName || lead?.utmSource));
    }
  }, [open, defaults, form, lead]);

  const phone = form.watch('phone');
  const email = form.watch('email');
  const duplicates = useDuplicateCheck('leads', phone, email ?? undefined, lead?.id);

  const save = useMutation({
    mutationFn: (values: LeadInput) => (lead ? api.put<LeadDetail>(`/leads/${lead.id}`, values) : api.post<LeadDetail>('/leads', values)),
    onSuccess: (saved) => {
      queryClient.setQueryData(leadKeys.detail(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: ['leads', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['leads', 'board'] });
      toast.success(lead ? 'Enquiry updated' : `Enquiry ${saved.leadCode} recorded`);
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: (error) => handleFormError(form, error),
  });

  const errors = form.formState.errors;
  const converted = lead?.status === 'converted';

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={lead ? `Edit ${lead.leadCode}` : 'New enquiry'}
        description={converted ? 'Converted enquiry: its source is locked to keep admission attribution traceable.' : 'Every enquiry needs a source so marketing performance stays traceable.'}
        dismissible={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={save.isPending} onClick={form.handleSubmit((values) => save.mutate(values as LeadInput))}>
              {lead ? 'Save changes' : 'Record enquiry'}
            </Button>
          </>
        }
      >
        <form noValidate className="space-y-6" onSubmit={(e) => e.preventDefault()}>
          <FormSection title="Contact">
            <Field label="Name" error={errors.name?.message} required>
              <Input autoComplete="off" {...form.register('name')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone" error={errors.phone?.message} required>
                <Input type="tel" autoComplete="off" {...form.register('phone')} />
              </Field>
              <Field label="Email" error={errors.email?.message}>
                <Input type="email" autoComplete="off" {...form.register('email')} />
              </Field>
            </div>
            <DuplicateWarning matches={duplicates.data} />
          </FormSection>

          <FormSection title="Enquiry">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Enquiry date" error={errors.enquiryDate?.message} required>
                <Input type="date" {...form.register('enquiryDate')} />
              </Field>
              {converted ? (
                // Locked, but still submitted: a disabled input would be dropped
                // from the form values and fail validation.
                <Field label="Source" hint="Locked after conversion.">
                  <Input readOnly value={lead?.sourceName ?? ''} />
                </Field>
              ) : (
                <Field label="Source" error={errors.leadSourceId?.message} required>
                  <Select options={toOptions(sources.data)} placeholder="Select a source…" {...form.register('leadSourceId')} />
                </Field>
              )}
              {converted && <input type="hidden" {...form.register('leadSourceId')} />}
              <Field label="Interested course" error={errors.interestedCourseId?.message}>
                <Select options={toOptions(courses.data)} placeholder="Not decided" {...form.register('interestedCourseId')} />
              </Field>
              <Field label="Counsellor" error={errors.counsellorId?.message}>
                <Select options={toOptions(people.data)} placeholder="Unassigned" {...form.register('counsellorId')} />
              </Field>
              <Field label="Priority" error={errors.priority?.message}>
                <Select options={LEAD_PRIORITIES.map((p) => ({ value: p, label: humanize(p) }))} {...form.register('priority')} />
              </Field>
              <Field label="Follow-up date" error={errors.followUpDate?.message}>
                <Input type="date" {...form.register('followUpDate')} />
              </Field>
            </div>
            <Field label="Notes" error={errors.notes?.message}>
              <Textarea {...form.register('notes')} />
            </Field>
          </FormSection>

          <FormSection title="Campaign tracking" description="Optional: ad references and UTM parameters for source analytics.">
            {showTracking ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Campaign name"><Input {...form.register('campaignName')} /></Field>
                <Field label="Ad reference"><Input {...form.register('adReference')} /></Field>
                <Field label="utm_source"><Input className="font-mono text-xs" {...form.register('utmSource')} /></Field>
                <Field label="utm_medium"><Input className="font-mono text-xs" {...form.register('utmMedium')} /></Field>
                <Field label="utm_campaign"><Input className="font-mono text-xs" {...form.register('utmCampaign')} /></Field>
                <Field label="utm_term"><Input className="font-mono text-xs" {...form.register('utmTerm')} /></Field>
                <Field label="utm_content"><Input className="font-mono text-xs" {...form.register('utmContent')} /></Field>
              </div>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setShowTracking(true)}>Add campaign details</Button>
            )}
          </FormSection>
        </form>
      </DrawerContent>
    </DialogRoot>
  );
}
