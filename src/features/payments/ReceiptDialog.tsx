import { Download, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { DialogContent, DialogRoot } from '@/components/ui/Dialog';
import { ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { fetchFile, saveBlob } from '@/lib/api';
import { date, humanize, money } from '@/utils/format';
import { useReceipt } from './api';

/** On-screen receipt preview, matching the PDF, with download and print. */
export function ReceiptDialog({ paymentId, onOpenChange }: { paymentId: string | null; onOpenChange: (open: boolean) => void }) {
  const receipt = useReceipt(paymentId);
  const r = receipt.data;

  const download = async (print: boolean) => {
    if (!paymentId) return;
    try {
      const file = await fetchFile(`/payments/${paymentId}/receipt.pdf`, { fallbackName: 'receipt.pdf' });
      if (print) {
        const url = URL.createObjectURL(file.blob);
        const win = window.open(url, '_blank', 'noopener');
        if (!win) saveBlob(file);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        saveBlob(file);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not download the receipt');
    }
  };

  return (
    <DialogRoot open={!!paymentId} onOpenChange={onOpenChange}>
      <DialogContent
        title={r ? `${r.payment.direction === 'refund' ? 'Refund voucher' : 'Receipt'} ${r.payment.receiptNumber}` : 'Receipt'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => void download(true)} disabled={!r}><Printer aria-hidden className="size-4" /> Print</Button>
            <Button onClick={() => void download(false)} disabled={!r}><Download aria-hidden className="size-4" /> Download PDF</Button>
          </>
        }
      >
        {receipt.isPending ? (
          <LoadingBlock />
        ) : receipt.isError ? (
          <ErrorState error={receipt.error} onRetry={() => void receipt.refetch()} />
        ) : r ? (
          <article className="space-y-5 rounded-control border bg-white p-6 text-slate-900" aria-label="Receipt preview">
            <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-[#2a78d6] pb-4">
              <div className="flex items-start gap-4">
                <img src={r.institute.logoUrl || '/logo.png'} alt="Qaroo" className="h-10 w-auto object-contain" />
                <div>
                  <p className="text-lg font-semibold">{r.institute.legalName || r.institute.name}</p>
                  {r.institute.address && <p className="text-xs text-slate-600">{r.institute.address}</p>}
                  <p className="text-xs text-slate-600">{[r.institute.phone, r.institute.email].filter(Boolean).join(' · ')}</p>
                  {r.institute.taxId && <p className="text-xs text-slate-600">GSTIN {r.institute.taxId}</p>}
                </div>
              </div>
              <div className="text-right">
                <p className="font-semibold text-[#2a78d6]">{r.payment.direction === 'refund' ? 'REFUND VOUCHER' : 'PAYMENT RECEIPT'}</p>
                <p className="text-xs text-slate-600">No. {r.payment.receiptNumber}</p>
                <p className="text-xs text-slate-600">Date {date(r.payment.paymentDate)}</p>
              </div>
            </header>
            {r.payment.status === 'reversed' && (
              <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                Reversed: {r.payment.reversalReason}
              </p>
            )}
            <div>
              <p className="text-xs text-slate-500">{r.payment.direction === 'refund' ? 'Refunded to' : 'Received with thanks from'}</p>
              <p className="text-base font-semibold">{r.payment.studentName}</p>
              <p className="text-xs text-slate-600">Student {r.payment.studentCode} · Admission {r.payment.admissionNumber} · {r.payment.courseName}</p>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-slate-50 p-4">
              <p className="text-2xl font-semibold">{money(r.payment.amountMinor)}</p>
              <p className="max-w-sm text-right text-xs text-slate-600">{r.amountInWords}</p>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-slate-500">Method</dt><dd>{humanize(r.payment.method)}</dd></div>
              <div><dt className="text-xs text-slate-500">Reference</dt><dd>{r.payment.referenceNumber ?? '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">Type</dt><dd>{humanize(r.payment.paymentType)}</dd></div>
              <div><dt className="text-xs text-slate-500">Status</dt><dd><StatusBadge status={r.payment.status} /></dd></div>
            </dl>
            {r.payment.allocations.some((a) => a.instalmentSequence) && (
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-slate-500 uppercase"><th className="py-1.5">Applied to</th><th className="py-1.5">Due</th><th className="py-1.5 text-right">Amount</th></tr></thead>
                <tbody>
                  {r.payment.allocations.map((a) => (
                    <tr key={a.id} className="border-b last:border-b-0">
                      <td className="py-1.5">{a.instalmentSequence ? `Instalment ${a.instalmentSequence}` : 'Course fee'}</td>
                      <td className="py-1.5 tabular-nums">{a.instalmentDueDate ? date(a.instalmentDueDate) : '—'}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(a.amountMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <dl className="grid grid-cols-3 gap-3 border-t pt-3 text-sm">
              <div><dt className="text-xs text-slate-500">Agreed fee</dt><dd className="tabular-nums">{money(r.agreedFeeMinor)}</dd></div>
              <div><dt className="text-xs text-slate-500">Received to date</dt><dd className="tabular-nums">{money(r.totalReceivedMinor)}</dd></div>
              <div><dt className="text-xs text-slate-500">Balance due</dt><dd className="font-semibold tabular-nums">{money(r.balanceAfterMinor)}</dd></div>
            </dl>
          </article>
        ) : null}
      </DialogContent>
    </DialogRoot>
  );
}
