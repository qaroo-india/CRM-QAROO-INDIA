/**
 * The student portal. Every endpoint behind these pages answers for the
 * signed-in student only (the server takes the student from the session).
 */

import { addDays, todayInZone, type CertificateDto, type PortalAdmission, type PortalInstalment, type PortalPayment } from '@ims/shared';
import { Award, BookOpenCheck, BriefcaseBusiness, CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, Download, ExternalLink, FolderOpen, Plus, Receipt } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { DataTable, type Column } from '@/components/data/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DialogContent, DialogRoot } from '@/components/ui/Dialog';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { Select, Textarea } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { api, fetchFile, saveBlob } from '@/lib/api';
import { cn } from '@/lib/cn';
import { toastError } from '@/lib/forms';
import { date, dateTime, getFormatConfig, humanize, money, number, percent } from '@/utils/format';
import { useAction, usePortalAttendance, usePortalCertificates, usePortalClasses, usePortalFees, usePortalMaterials, usePortalOverview, usePortalPlacement } from '../campus/api';
import { ClassList } from '../campus/ClassList';
import { dayLabel } from '../campus/time';
import { downloadCertificate } from '../certificates/CertificatesPage';
import { openMaterial } from '../materials/MaterialsPage';

const today = () => todayInZone(getFormatConfig().timeZone);

