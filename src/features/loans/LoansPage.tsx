import {
  FINANCE_TYPES,
  LOAN_STATUSES,
  disbursementFormSchema,
  loanCreateFormSchema,
  todayInZone,
  toMinor,
  type AdmissionDto,
  type LoanDetail,
  type LoanDto,
} from '@ims/shared';
import { Banknote, CircleCheck, Clock, Landmark, Plus, Wallet } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { DataTable, type Column } from '@/components/data/DataTable';
import { Pagination } from '@/components/data/Pagination';
import { FilterSelect, ResetFilters, SearchInput, Toolbar } from '@/components/data/Toolbar';
import { Button } from '@/components/ui/Button';
import { DialogContent, DialogRoot, DrawerContent } from '@/components/ui/Dialog';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Checkbox } from '@/components/ui/Toggle';
import { useListParams } from '@/hooks/useListParams';
import { api } from '@/lib/api';
import { handleFormError, useZodForm } from '@/lib/forms';
import { date, dateTime, getFormatConfig, humanize, money, moneyCompact, number } from '@/utils/format';
import { AdmissionPicker } from '../payments/AdmissionPicker';
import { useLoan, useLoanMutation, useLoans, useLoanSummary } from '../payments/api';
import { useActionParam } from '../shared/hooks';
import { useAdmission } from '../students/api';

const ACTIONS: Record<string, { to: string; label: string; tone?: 'danger' }[]> = {
  draft: [{ to: 'applied', label: 'Mark applied' }, { to: 'approved', label: 'Approve' }, { to: 'cancelled', label: 'Cancel', tone: 'danger' }],
  applied: [{ to: 'under_review', label: 'Under review' }, { to: 'approved', label: 'Approve' }, { to: 'rejected', label: 'Reject', tone: 'danger' }, { to: 'cancelled', label: 'Cancel', tone: 'danger' }],
  under_review: [{ to: 'approved', label: 'Approve' }, { to: 'rejected', label: 'Reject', tone: 'danger' }, { to: 'cancelled', label: 'Cancel', tone: 'danger' }],
  approved: [{ to: 'cancelled', label: 'Cancel', tone: 'danger' }],
};

