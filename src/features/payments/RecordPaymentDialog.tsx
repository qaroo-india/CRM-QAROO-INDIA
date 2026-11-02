/**
 * Record a payment. Allocation is automatic (oldest unpaid instalment first)
 * unless the cashier chooses instalments by hand; the server re-validates
 * either way. A fresh idempotency key per opening means a retried submission
 * after a network blip returns the same receipt instead of a second one.
 */

import { PAYMENT_METHODS, paymentCreateFormSchema, todayInZone, toMinor, type AdmissionDto, type PaymentDto } from '@ims/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { DialogContent, DialogRoot } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { api } from '@/lib/api';
import { handleFormError, useZodForm } from '@/lib/forms';
import { date, getFormatConfig, humanize, money } from '@/utils/format';
import { newIdempotencyKey } from '../shared/hooks';
import { AdmissionPicker } from './AdmissionPicker';
import { useAdmissionFinance, useInvalidateMoney } from './api';

interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preselected admission; otherwise the cashier searches for one. */
  admission?: AdmissionDto | null;
  onRecorded?: (payment: PaymentDto) => void;
}

export function RecordPaymentDialog({ open, onOpenChange, admission: preset, onRecorded }: RecordPaymentDialogProps) {
  const invalidate = useInvalidateMoney();
  const [admission, setAdmission] = useState<AdmissionDto | null>(preset ?? null);
  const [key, setKey] = useState(newIdempotencyKey);
  const [manual, setManual] = useState(false);
  const [split, setSplit] = useState<Record<string, string>>({});
  const finance = useAdmissionFinance(admission?.id);
  const today = todayInZone(getFormatConfig().timeZone);

  const form = useZodForm(paymentCreateFormSchema, {
    defaultValues: { admissionId: preset?.id ?? '', paymentDate: today, amountMinor: '', method: 'upi', referenceNumber: '', notes: '' },
  });

  useEffect(() => {
    if (!open) return;
    setAdmission(preset ?? null);
    setKey(newIdempotencyKey());
    setManual(false);
    setSplit({});
    form.reset({ admissionId: preset?.id ?? '', paymentDate: today, amountMinor: '', method: 'upi', referenceNumber: '', notes: '' });
  }, [open, preset, form, today]);

  useEffect(() => {
    form.setValue('admissionId', admission?.id ?? '');
  }, [admission, form]);

  const openInstalments = useMemo(
    () => finance.data?.activePlan?.instalments.filter((i) => i.state === 'active' && i.remainingMinor > 0) ?? [],
    [finance.data],
  );
  const splitTotal = Object.values(split).reduce((sum, value) => {
    try {
      return sum + (value.trim() ? toMinor(value) : 0);
    } catch {
      return Number.NaN;
    }
  }, 0);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<PaymentDto>('/payments', body, { headers: { 'Idempotency-Key': key } }),
    onSuccess: (payment) => {
      invalidate();
      toast.success(`Receipt ${payment.receiptNumber} recorded: ${money(payment.amountMinor)}`);
      onOpenChange(false);
      onRecorded?.(payment);
    },
    onError: (error) => handleFormError(form, error, 'Could not record the payment'),
  });

  const submit = form.handleSubmit((values) => {
    const allocations = manual
      ? Object.entries(split)
          .filter(([, value]) => value.trim())
          .map(([instalmentId, value]) => ({ instalmentId, amountMinor: toMinor(value) }))
      : undefined;
    save.mutate({ ...values, allocations });
  });

  const outstanding = finance.data?.admission.outstandingMinor ?? admission?.outstandingMinor ?? 0;
  const errors = form.formState.errors;

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Record payment"
        description="Receipts are permanent: a mistake is corrected by reversal, never by editing."
        size="lg"
        dismissible={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={save.isPending} disabled={!admission || (manual && !Number.isFinite(splitTotal))} onClick={() => void submit()}>
              Record receipt
            </Button>
          </>
        }
      >
        <form noValidate className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          {preset ? null : (
            <Field label="Admission" required error={errors.admissionId ? 'Choose an admission' : undefined}>
              <AdmissionPicker value={admission} onChange={setAdmission} outstandingOnly />
            </Field>
          )}
          {admission && (
            <p className="rounded-control border bg-surface-sunken px-3 py-2 text-sm text-fg-muted">
              {admission.studentName} · {admission.admissionNumber} · outstanding <span className="font-semibold text-fg">{money(outstanding)}</span>
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Amount" error={errors.amountMinor?.message} required>
              <MoneyInput autoFocus={!!preset} {...form.register('amountMinor')} />
            </Field>
            <Field label="Date" error={errors.paymentDate?.message} required>
              <Input type="date" max={today} {...form.register('paymentDate')} />
            </Field>
            <Field label="Method" error={errors.method?.message} required>
              <Select options={PAYMENT_METHODS.filter((m) => m !== 'finance_disbursement').map((m) => ({ value: m, label: humanize(m) }))} {...form.register('method')} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reference" hint="UPI ref, cheque number or bank transaction ID." error={errors.referenceNumber?.message}>
              <Input {...form.register('referenceNumber')} />
            </Field>
            <Field label="Notes" error={errors.notes?.message}>
              <Textarea rows={1} {...form.register('notes')} />
            </Field>
          </div>

          {openInstalments.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="flex w-full items-center justify-between text-sm font-medium text-fg">
                Allocation
                <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setManual((m) => !m)}>
                  {manual ? 'Allocate automatically' : 'Choose instalments'}
                </button>
              </legend>
              {!manual ? (
                <p className="text-xs text-fg-muted">Applied to the oldest unpaid instalment first.</p>
              ) : (
                <div className="overflow-x-auto rounded-control border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-surface-raised text-left text-xs text-fg-subtle uppercase">
                        <th scope="col" className="px-3 py-2 font-medium">Instalment</th>
                        <th scope="col" className="px-3 py-2 font-medium">Due</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Remaining</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Apply</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openInstalments.map((inst) => (
                        <tr key={inst.id} className="border-b last:border-b-0">
                          <td className="px-3 py-2">#{inst.sequence} {humanize(inst.kind)}</td>
                          <td className="px-3 py-2 text-fg-muted tabular-nums">{date(inst.dueDate)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(inst.remainingMinor)}</td>
                          <td className="w-36 px-3 py-1.5">
                            <MoneyInput aria-label={`Apply to instalment ${inst.sequence}`} className="h-8" value={split[inst.id] ?? ''} onChange={(e) => setSplit((s) => ({ ...s, [inst.id]: e.target.value }))} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="border-t px-3 py-2 text-right text-xs text-fg-muted">
                    Allocated {Number.isFinite(splitTotal) ? money(splitTotal) : 'invalid amount'} — must equal the payment amount
                  </p>
                </div>
              )}
            </fieldset>
          )}
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