function FeeBar({ paid, total }: { paid: number; total: number }) {
  const ratio = total > 0 ? Math.min(1, paid / total) : 0;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-sunken" role="img" aria-label={`${percent(ratio, 0)} of the fee paid`}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

function AdmissionCard({ a }: { a: PortalAdmission }) {
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{a.courseName}</CardTitle>
          <CardDescription>{a.admissionNumber} · joined {date(a.admissionDate)}</CardDescription>
        </div>
        <StatusBadge status={a.status} />
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {a.batch ? (
          <p className="text-fg-muted">
            Batch <span className="font-medium text-fg">{a.batch.batchCode}</span>
            {a.batch.trainerName && <> · trainer {a.batch.trainerName}</>}
            {a.batch.schedule && <> · {a.batch.schedule}</>}
          </p>
        ) : (
          <p className="text-fg-muted">Not placed in a batch yet. The office will let you know.</p>
        )}
        <div className="space-y-1.5">
          <div className="flex justify-between text-fg-muted"><span>Fees paid</span><span className="tabular-nums text-fg">{money(a.paidMinor)} of {money(a.agreedFeeMinor)}</span></div>
          <FeeBar paid={a.paidMinor} total={a.agreedFeeMinor} />
          {a.overdueMinor > 0 ? (
            <p className="text-danger">{money(a.overdueMinor)} is overdue.</p>
          ) : a.nextInstalment ? (
            <p className="text-fg-subtle">Next: {money(a.nextInstalment.amountMinor)} due {date(a.nextInstalment.dueDate)}</p>
          ) : a.outstandingMinor > 0 ? (
            <p className="text-fg-subtle">{money(a.outstandingMinor)} still to pay.</p>
          ) : (
            <p className="text-success">Fully paid.</p>
          )}
        </div>
        <div className="flex justify-between text-fg-muted">
          <span>Attendance</span>
          <span className={cn('font-medium tabular-nums', a.attendancePercent !== null && a.attendancePercent < 0.75 ? 'text-warning' : 'text-fg')}>{a.attendancePercent === null ? 'Not started' : percent(a.attendancePercent, 0)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function PortalOverviewPage() {
  const { user } = useAuth();
  const overview = usePortalOverview();
  if (overview.isPending) return <LoadingBlock />;
  if (overview.error) return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  const o = overview.data;
  return (
    <>
      <PageHeader title={`Hello, ${(user?.name ?? o.student.fullName).split(' ')[0]}`} description={`Student ID ${o.student.studentCode}`} />
      <div className="stagger mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Exams open to you" value={number(o.openExams)} icon={BookOpenCheck} to="/portal/exams" />
        <StatCard label="New study material" value={number(o.newMaterials)} icon={FolderOpen} to="/portal/materials" hint="Shared in the last 14 days" />
        <StatCard label="Certificates issued" value={number(o.certificates.issued)} icon={Award} to="/portal/certificates" hint={o.certificates.requested ? `${o.certificates.requested} request(s) in progress` : undefined} />
      </div>
      <div className="stagger grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          {o.admissions.length === 0 ? <Card><EmptyState compact title="No admissions on record" /></Card> : o.admissions.map((a) => <AdmissionCard key={a.id} a={a} />)}
        </div>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Upcoming classes</CardTitle>
            <Link to="/portal/classes" className="text-xs text-primary hover:underline">Timetable</Link>
          </CardHeader>
          <CardContent>
            <ClassList sessions={o.upcomingClasses} today={today()} empty={<EmptyState compact icon={CalendarDays} title="Nothing scheduled yet" description="Classes appear here once your trainer schedules them." />} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export function PortalClassesPage() {
  const [from, setFrom] = useState(() => addDays(today(), -1));
  const to = addDays(from, 13);
  const classes = usePortalClasses(from, to);
  return (
    <>
      <PageHeader title="Classes" description="Your timetable. Times are the institute's local time." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="icon" aria-label="Earlier" onClick={() => setFrom(addDays(from, -14))}><ChevronLeft aria-hidden className="size-4" /></Button>
        <Button variant="secondary" size="icon" aria-label="Later" onClick={() => setFrom(addDays(from, 14))}><ChevronRight aria-hidden className="size-4" /></Button>
        <Button variant="ghost" size="sm" onClick={() => setFrom(addDays(today(), -1))}>Today</Button>
        <span className="text-sm text-fg-muted">{dayLabel(from)} – {dayLabel(to)}</span>
      </div>
      <Card>
        <CardContent>
          {classes.isPending ? <LoadingBlock /> : classes.error ? <ErrorState error={classes.error} onRetry={() => void classes.refetch()} /> : <ClassList sessions={classes.data} today={today()} />}
        </CardContent>
      </Card>
    </>
  );
}

export function PortalAttendancePage() {
  const attendance = usePortalAttendance();
  if (attendance.isPending) return <LoadingBlock />;
  if (attendance.error) return <ErrorState error={attendance.error} onRetry={() => void attendance.refetch()} />;
  return (
    <>
      <PageHeader title="Attendance" description="Counted as present, late or on duty, out of the classes held (holidays excluded)." />
      {attendance.data.length === 0 ? (
        <Card><EmptyState icon={CalendarCheck} title="No attendance yet" description="It appears once you are in a batch and the register is taken." /></Card>
      ) : (
        <div className="space-y-4">
          {attendance.data.map((a) => {
            const s = a.summary;
            const days = [...a.days].sort((x, y) => y.date.localeCompare(x.date));
            return (
              <Card key={a.admissionId}>
                <CardHeader>
                  <div>
                    <CardTitle>{a.courseName}</CardTitle>
                    <CardDescription>{a.admissionNumber}{a.batchCode ? ` · batch ${a.batchCode}` : ''}</CardDescription>
                  </div>
                  <span className={cn('text-2xl font-semibold tabular-nums', s.percent !== null && s.percent < 0.75 ? 'text-warning' : 'text-fg')}>{s.percent === null ? '—' : percent(s.percent, 0)}</span>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge tone="success">{s.present} present</Badge>
                    <Badge tone="warning">{s.late} late</Badge>
                    <Badge tone="primary">{s.onDuty} on duty</Badge>
                    <Badge tone="danger">{s.absent} absent</Badge>
                    <Badge>{s.holiday} holiday</Badge>
                    <span className="text-fg-subtle">{s.sessions} registers</span>
                  </div>
                  {days.length > 0 && (
                    <ul className="divide-y text-sm">
                      {days.map((d) => (
                        <li key={d.date} className="flex flex-wrap items-center justify-between gap-2 py-2">
                          <span className="w-28 tabular-nums text-fg-muted">{dayLabel(d.date)}</span>
                          <span className="min-w-0 flex-1 truncate text-fg-subtle">{[d.topic, d.remark].filter(Boolean).join(' · ')}</span>
                          <span className="flex items-center gap-2">
                            {d.minutesLate > 0 && <span className="text-xs text-fg-subtle">{d.minutesLate} min late</span>}
                            <StatusBadge status={d.status} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

async function downloadReceipt(p: PortalPayment) {
  try {
    saveBlob(await fetchFile(`/portal/receipts/${p.id}`, { fallbackName: `${p.receiptNumber}.pdf` }));
  } catch (error) {
    toastError(error);
  }
}

export function PortalFeesPage() {
  const fees = usePortalFees();
  const instalmentColumns: Column<PortalInstalment>[] = [
    { id: 'course', header: 'Course', hideable: false, cell: (i) => <div><p className="text-fg">{i.courseName}</p><p className="text-xs text-fg-subtle">{i.admissionNumber} · {i.kind === 'instalment' ? `Instalment ${i.sequence}` : humanize(i.kind)}</p></div> },
    { id: 'due', header: 'Due', cell: (i) => <span className="tabular-nums">{date(i.dueDate)}</span> },
    { id: 'amount', header: 'Amount', align: 'right', cell: (i) => money(i.amountMinor) },
    { id: 'paid', header: 'Paid', align: 'right', cell: (i) => money(i.paidMinor) },
    { id: 'state', header: 'Status', cell: (i) => <StatusBadge status={i.state} /> },
  ];
  const paymentColumns: Column<PortalPayment>[] = [
    { id: 'receipt', header: 'Receipt', hideable: false, cell: (p) => <span className="font-mono text-sm">{p.receiptNumber}</span> },
    { id: 'date', header: 'Date', cell: (p) => date(p.paymentDate) },
    { id: 'course', header: 'Course', cell: (p) => <span className="text-fg-muted">{p.courseName}</span> },
    { id: 'method', header: 'Method', cell: (p) => humanize(p.method) },
    { id: 'amount', header: 'Amount', align: 'right', cell: (p) => <span className={cn('tabular-nums', p.direction === 'refund' && 'text-danger')}>{p.direction === 'refund' ? `−${money(p.amountMinor)}` : money(p.amountMinor)}</span> },
    { id: 'pdf', header: <span className="sr-only">Download</span>, hideable: false, align: 'right', cell: (p) => <Button variant="ghost" size="icon" aria-label={`Download receipt ${p.receiptNumber}`} onClick={() => void downloadReceipt(p)}><Download aria-hidden className="size-4" /></Button> },
  ];
  const totals = (fees.data?.admissions ?? []).reduce((t, a) => ({ agreed: t.agreed + a.agreedFeeMinor, paid: t.paid + a.paidMinor, outstanding: t.outstanding + a.outstandingMinor, overdue: t.overdue + a.overdueMinor }), { agreed: 0, paid: 0, outstanding: 0, overdue: 0 });
  return (
    <>
      <PageHeader title="Fees & receipts" description="What you have paid, what is due, and a receipt for every payment. Pay at the office; payments appear here once recorded." />
      <div className="stagger mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total fee" value={money(totals.agreed)} loading={fees.isPending} />
        <StatCard label="Paid" value={money(totals.paid)} loading={fees.isPending} />
        <StatCard label="Still to pay" value={money(totals.outstanding)} loading={fees.isPending} />
        <StatCard label="Overdue" value={<span className={totals.overdue ? 'text-danger' : undefined}>{money(totals.overdue)}</span>} loading={fees.isPending} />
      </div>
      <h2 className="mb-3 text-sm font-semibold text-fg">Instalments</h2>
      <DataTable caption="Instalments" columns={instalmentColumns} rows={fees.data?.instalments} rowKey={(i) => `${i.admissionId}-${i.sequence}`} loading={fees.isPending} error={fees.error} empty={<EmptyState compact title="No instalment plan" description="Your fee is not split into instalments." />} />
      <h2 className="mt-8 mb-3 text-sm font-semibold text-fg">Payments</h2>
      <DataTable caption="Payments" columns={paymentColumns} rows={fees.data?.payments} rowKey={(p) => p.id} loading={fees.isPending} error={fees.error} empty={<EmptyState compact icon={Receipt} title="No payments yet" />} />
    </>
  );
}

export function PortalMaterialsPage() {
  const materials = usePortalMaterials();
  const groups = useMemo(() => {
    const map = new Map<string, NonNullable<typeof materials.data>>();
    for (const m of materials.data ?? []) map.set(m.courseName, [...(map.get(m.courseName) ?? []), m]);
    return [...map.entries()];
  }, [materials.data]);
  if (materials.isPending) return <LoadingBlock />;
  if (materials.error) return <ErrorState error={materials.error} onRetry={() => void materials.refetch()} />;
  return (
    <>
      <PageHeader title="Study material" description="Notes, slides, recordings and links shared for your course and batch." />
      {groups.length === 0 ? (
        <Card><EmptyState icon={FolderOpen} title="Nothing shared yet" /></Card>
      ) : (
        <div className="space-y-4">
          {groups.map(([course, list]) => (
            <Card key={course}>
              <CardHeader><CardTitle>{course}</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {list.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="font-medium text-fg">{m.title}</p>
                        <p className="text-xs text-fg-subtle">{humanize(m.kind)}{m.batchCode ? ` · ${m.batchCode}` : ''} · {date(m.createdAt.slice(0, 10))}{m.uploadedByName ? ` · ${m.uploadedByName}` : ''}</p>
                        {m.description && <p className="mt-1 text-sm text-fg-muted">{m.description}</p>}
                      </div>
                      <Button size="sm" variant="secondary" onClick={() => void openMaterial(m, '/portal/materials')}>
                        {m.hasFile ? <><Download aria-hidden className="size-4" /> Download</> : <><ExternalLink aria-hidden className="size-4" /> Open link</>}
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function RequestCertificateDialog({ open, onOpenChange, admissions }: { open: boolean; onOpenChange: (o: boolean) => void; admissions: PortalAdmission[] }) {
  const [admissionId, setAdmissionId] = useState('');
  const [note, setNote] = useState('');
  const chosen = admissionId || admissions[0]?.id || '';
  const request = useAction(() => api.post('/portal/certificates', { admissionId: chosen, requestNote: note || undefined }), {
    invalidate: [['portal']],
    success: 'Request sent. The office will review it.',
    onDone: () => {
      onOpenChange(false);
      setNote('');
      setAdmissionId('');
    },
  });
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Request a certificate"
        description="For a course you have completed."
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button disabled={!chosen} loading={request.isPending} onClick={() => request.mutate(undefined)}>Send request</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Course">
            <Select value={chosen} onChange={(e) => setAdmissionId(e.target.value)} options={admissions.map((a) => ({ value: a.id, label: `${a.courseName} (${a.admissionNumber})` }))} />
          </Field>
          <Field label="Note (optional)" hint="E.g. the name exactly as it should be printed">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

export function PortalCertificatesPage() {
  const certificates = usePortalCertificates();
  const overview = usePortalOverview();
  const [open, setOpen] = useState(false);
  const live = new Set((certificates.data ?? []).filter((c) => c.status !== 'rejected').map((c) => c.admissionId));
  const eligible = (overview.data?.admissions ?? []).filter((a) => a.status === 'completed' && !live.has(a.id));
  const columns: Column<CertificateDto>[] = [
    { id: 'course', header: 'Course', hideable: false, cell: (c) => <div><p className="text-fg">{c.courseName}</p><p className="text-xs text-fg-subtle">{c.admissionNumber}</p></div> },
    { id: 'status', header: 'Status', cell: (c) => <div><StatusBadge status={c.status} />{c.reviewNote && <p className="text-xs text-fg-subtle">{c.reviewNote}</p>}</div> },
    { id: 'ref', header: 'Reference', cell: (c) => (c.referenceNumber ? <span className="font-mono text-sm">{c.referenceNumber}</span> : '—') },
    { id: 'requested', header: 'Requested', cell: (c) => <span className="text-fg-muted">{dateTime(c.requestedAt)}</span> },
    { id: 'issued', header: 'Issued', cell: (c) => (c.issuedOn ? date(c.issuedOn) : '—') },
    { id: 'pdf', header: <span className="sr-only">Download</span>, hideable: false, align: 'right', cell: (c) => (c.status === 'issued' ? <Button variant="secondary" size="sm" onClick={() => void downloadCertificate(c, '/portal/certificates')}><Download aria-hidden className="size-4" /> PDF</Button> : null) },
  ];
  return (
    <>
      <PageHeader
        title="Certificates"
        description={<>Request a completion certificate once your course is marked completed. Anyone can check an issued certificate at <span className="font-mono">/verify</span> using its reference.</>}
        actions={eligible.length > 0 && <Button onClick={() => setOpen(true)}><Plus aria-hidden className="size-4" /> Request certificate</Button>}
      />
      <DataTable caption="Certificates" columns={columns} rows={certificates.data} rowKey={(c) => c.id} loading={certificates.isPending} error={certificates.error} empty={<EmptyState icon={Award} title="No certificates yet" description={eligible.length ? 'You can request one now.' : 'You can request one when a course is marked completed.'} />} />
      <RequestCertificateDialog open={open} onOpenChange={setOpen} admissions={eligible} />
    </>
  );
}

export function PortalPlacementsPage() {
  const placement = usePortalPlacement();
  const [applying, setApplying] = useState<{ id: string; label: string } | null>(null);
  const apply = useAction((id: string) => api.post(`/portal/drives/${id}/apply`), { invalidate: [['portal', 'placement']], success: 'Applied. The placement team will be in touch.', onDone: () => setApplying(null) });
  if (placement.isPending) return <LoadingBlock />;
  if (placement.error) return <ErrorState error={placement.error} onRetry={() => void placement.refetch()} />;
  const { profile, drives, applications } = placement.data;
  return (
    <>
      <PageHeader title="Placement" description="Your placement status, hiring drives you can apply to, and your applications." />
      <Card className="mb-4">
        <CardContent>
          {profile ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="text-fg-muted">Track <span className="font-medium text-fg">{humanize(profile.track)}</span></span>
              <span className="flex items-center gap-1.5 text-fg-muted">Stage <StatusBadge status={profile.stage} /></span>
              <span className="text-fg-muted">Resume <span className="font-medium text-fg">{humanize(profile.resumeStatus)}</span></span>
              {profile.eligibleOn && <span className="text-fg-muted">Eligible from <span className="font-medium text-fg">{date(profile.eligibleOn)}</span></span>}
              {profile.placed && <Badge tone="success">Placed</Badge>}
            </div>
          ) : (
            <p className="text-sm text-fg-muted">You are not in the placement programme yet. Ask the placement team if your course includes placement support.</p>
          )}
        </CardContent>
      </Card>

      <h2 className="mb-3 text-sm font-semibold text-fg">Open drives</h2>
      {drives.length === 0 ? (
        <Card><EmptyState compact icon={BriefcaseBusiness} title="No open drives for you right now" description="You get a notification when a company opens a drive for your batch." /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {drives.map((d) => (
            <Card key={d.id}>
              <CardContent className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-fg">{d.roleTitle}</p>
                    <p className="text-sm text-fg-muted">{d.companyName}</p>
                  </div>
                  {d.applied && <Badge tone="success">Applied</Badge>}
                </div>
                <p className="text-sm text-fg-subtle">
                  Drive {date(d.driveDate)}{d.applyBy ? ` · apply by ${date(d.applyBy)}` : ''}{d.location ? ` · ${d.location}` : ''}{d.isRemote ? ' · remote' : ''}
                  {d.packageMinor ? ` · ${money(d.packageMinor, { compactDecimals: true })} a year` : ''} · {d.openings} opening{d.openings === 1 ? '' : 's'}
                </p>
                {d.description && <p className="text-sm whitespace-pre-line text-fg-muted">{d.description}</p>}
                {d.eligibilityNote && <p className="text-xs text-fg-subtle">Eligibility: {d.eligibilityNote}</p>}
                {!d.applied && (d.canApply ? <Button size="sm" onClick={() => setApplying({ id: d.id, label: `${d.roleTitle} at ${d.companyName}` })}>Apply</Button> : d.blockedReason && <p className="text-sm text-fg-muted">{d.blockedReason}</p>)}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <h2 className="mt-8 mb-3 text-sm font-semibold text-fg">My applications</h2>
      <Card>
        {applications.length === 0 ? (
          <EmptyState compact title="No applications yet" />
        ) : (
          <ul className="divide-y">
            {applications.map((a) => (
              <li key={a.id} className="space-y-1 px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-fg">{a.jobTitle} <span className="font-normal text-fg-muted">· {a.companyName}</span></p>
                  <StatusBadge status={a.outcome} />
                </div>
                <p className="text-xs text-fg-subtle">Applied {date(a.appliedOn)}{a.driveId ? ' · through a placement drive' : ''}</p>
                {a.interviews.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-fg-muted">
                    {a.interviews.map((i, n) => <li key={n}>{i.roundName}: {dateTime(i.scheduledAt)} · {humanize(i.result)}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog open={Boolean(applying)} onOpenChange={(o) => !o && setApplying(null)} title="Apply for this drive?" description={applying ? `${applying.label}. The placement team sees your profile and resume.` : undefined} confirmLabel="Apply" loading={apply.isPending} onConfirm={() => applying && apply.mutate(applying.id)} />
    </>
  );
}
