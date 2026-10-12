/**
 * Dialogs that change an admission's money position: create / restructure a
 * plan, refund, and approve an adjustment. Each is a deliberate, audited act.
 */

import {
  FEE_ADJUSTMENT_TYPES,
  PAYMENT_METHODS,
  adjustmentFormSchema,
  refundFormSchema,
  todayInZone,
  type AdmissionDto,
  type PaymentDto,
} from '@ims/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { DialogContent, DialogRoot } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { api } from '@/lib/api';
import { handleFormError, toastError, useZodForm } from '@/lib/forms';
import { getFormatConfig, humanize, money } from '@/utils/format';
import { useInvalidateMoney } from './api';
import { FeePlanFields, feePlanPayload, useFeePlanState } from './FeePlanFields';

interface Base {
  admission: AdmissionDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PlanDialog({ admission, open, onOpenChange, restructure }: Base & { restructure: boolean }) {
  const invalidate = useInvalidateMoney();
  const plan = useFeePlanState();
  const today = todayInZone(getFormatConfig().timeZone);
  const start = restructure ? today : admission.admissionDate;
  const admissionFee = admission.status === 'pending_payment' ? Math.max(0, admission.admissionFeeRequiredMinor - admission.netPaidMinor) : 0;

  useEffect(() => {
    if (open) plan.setState((s) => ({ ...s, planType: 'admission_plus_monthly', startDate: start, firstDueDate: '' }));
  }, [open, start, plan.setState]);

  const save = useMutation({
    mutationFn: () => {
      const body = feePlanPayload(plan.state, start);
      return api.post(`/admissions/${admission.id}/fee-plan${restructure ? '/restructure' : ''}`, body);
    },
    onSuccess: () => {
      invalidate();
      toast.success(restructure ? 'Plan restructured' : 'Payment plan created');
      onOpenChange(false);
    },
    onError: (error) => toastError(error),
  });

  const problem = plan.validate(admission.outstandingMinor, admissionFee);
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={restructure ? 'Restructure payment plan' : 'Create payment plan'}
        description={`Schedules the outstanding ${money(admission.outstandingMinor)}.${restructure ? ' Unpaid instalments of the current plan are closed; paid ones stay as history.' : ''}`}
        size="lg"
        dismissible={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={save.isPending} disabled={!!problem} onClick={() => save.mutate()}>
              {restructure ? 'Restructure' : 'Create plan'}
            </Button>
          </>
        }
      >
        <FeePlanFields plan={plan} agreedMinor={admission.outstandingMinor} admissionFeeMinor={admissionFee} required defaultStart={start} />
      </DialogContent>
    </DialogRoot>
  );
}

export function RefundDialog({ admission, open, onOpenChange, receipts }: Base & { receipts: PaymentDto[] }) {
  const invalidate = useInvalidateMoney();
  const today = todayInZone(getFormatConfig().timeZone);
  const form = useZodForm(refundFormSchema, { defaultValues: { amountMinor: '', paymentDate: today, method: 'bank_transfer', referenceNumber: '', reason: '', refundOfId: undefined } });
  useEffect(() => {
    if (open) form.reset({ amountMinor: '', paymentDate: today, method: 'bank_transfer', referenceNumber: '', reason: '', refundOfId: undefined });
  }, [open, form, today]);

  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) => api.post<PaymentDto>(`/admissions/${admission.id}/refunds`, values),
    onSuccess: (refund) => {
      invalidate();
      toast.success(`Refund ${refund.receiptNumber} recorded`);
      onOpenChange(false);
    },
    onError: (error) => handleFormError(form, error),
  });
  const errors = form.formState.errors;
  const eligible = receipts.filter((p) => p.direction === 'in' && p.status === 'succeeded');

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Record a refund"
        description={`Up to ${money(admission.netPaidMinor)} received (net) can be refunded. Refunds are reported separately from collections.`}
        dismissible={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="danger" loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate({ ...v, refundOfId: v.refundOfId || undefined }))}>Record refund</Button>
          </>
        }
      >
        <form noValidate className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount" error={errors.amountMinor?.message} required><MoneyInput {...form.register('amountMinor')} /></Field>
            <Field label="Date" error={errors.paymentDate?.message} required><Input type="date" max={today} {...form.register('paymentDate')} /></Field>
            <Field label="Method" error={errors.method?.message} required>
              <Select options={PAYMENT_METHODS.filter((m) => m !== 'finance_disbursement').map((m) => ({ value: m, label: humanize(m) }))} {...form.register('method')} />
            </Field>
            <Field label="Reference" error={errors.referenceNumber?.message}><Input {...form.register('referenceNumber')} /></Field>
          </div>
          <Field label="Against receipt" hint="Optional: links the refund to a specific receipt.">
            <Select placeholder="Not linked" options={eligible.map((p) => ({ value: p.id, label: `${p.receiptNumber} · ${money(p.amountMinor)}` }))} {...form.register('refundOfId')} />
          </Field>
          <Field label="Reason" error={errors.reason?.message} required><Textarea rows={2} {...form.register('reason')} /></Field>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

export function AdjustmentDialog({ admission, open, onOpenChange }: Base) {
  const invalidate = useInvalidateMoney();
  const today = todayInZone(getFormatConfig().timeZone);
  const form = useZodForm(adjustmentFormSchema, { defaultValues: { type: 'discount', amountMinor: '', effectiveDate: today, reason: '' } });
  useEffect(() => {
    if (open) form.reset({ type: 'discount', amountMinor: '', effectiveDate: today, reason: '' });
  }, [open, form, today]);

  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) => api.post(`/admissions/${admission.id}/adjustments`, values),
    onSuccess: () => {
      invalidate();
      toast.success('Adjustment approved');
      onOpenChange(false);
    },
    onError: (error) => handleFormError(form, error),
  });
  const errors = form.formState.errors;
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Approve a fee adjustment"
        description={`Reduces what is owed from its effective date. Outstanding now: ${money(admission.outstandingMinor)}.`}
        dismissible={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v))}>Approve</Button>
          </>
        }
      >
        <form noValidate className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Type" required><Select options={FEE_ADJUSTMENT_TYPES.map((t) => ({ value: t, label: humanize(t) }))} {...form.register('type')} /></Field>
            <Field label="Amount" error={errors.amountMinor?.message} required><MoneyInput {...form.register('amountMinor')} /></Field>
            <Field label="Effective" error={errors.effectiveDate?.message} required><Input type="date" {...form.register('effectiveDate')} /></Field>
          </div>
          <Field label="Reason" error={errors.reason?.message} required><Textarea rows={2} {...form.register('reason')} /></Field>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