function NewLoanDialog({ open, onOpenChange, preset }: { open: boolean; onOpenChange: (open: boolean) => void; preset: AdmissionDto | null }) {
  const [admission, setAdmission] = useState<AdmissionDto | null>(preset);
  const form = useZodForm(loanCreateFormSchema, { defaultValues: { admissionId: preset?.id ?? '', financeType: 'external_loan', providerName: '', applicationReference: '', requestedMinor: '', notes: '' } });
  useEffect(() => {
    if (open) {
      setAdmission(preset);
      form.reset({ admissionId: preset?.id ?? '', financeType: 'external_loan', providerName: '', applicationReference: '', requestedMinor: '', notes: '' });
    }
  }, [open, preset, form]);
  useEffect(() => form.setValue('admissionId', admission?.id ?? ''), [admission, form]);

  const create = useLoanMutation((body: Record<string, unknown>) => api.post<LoanDetail>('/loans', body), 'Financing recorded');
  const errors = form.formState.errors;
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New financing"
        description="An external loan is money a lender pays the institute; an internal facility is the institute's own credit."
        size="lg"
        dismissible={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={create.isPending} onClick={form.handleSubmit((v) => create.mutate(v, { onSuccess: () => onOpenChange(false), onError: (e) => handleFormError(form, e) }))}>Create</Button>
          </>
        }
      >
        <form noValidate className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <Field label="Admission" required error={errors.admissionId ? 'Choose an admission' : undefined}>
            <AdmissionPicker value={admission} onChange={setAdmission} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" required><Select options={FINANCE_TYPES.map((t) => ({ value: t, label: t === 'external_loan' ? 'External loan' : 'Internal instalment facility' }))} {...form.register('financeType')} /></Field>
            <Field label="Provider" error={errors.providerName?.message} required><Input placeholder="Bank or finance company" {...form.register('providerName')} /></Field>
            <Field label="Amount requested" error={errors.requestedMinor?.message} required><MoneyInput {...form.register('requestedMinor')} /></Field>
            <Field label="Application reference" error={errors.applicationReference?.message}><Input {...form.register('applicationReference')} /></Field>
          </div>
          <Field label="Notes"><Textarea rows={2} {...form.register('notes')} /></Field>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

function StatusAction({ loan, to, label, tone, onDone }: { loan: LoanDetail; to: string; label: string; tone?: 'danger'; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(todayInZone(getFormatConfig().timeZone));
  const [approved, setApproved] = useState('');
  const [reason, setReason] = useState('');
  const change = useLoanMutation((body: Record<string, unknown>) => api.post<LoanDetail>(`/loans/${loan.id}/status`, body), `Loan ${label.toLowerCase()}`);

  const submit = () => {
    let approvedMinor: number | undefined;
    if (to === 'approved') {
      try {
        // Exact paise via the shared parser -- never float arithmetic on money.
        approvedMinor = toMinor(approved);
      } catch {
        toast.error('Enter the approved amount, e.g. 125000.50');
        return;
      }
    }
    change.mutate({ status: to, date: day, approvedMinor, rejectionReason: reason || undefined }, { onSuccess: () => { setOpen(false); onDone(); } });
  };

  return (
    <>
      <Button size="sm" variant={tone === 'danger' ? 'danger' : 'secondary'} onClick={() => setOpen(true)}>{label}</Button>
      <DialogRoot open={open} onOpenChange={setOpen}>
        <DialogContent
          title={`${label}: ${loan.providerName}`}
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>Back</Button>
              <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={change.isPending} disabled={(to === 'approved' && !approved) || (to === 'rejected' && reason.trim().length < 3)} onClick={submit}>{label}</Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="Date" required><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
            {to === 'approved' && (
              <Field label="Approved amount" required hint={`Requested ${money(loan.requestedMinor)}. Approval is not cash: nothing counts as received until money arrives.`}>
                <MoneyInput value={approved} onChange={(e) => setApproved(e.target.value)} />
              </Field>
            )}
            {to === 'rejected' && <Field label="Reason" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
          </div>
        </DialogContent>
      </DialogRoot>
    </>
  );
}

function DisbursementDialog({ loan, open, onOpenChange }: { loan: LoanDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const today = todayInZone(getFormatConfig().timeZone);
  const form = useZodForm(disbursementFormSchema, { defaultValues: { disbursedOn: today, amountMinor: '', reference: '', notes: '', receivedByInstitute: false } });
  useEffect(() => {
    if (open) form.reset({ disbursedOn: today, amountMinor: '', reference: '', notes: '', receivedByInstitute: false });
  }, [open, form, today]);
  const record = useLoanMutation((body: Record<string, unknown>) => api.post<LoanDetail>(`/loans/${loan.id}/disbursements`, body), 'Disbursement recorded');
  const errors = form.formState.errors;
  const received = form.watch('receivedByInstitute');
  const remaining = (loan.approvedMinor ?? 0) - loan.disbursedMinor;

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Record disbursement"
        description={`${money(remaining)} of the approved ${money(loan.approvedMinor ?? 0)} remains.`}
        dismissible={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={record.isPending} onClick={form.handleSubmit((v) => record.mutate(v, { onSuccess: () => onOpenChange(false), onError: (e) => handleFormError(form, e) }))}>Record</Button>
          </>
        }
      >
        <form noValidate className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount" error={errors.amountMinor?.message} required><MoneyInput {...form.register('amountMinor')} /></Field>
            <Field label="Disbursed on" error={errors.disbursedOn?.message} required><Input type="date" {...form.register('disbursedOn')} /></Field>
          </div>
          <Field label="Lender reference"><Input {...form.register('reference')} /></Field>
          <Checkbox
            id="received"
            checked={!!received}
            onCheckedChange={(v) => form.setValue('receivedByInstitute', v === true)}
            label="The money has reached the institute's account"
            description="Creates a receipt and counts as collected. Leave unticked if the lender has only reported it."
          />
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

function LoanDrawer({ loanId, onOpenChange }: { loanId: string | null; onOpenChange: (open: boolean) => void }) {
  const auth = useAuth();
  const loan = useLoan(loanId);
  const [disbursing, setDisbursing] = useState(false);
  const markReceived = useLoanMutation(
    ({ id, did }: { id: string; did: string }) => api.post<LoanDetail>(`/loans/${id}/disbursements/${did}/received`, { receivedOn: todayInZone(getFormatConfig().timeZone) }),
    'Marked as received',
  );
  const l = loan.data;

  return (
    <DialogRoot open={!!loanId} onOpenChange={onOpenChange}>
      <DrawerContent title={l ? `${l.providerName} · ${l.studentName}` : 'Financing'} description={l ? `${l.admissionNumber} · ${humanize(l.financeType)}` : undefined} width="lg">
        {loan.isPending ? <LoadingBlock /> : loan.isError ? <ErrorState error={loan.error} /> : l ? (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2"><StatusBadge status={l.status} />{l.disbursementStatus !== 'not_applicable' && <StatusBadge status={l.disbursementStatus} />}</div>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[['Requested', l.requestedMinor], ['Approved', l.approvedMinor], ['Disbursed (reported)', l.disbursedMinor], ['Received', l.receivedMinor]].map(([label, value]) => (
                <div key={label as string} className="rounded-xl border bg-surface-sunken p-3">
                  <dt className="text-xs text-fg-subtle">{label}</dt>
                  <dd className="mt-0.5 font-semibold text-fg">{value === null ? '—' : money(value as number)}</dd>
                </div>
              ))}
            </dl>
            <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
              <dt className="text-fg-subtle">Student</dt><dd><Link to={`/students/${l.studentId}?tab=loans`} className="text-primary hover:underline">{l.studentName}</Link></dd>
              <dt className="text-fg-subtle">Reference</dt><dd className="text-fg">{l.applicationReference ?? '—'}</dd>
              <dt className="text-fg-subtle">Applied</dt><dd className="text-fg">{date(l.appliedOn)}</dd>
              <dt className="text-fg-subtle">Decision</dt><dd className="text-fg">{date(l.decisionOn)}</dd>
              {l.rejectionReason && (<><dt className="text-fg-subtle">Rejected</dt><dd className="text-fg">{l.rejectionReason}</dd></>)}
            </dl>

            {auth.can('loans:write') && ACTIONS[l.status] && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-fg">Status</h3>
                <div className="flex flex-wrap gap-2">
                  {ACTIONS[l.status]!.filter((a) => (a.to === 'approved' || a.to === 'rejected' ? auth.can('loans:approve') : true)).map((a) => (
                    <StatusAction key={a.to} loan={l} to={a.to} label={a.label} tone={a.tone} onDone={() => void loan.refetch()} />
                  ))}
                </div>
              </section>
            )}

            {l.financeType === 'external_loan' && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-fg">Disbursements</h3>
                  {l.status === 'approved' && auth.can('loans:disburse') && (l.approvedMinor ?? 0) > l.disbursedMinor && (
                    <Button size="sm" variant="secondary" onClick={() => setDisbursing(true)}><Plus aria-hidden className="size-3.5" /> Record</Button>
                  )}
                </div>
                {l.disbursements.length === 0 ? <p className="text-sm text-fg-muted">None yet.</p> : (
                  <ul className="divide-y rounded-control border">
                    {l.disbursements.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                        <span className="flex-1">{date(d.disbursedOn)} · <span className="font-medium">{money(d.amountMinor)}</span>{d.reference ? ` · ${d.reference}` : ''}</span>
                        {d.received ? <StatusBadge status="succeeded" label={`Received · ${d.receiptNumber}`} /> : (
                          <>
                            <StatusBadge status="pending" label="Reported, not received" />
                            {auth.can('loans:disburse') && <Button size="sm" variant="ghost" loading={markReceived.isPending} onClick={() => markReceived.mutate({ id: l.id, did: d.id })}>Mark received</Button>}
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-fg">History</h3>
              <ol className="space-y-2 border-l pl-4">
                {l.history.map((h, i) => (
                  <li key={i} className="text-sm"><p className="text-fg">{h.summary}</p><p className="text-xs text-fg-subtle">{h.actorName ?? 'System'} · {dateTime(h.at)}</p></li>
                ))}
              </ol>
            </section>
            <DisbursementDialog loan={l} open={disbursing} onOpenChange={setDisbursing} />
          </div>
        ) : null}
      </DrawerContent>
    </DialogRoot>
  );
}

export function LoansPage() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const list = useListParams(['status', 'financeType'] as const, { sort: { key: 'createdAt', order: 'desc' } });
  const loans = useLoans(list.query);
  const summary = useLoanSummary();
  const [creating, setCreating] = useState(false);
  const presetAdmission = useAdmission(params.get('admission'));
  const openId = params.get('loan');
  const setOpenId = (id: string | null) =>
    setParams((c) => {
      const p = new URLSearchParams(c);
      if (id) p.set('loan', id);
      else p.delete('loan');
      return p;
    });

  const openNew = useCallback(() => setCreating(true), []);
  useActionParam('new', openNew);

  const columns: Column<LoanDto>[] = [
    { id: 'student', header: 'Student', hideable: false, cell: (l) => <div><p className="font-medium text-fg">{l.studentName}</p><p className="text-xs text-fg-subtle"><span className="font-mono">{l.admissionNumber}</span> · {l.courseName}</p></div> },
    { id: 'provider', header: 'Provider', cell: (l) => <div><p className="text-fg">{l.providerName}</p><p className="text-xs text-fg-subtle">{l.financeType === 'external_loan' ? 'External loan' : 'Internal facility'}</p></div> },
    { id: 'requested', header: 'Requested', align: 'right', cell: (l) => <span className="tabular-nums">{money(l.requestedMinor)}</span> },
    { id: 'approved', header: 'Approved', align: 'right', cell: (l) => <span className="tabular-nums text-fg-muted">{l.approvedMinor === null ? '—' : money(l.approvedMinor)}</span> },
    { id: 'received', header: 'Received', align: 'right', cell: (l) => <span className="font-medium tabular-nums">{money(l.receivedMinor)}</span> },
    { id: 'status', header: 'Status', cell: (l) => <StatusBadge status={l.status} /> },
    { id: 'disbursement', header: 'Disbursement', cell: (l) => (l.disbursementStatus === 'not_applicable' ? <span className="text-fg-subtle">—</span> : <StatusBadge status={l.disbursementStatus} />) },
  ];

  const s = summary.data;
  return (
    <>
      <PageHeader
        title="Loans & financing"
        description="Applications, lender decisions and disbursements. Approved money counts as collected only once it reaches the institute."
        breadcrumbs={[{ label: 'Finance' }, { label: 'Loans & financing' }]}
        actions={auth.can('loans:write') && <Button onClick={openNew}><Plus aria-hidden className="size-4" /> New financing</Button>}
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Pending applications" value={s ? number(s.pendingApplications) : '—'} icon={Clock} loading={summary.isPending} to="/loans?status=applied%2Cunder_review" />
        <StatCard label="Requested" value={s ? moneyCompact(s.requestedMinor) : '—'} icon={Landmark} loading={summary.isPending} hint="Open and approved applications. Never cash." />
        <StatCard label="Approved" value={s ? moneyCompact(s.approvedMinor) : '—'} icon={CircleCheck} loading={summary.isPending} hint="Lender decisions. Never cash." />
        <StatCard label="Disbursed (reported)" value={s ? moneyCompact(s.disbursedMinor) : '—'} icon={Banknote} loading={summary.isPending} hint="What lenders report releasing." />
        <StatCard label="Received" value={s ? moneyCompact(s.receivedMinor) : '—'} icon={Wallet} loading={summary.isPending} hint="Disbursements that reached the institute: the only figure that is cash." />
      </div>
      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Student, provider or reference" />
        <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={LOAN_STATUSES.map((s2) => ({ value: s2, label: humanize(s2) }))} />
        <FilterSelect label="Type" value={list.filters.financeType} onChange={(v) => list.setFilter('financeType', v)} options={[{ value: 'external_loan', label: 'External loan' }, { value: 'internal_instalment', label: 'Internal facility' }]} />
        <ResetFilters onReset={list.reset} disabled={!list.isFiltered} />
      </Toolbar>
      <DataTable
        caption="Loans"
        columns={columns}
        rows={loans.data?.items}
        rowKey={(l) => l.id}
        loading={loans.isPending}
        fetching={loans.isFetching}
        error={loans.error}
        onRetry={() => void loans.refetch()}
        onRowClick={(l) => setOpenId(l.id)}
        empty={<EmptyState icon={Landmark} title={list.isFiltered ? 'No financing matches these filters' : 'No financing recorded'} />}
      />
      {loans.data && <Pagination page={loans.data.page} totalPages={loans.data.totalPages} total={loans.data.total} limit={loans.data.limit} onPageChange={list.setPage} onLimitChange={list.setLimit} />}
      {s && s.byProvider.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-fg">By provider</h2>
          <div className="overflow-x-auto rounded-card border bg-surface">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-fg-subtle uppercase"><th className="px-3 py-2 font-medium">Provider</th><th className="px-3 py-2 text-right font-medium">Applications</th><th className="px-3 py-2 text-right font-medium">Approved</th><th className="px-3 py-2 text-right font-medium">Received</th></tr></thead>
              <tbody>
                {s.byProvider.map((p) => (
                  <tr key={p.providerName} className="border-b last:border-b-0"><td className="px-3 py-2">{p.providerName}</td><td className="px-3 py-2 text-right tabular-nums">{number(p.count)}</td><td className="px-3 py-2 text-right tabular-nums">{money(p.approvedMinor)}</td><td className="px-3 py-2 text-right tabular-nums">{money(p.receivedMinor)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <NewLoanDialog open={creating} onOpenChange={setCreating} preset={presetAdmission.data ?? null} />
      <LoanDrawer loanId={openId} onOpenChange={(open) => !open && setOpenId(null)} />
    </>
  );
}
