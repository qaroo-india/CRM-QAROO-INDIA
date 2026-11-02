/**
 * Student profile: one person, every admission, payment, plan, loan, batch,
 * document and placement record, plus a unified activity timeline.
 */

import type { AdmissionDto, StudentProfile } from '@ims/shared';
import { ArrowLeft, ClipboardList, Mail, MapPin, Pencil, Phone, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Menu';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { cn } from '@/lib/cn';
import { date, dateTime, humanize, initials, money } from '@/utils/format';
import { AdmissionDrawer } from '../admissions/AdmissionDrawer';
import { AdmissionFinancePanel } from '../admissions/AdmissionFinancePanel';
import { StudentBatchesTab } from '../batches/StudentBatchesTab';
import { StudentDocumentsTab } from '../documents/StudentDocumentsTab';
import { StudentLoansTab } from '../loans/StudentLoansTab';
import { StudentPlacementTab } from '../placements/StudentPlacementTab';
import { PortalAccessCard } from '../staff/PortalAccessCard';
import { studentKeys, useStudentProfile } from './api';
import { StudentFormDrawer } from './StudentFormDrawer';

const TABS = ['overview', 'admissions', 'payments', 'instalments', 'loans', 'batches', 'documents', 'placement', 'activity'] as const;
type Tab = (typeof TABS)[number];

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm text-fg">{children}</dd>
    </div>
  );
}

function AdmissionCards({ admissions, onOpen }: { admissions: AdmissionDto[]; onOpen: (id: string) => void }) {
  if (admissions.length === 0) return <EmptyState icon={ClipboardList} compact title="No admissions yet" />;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {admissions.map((a) => (
        <button key={a.id} type="button" onClick={() => onOpen(a.id)} className="rounded-card border bg-surface p-4 text-left shadow-card transition-colors hover:border-primary/40">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium text-fg">{a.courseName}</p>
              <p className="text-xs text-fg-subtle"><span className="font-mono">{a.admissionNumber}</span> · admitted {date(a.admissionDate)}</p>
            </div>
            <StatusBadge status={a.status} />
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <div><dt className="text-xs text-fg-subtle">Agreed</dt><dd className="tabular-nums">{money(a.agreedFeeMinor)}</dd></div>
            <div><dt className="text-xs text-fg-subtle">Received</dt><dd className="tabular-nums">{money(a.netPaidMinor)}</dd></div>
            <div><dt className="text-xs text-fg-subtle">Outstanding</dt><dd className={cn('font-semibold tabular-nums', a.overdueMinor > 0 ? 'text-danger' : 'text-fg')}>{money(a.outstandingMinor)}</dd></div>
          </dl>
        </button>
      ))}
    </div>
  );
}

function Timeline({ profile }: { profile: StudentProfile }) {
  if (profile.timeline.length === 0) return <EmptyState compact title="No activity yet" />;
  return (
    <ol className="relative space-y-4 border-l pl-5">
      {profile.timeline.map((event) => (
        <li key={event.id} className="relative">
          <span aria-hidden className="absolute top-1.5 -left-[1.6rem] size-2.5 rounded-full border-2 border-surface bg-primary" />
          {event.href ? <Link to={event.href} className="text-sm text-fg hover:text-primary">{event.title}</Link> : <p className="text-sm text-fg">{event.title}</p>}
          {event.detail && <p className="mt-0.5 text-sm whitespace-pre-wrap text-fg-muted">{event.detail}</p>}
          <p className="mt-0.5 text-xs text-fg-subtle">{event.actorName ?? 'System'} · {dateTime(event.at)}</p>
        </li>
      ))}
    </ol>
  );
}

