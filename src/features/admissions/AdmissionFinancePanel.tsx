/**
 * Fee plan, instalments, receipts, refunds, adjustments and loans for one
 * admission, with the actions each permission allows.
 */

import type { AdmissionDto, PaymentDto } from '@ims/shared';
import { useMutation } from '@tanstack/react-query';
import { BadgePercent, CalendarClock, Landmark, Receipt, RotateCcw, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { toastError } from '@/lib/forms';
import { date, humanize, money } from '@/utils/format';
import { useAdmissionFinance, useInvalidateMoney, useReversePayment } from '../payments/api';
import { AdjustmentDialog, PlanDialog, RefundDialog } from '../payments/FinanceDialogs';
import { ReceiptDialog } from '../payments/ReceiptDialog';
import { RecordPaymentDialog } from '../payments/RecordPaymentDialog';

function SectionHeader({ icon: Icon, title, action }: { icon: typeof Receipt; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-fg"><Icon aria-hidden className="size-4 text-fg-subtle" />{title}</h3>
      {action}
    </div>
  );
}

export function AdmissionFinancePanel({ admission }: { admission: AdmissionDto }) {
  const auth = useAuth();
  const finance = useAdmissionFinance(admission.id);
  const invalidate = useInvalidateMoney();
  const reverse = useReversePayment();
  const [recording, setRecording] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [planMode, setPlanMode] = useState<'create' | 'restructure' | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [reversing, setReversing] = useState<PaymentDto | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);

  const voidAdjustment = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/adjustments/${id}/void`, { reason }),
    onSuccess: () => {
      invalidate();
      toast.success('Adjustment voided');
      setVoiding(null);
    },
    onError: (error) => toastError(error),
  });

  if (!auth.canAny('payments:read', 'feePlans:read')) return null;
  if (finance.isPending) return <LoadingBlock label="Loading payments…" />;
  if (finance.isError) return <ErrorState error={finance.error} onRetry={() => void finance.refetch()} />;

  const f = finance.data;
  const a = f.admission;
  const live = a.status !== 'cancelled';
  const plan = f.activePlan;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {live && auth.can('payments:write') && a.outstandingMinor > 0 && (
          <Button size="sm" onClick={() => setRecording(true)}><Receipt aria-hidden className="size-3.5" /> Record payment</Button>
        )}
        {auth.can('payments:refund') && a.netPaidMinor > 0 && (
          <Button size="sm" variant="secondary" onClick={() => setRefundOpen(true)}><Undo2 aria-hidden className="size-3.5" /> Refund</Button>
        )}
        {live && auth.can('discounts:approve') && a.outstandingMinor > 0 && (
          <Button size="sm" variant="secondary" onClick={() => setAdjustOpen(true)}><BadgePercent aria-hidden className="size-3.5" /> Adjustment</Button>
        )}
      </div>

      <section>
        <SectionHeader
          icon={CalendarClock}
          title={plan ? `Payment plan · ${humanize(plan.planType)}` : 'Payment plan'}
          action={
            live && auth.can('feePlans:write') && a.outstandingMinor > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => setPlanMode(plan ? 'restructure' : 'create')}>
                {plan ? <><RotateCcw aria-hidden className="size-3.5" /> Restructure</> : 'Create plan'}
              </Button>
            ) : undefined
          }
        />
        {plan ? (
          <div className="overflow-x-auto rounded-control border">
            <table className="w-full text-sm">
              <caption className="sr-only">Instalments</caption>
              <thead>
                <tr className="border-b bg-surface-raised text-left text-xs text-fg-subtle uppercase">
                  <th scope="col" className="px-3 py-2 font-medium">#</th>
                  <th scope="col" className="px-3 py-2 font-medium">Due</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Paid</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {plan.instalments.map((row) => (
                  <tr key={row.id} className="border-b last:border-b-0">
                    <td className="px-3 py-2 text-fg-muted">{row.sequence} <span className="text-xs">{row.kind === 'admission_fee' ? 'Admission fee' : row.kind === 'loan_disbursement' ? 'Lender' : ''}</span></td>
                    <td className="px-3 py-2 tabular-nums">{date(row.dueDate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(row.amountMinor)}</td>
                    <td className="px-3 py-2 text-right text-fg-muted tabular-nums">{money(row.paidMinor)}</td>
                    <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-control border border-dashed p-3 text-sm text-fg-muted">No payment plan yet. Receipts are still recorded against the agreed fee.</p>
        )}
        {f.previousPlans.length > 0 && <p className="mt-2 text-xs text-fg-subtle">{f.previousPlans.length} earlier plan(s) superseded; their paid instalments remain in the history.</p>}
      </section>

      <section>
        <SectionHeader icon={Receipt} title={`Receipts (${f.payments.length})`} />
        {f.payments.length === 0 ? (
          <p className="text-sm text-fg-muted">No payments recorded.</p>
        ) : (
          <ul className="divide-y rounded-control border">
            {f.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <button type="button" onClick={() => setReceiptId(p.id)} className="min-w-0 flex-1 text-left">
                  <span className="block text-sm font-medium text-fg hover:text-primary">
                    <span className="font-mono">{p.receiptNumber}</span> · {date(p.paymentDate)}
                  </span>
                  <span className="block text-xs text-fg-subtle">{humanize(p.method)}{p.referenceNumber ? ` · ${p.referenceNumber}` : ''} · {p.recordedByName ?? 'System'}</span>
                </button>
                <span className={cn('text-sm font-semibold tabular-nums', p.status === 'reversed' ? 'text-fg-subtle line-through' : p.direction === 'refund' ? 'text-danger' : 'text-fg')}>
                  {p.direction === 'refund' ? '−' : ''}{money(p.amountMinor)}
                </span>
                <StatusBadge status={p.direction === 'refund' && p.status === 'succeeded' ? 'refund' : p.status} label={p.direction === 'refund' && p.status === 'succeeded' ? 'Refund' : undefined} />
                {p.status === 'succeeded' && auth.can('payments:reverse') && (
                  <Button size="sm" variant="ghost" onClick={() => setReversing(p)}>Reverse</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {f.adjustments.length > 0 && (
        <section>
          <SectionHeader icon={BadgePercent} title="Adjustments" />
          <ul className="divide-y rounded-control border">
            {f.adjustments.map((adj) => (
              <li key={adj.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                <span className="flex-1">
                  <span className={cn('font-medium', adj.voidedAt ? 'text-fg-subtle line-through' : 'text-fg')}>{humanize(adj.type)} · {money(adj.amountMinor)}</span>
                  <span className="block text-xs text-fg-subtle">{date(adj.effectiveDate)} · {adj.reason}{adj.voidedAt ? ` · voided: ${adj.voidReason}` : ''}</span>
                </span>
                {!adj.voidedAt && auth.can('discounts:approve') && <Button size="sm" variant="ghost" onClick={() => setVoiding(adj.id)}>Void</Button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(f.loans.length > 0 || auth.can('loans:write')) && (
        <section>
          <SectionHeader
            icon={Landmark}
            title="Financing"
            action={auth.can('loans:write') && live ? <Link to={`/loans?action=new&admission=${a.id}`} className="text-xs font-medium text-primary hover:underline">New application</Link> : undefined}
          />
          {f.loans.length === 0 ? (
            <p className="text-sm text-fg-muted">No financing on this admission.</p>
          ) : (
            <ul className="divide-y rounded-control border">
              {f.loans.map((loan) => (
                <li key={loan.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                  <Link to={`/loans?loan=${loan.id}`} className="flex-1 font-medium text-fg hover:text-primary">{loan.providerName}</Link>
                  <span className="text-xs text-fg-muted">requested {money(loan.requestedMinor)} · received {money(loan.receivedMinor)}</span>
                  <StatusBadge status={loan.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <RecordPaymentDialog open={recording} onOpenChange={setRecording} admission={a} onRecorded={(p) => setReceiptId(p.id)} />
      <ReceiptDialog paymentId={receiptId} onOpenChange={(open) => !open && setReceiptId(null)} />
      {planMode && <PlanDialog admission={a} open onOpenChange={(open) => !open && setPlanMode(null)} restructure={planMode === 'restructure'} />}
      <RefundDialog admission={a} open={refundOpen} onOpenChange={setRefundOpen} receipts={f.payments} />
      <AdjustmentDialog admission={a} open={adjustOpen} onOpenChange={setAdjustOpen} />
      <ConfirmDialog
        open={!!reversing}
        onOpenChange={(open) => !open && setReversing(null)}
        title={`Reverse ${reversing?.receiptNumber ?? ''}?`}
        description="The receipt stays on record but stops counting in every total. Use this for data-entry mistakes; use a refund when money is paid back."
        tone="danger"
        confirmLabel="Reverse receipt"
        requireReason
        loading={reverse.isPending}
        onConfirm={(reason) => reversing && reverse.mutate({ id: reversing.id, reason }, { onSuccess: () => setReversing(null) })}
      />
      <ConfirmDialog
        open={!!voiding}
        onOpenChange={(open) => !open && setVoiding(null)}
        title="Void this adjustment?"
        description="The amount becomes owed again from its effective date."
        tone="danger"
        confirmLabel="Void adjustment"
        requireReason
        loading={voidAdjustment.isPending}
        onConfirm={(reason) => voiding && voidAdjustment.mutate({ id: voiding, reason })}
      />
    </div>
  );
}