export function StudentProfilePage() {
  const { id } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const profile = useStudentProfile(id);
  const [editing, setEditing] = useState(false);
  const [openAdmission, setOpenAdmission] = useState<string | null>(null);
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'overview') as Tab;

  if (profile.isPending) return <LoadingBlock />;
  if (profile.isError) return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  const { student, admissions } = profile.data;
  const live = admissions.filter((a) => ['pending_payment', 'active'].includes(a.status));
  const primary = live[0] ?? admissions[0];

  return (
    <>
      <PageHeader
        title={student.fullName}
        breadcrumbs={[{ label: 'Students', to: '/students' }, { label: student.studentCode }]}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate(-1)}><ArrowLeft aria-hidden className="size-4" /> Back</Button>
            {auth.can('students:write') && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil aria-hidden className="size-4" /> Edit</Button>}
            {auth.can('admissions:write') && <Button onClick={() => navigate('/admissions/new')}><Plus aria-hidden className="size-4" /> New admission</Button>}
          </>
        }
      />

      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-center gap-5">
          <span className="grid size-14 place-items-center rounded-2xl border border-primary/30 bg-primary-soft text-lg font-semibold text-primary">{initials(student.fullName)}</span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="flex items-center gap-2 font-mono text-xs text-fg-subtle">
              {student.studentCode}
              {student.status !== 'active' && <StatusBadge status={student.status} />}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted">
              <a href={`tel:${student.phone}`} className="inline-flex items-center gap-1.5 hover:text-fg"><Phone aria-hidden className="size-3.5" />{student.phone}</a>
              {student.email && <a href={`mailto:${student.email}`} className="inline-flex items-center gap-1.5 hover:text-fg"><Mail aria-hidden className="size-3.5" />{student.email}</a>}
              {student.city && <span className="inline-flex items-center gap-1.5"><MapPin aria-hidden className="size-3.5" />{student.city}</span>}
            </div>
          </div>
          <dl className="flex gap-6">
            <Detail label="Admissions">{student.admissionCount}</Detail>
            <Detail label="Outstanding"><span className={cn('font-semibold', student.outstandingMinor > 0 && 'text-danger')}>{money(student.outstandingMinor)}</span></Detail>
          </dl>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(next) => setParams((c) => { const p = new URLSearchParams(c); p.set('tab', next); return p; }, { replace: true })}>
        <TabsList className="mb-5">
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t} className="capitalize">{t}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
          <Card>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4">
                <Detail label="Date of birth">{date(student.dateOfBirth)}</Detail>
                <Detail label="Gender">{student.gender ? (student.gender === 'undisclosed' ? 'Prefer not to say' : humanize(student.gender)) : '—'}</Detail>
                <Detail label="Qualification">{student.qualification ? `${student.qualification}${student.yearOfPassing ? ` (${student.yearOfPassing})` : ''}` : '—'}</Detail>
                <Detail label="Status">{humanize(student.status)}</Detail>
                <Detail label="Guardian">{student.guardianName ? `${student.guardianName}${student.guardianPhone ? ` · ${student.guardianPhone}` : ''}` : '—'}</Detail>
                <Detail label="Emergency contact">{student.emergencyContactName ? `${student.emergencyContactName}${student.emergencyContactPhone ? ` · ${student.emergencyContactPhone}` : ''}` : '—'}</Detail>
                <div className="col-span-2"><Detail label="Address">{[student.address, student.city, student.state, student.pincode].filter(Boolean).join(', ') || '—'}</Detail></div>
                {student.notes && <div className="col-span-2"><Detail label="Notes"><span className="whitespace-pre-wrap">{student.notes}</span></Detail></div>}
                <Detail label="Registered">{date(student.createdAt.slice(0, 10))}</Detail>
                {profile.data.leads.length > 0 && (
                  <Detail label="Enquiries">
                    {profile.data.leads.map((l) => <Link key={l.id} to={`/leads?lead=${l.id}`} className="mr-2 font-mono text-xs text-primary hover:underline">{l.leadCode}</Link>)}
                  </Detail>
                )}
              </dl>
            </CardContent>
          </Card>
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-fg">Current enrolment</h2>
            <AdmissionCards admissions={primary ? [primary] : []} onOpen={setOpenAdmission} />
            {admissions.length > 0 && <PortalAccessCard kind="student" recordId={student.id} name={student.fullName} email={student.email} portal={student.portal} invalidate={[studentKeys.profile(student.id)]} />}
          </div>
        </TabsContent>

        <TabsContent value="admissions"><AdmissionCards admissions={admissions} onOpen={setOpenAdmission} /></TabsContent>

        <TabsContent value="payments" className="space-y-6">
          {admissions.length === 0 ? <EmptyState compact title="No admissions, so no payments" /> : admissions.map((a) => (
            <Card key={a.id}>
              <CardContent>
                <p className="mb-4 text-sm font-semibold text-fg">{a.courseName} <span className="font-mono text-xs font-normal text-fg-subtle">{a.admissionNumber}</span></p>
                <AdmissionFinancePanel admission={a} />
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="instalments" className="space-y-6">
          {admissions.length === 0 ? <EmptyState compact title="No instalments" /> : admissions.map((a) => (
            <Card key={a.id}>
              <CardContent>
                <p className="mb-4 text-sm font-semibold text-fg">{a.courseName} <span className="font-mono text-xs font-normal text-fg-subtle">{a.admissionNumber}</span></p>
                <AdmissionFinancePanel admission={a} />
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="loans"><StudentLoansTab studentId={student.id} /></TabsContent>
        <TabsContent value="batches"><StudentBatchesTab admissions={admissions} /></TabsContent>
        <TabsContent value="documents"><StudentDocumentsTab studentId={student.id} studentName={student.fullName} /></TabsContent>
        <TabsContent value="placement"><StudentPlacementTab studentId={student.id} admissions={admissions} /></TabsContent>
        <TabsContent value="activity"><Card><CardContent><Timeline profile={profile.data} /></CardContent></Card></TabsContent>
      </Tabs>

      <StudentFormDrawer student={student} open={editing} onOpenChange={setEditing} />
      <AdmissionDrawer admissionId={openAdmission} onOpenChange={(open) => !open && setOpenAdmission(null)} />
    </>
  );
}
