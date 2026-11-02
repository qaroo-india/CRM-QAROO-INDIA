import {
  APPLICATION_OUTCOMES,
  INTERVIEW_MODES,
  INTERVIEW_RESULTS,
  PLACEMENT_STAGES,
  RESUME_STATUSES,
  applicationOutcomeFormSchema,
  todayInZone,
  zonedDayStart,
  type ApplicationDto,
  type PlacementProfileDetail,
} from '@ims/shared';
import { Briefcase, CalendarPlus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DialogContent, DialogRoot, DrawerContent } from '@/components/ui/Dialog';
import { ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { api } from '@/lib/api';
import { useZodForm } from '@/lib/forms';
import { date, dateTime, getFormatConfig, humanize, money } from '@/utils/format';
import { toOptions, useJobCategories, useUserOptions } from '../shared/hooks';
import { useCompanies, usePlacementMutation, useProfile } from './api';

function NewApplicationDialog({ profile, open, onOpenChange }: { profile: PlacementProfileDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const companies = useCompanies();
  const categories = useJobCategories();
  const [companyId, setCompanyId] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [location, setLocation] = useState('');
  const [appliedOn, setAppliedOn] = useState(todayInZone(getFormatConfig().timeZone));
  const [source, setSource] = useState('');
  const create = usePlacementMutation((body: Record<string, unknown>) => api.post('/placements/applications', body), 'Application recorded');
  useEffect(() => { if (open) { setCompanyId(''); setCompanyName(''); setJobTitle(''); setCategoryId(''); setLocation(''); setSource(''); } }, [open]);

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Record an application"
        size="lg"
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={(!companyId && !companyName.trim()) || !jobTitle.trim()} loading={create.isPending} onClick={() => create.mutate({ profileId: profile.id, companyId: companyId || null, companyName: companyId ? undefined : companyName, jobTitle, jobCategoryId: categoryId || null, location, appliedOn, source }, { onSuccess: () => onOpenChange(false) })}>Save</Button></>}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company" hint="Pick one, or type a new company below.">
            <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)} placeholder="New company…" options={toOptions(companies.data)} />
          </Field>
          {!companyId && <Field label="New company name" required><Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></Field>}
          <Field label="Job title" required><Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} /></Field>
          <Field label="Category">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} placeholder="Select…" options={toOptions(categories.data?.filter((c) => c.track === profile.track))} />
          </Field>
          <Field label="Location"><Input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
          <Field label="Applied on" required><Input type="date" value={appliedOn} onChange={(e) => setAppliedOn(e.target.value)} /></Field>
          <Field label="Source" hint="Referral, job portal, campus drive…"><Input value={source} onChange={(e) => setSource(e.target.value)} /></Field>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

function OutcomeDialog({ application, onClose }: { application: ApplicationDto | null; onClose: () => void }) {
  const form = useZodForm(applicationOutcomeFormSchema, { defaultValues: { outcome: 'in_progress', rejectionReason: '', offerOn: '', joiningOn: '', offerPackageMinor: '' } });
  useEffect(() => {
    if (application) form.reset({ outcome: application.outcome as never, rejectionReason: application.rejectionReason ?? '', offerOn: application.offerOn ?? '', joiningOn: application.joiningOn ?? '', offerPackageMinor: '' });
  }, [application, form]);
  const save = usePlacementMutation((body: Record<string, unknown>) => api.post(`/placements/applications/${application!.id}/outcome`, body), 'Outcome updated');
  if (!application) return null;
  const outcome = form.watch('outcome');
  const errors = form.formState.errors;
  return (
    <DialogRoot open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`${application.companyName} · ${application.jobTitle}`}
        description="A student counts as placed only once an application is marked joined."
        size="sm"
        footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v, { onSuccess: onClose }))}>Save</Button></>}
      >
        <form noValidate className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <Field label="Outcome"><Select options={APPLICATION_OUTCOMES.map((o) => ({ value: o, label: humanize(o) }))} {...form.register('outcome')} /></Field>
          {outcome === 'rejected' && <Field label="Reason" error={errors.rejectionReason?.message} required><Textarea rows={2} {...form.register('rejectionReason')} /></Field>}
          {['offer_received', 'offer_declined', 'joined'].includes(outcome) && (
            <>
              <Field label="Offer date" error={errors.offerOn?.message} required><Input type="date" {...form.register('offerOn')} /></Field>
              <Field label="Annual package" error={errors.offerPackageMinor?.message}><MoneyInput {...form.register('offerPackageMinor')} /></Field>
            </>
          )}
          {outcome === 'joined' && <Field label="Joining date" error={errors.joiningOn?.message} required><Input type="date" {...form.register('joiningOn')} /></Field>}
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

function InterviewDialog({ application, onClose }: { application: ApplicationDto | null; onClose: () => void }) {
  const [round, setRound] = useState('1');
  const [name, setName] = useState('');
  const [day, setDay] = useState(todayInZone(getFormatConfig().timeZone));
  const [time, setTime] = useState('10:00');
  const [mode, setMode] = useState('in_person');
  const add = usePlacementMutation((body: Record<string, unknown>) => api.post(`/placements/applications/${application!.id}/interviews`, body), 'Interview scheduled');
  useEffect(() => { if (application) { setRound(String(application.interviews.length + 1)); setName(''); } }, [application]);
  if (!application) return null;

  // Wall-clock time in the institute's zone -> exact instant.
  const toInstant = () => {
    const [h, m] = time.split(':').map(Number) as [number, number];
    return new Date(zonedDayStart(day, getFormatConfig().timeZone).getTime() + (h * 60 + m) * 60_000).toISOString();
  };
  return (
    <DialogRoot open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Interview · ${application.companyName}`} size="sm" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!name.trim()} loading={add.isPending} onClick={() => add.mutate({ roundNumber: Number(round), roundName: name, scheduledAt: toInstant(), mode }, { onSuccess: onClose })}>Schedule</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Round"><Input type="number" min={1} value={round} onChange={(e) => setRound(e.target.value)} /></Field>
          <Field label="Round name" required><Input placeholder="Technical, HR…" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Date"><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
          <Field label="Time" hint={`${getFormatConfig().timeZone} time`}><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <Field label="Mode"><Select value={mode} onChange={(e) => setMode(e.target.value)} options={INTERVIEW_MODES.map((m) => ({ value: m, label: humanize(m) }))} /></Field>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

function ProfileEditor({ profile }: { profile: PlacementProfileDetail }) {
  const people = useUserOptions();
  const [resume, setResume] = useState(profile.resumeStatus);
  const [score, setScore] = useState(profile.readinessScore === null ? '' : String(profile.readinessScore));
  const [skills, setSkills] = useState(profile.skills.join(', '));
  const [coordinator, setCoordinator] = useState(profile.coordinatorId ?? '');
  const save = usePlacementMutation(
    () => api.put(`/placements/profiles/${profile.id}`, { track: profile.track, eligibleOn: profile.eligibleOn, resumeStatus: resume, readinessScore: score, skills: skills.split(',').map((s) => s.trim()).filter(Boolean), coordinatorId: coordinator || null, notes: profile.notes ?? '' }),
    'Profile saved',
  );
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Resume"><Select value={resume} onChange={(e) => setResume(e.target.value)} options={RESUME_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} /></Field>
        <Field label="Readiness (0-100)"><Input type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} /></Field>
        <Field label="Coordinator"><Select value={coordinator} onChange={(e) => setCoordinator(e.target.value)} placeholder="Unassigned" options={toOptions(people.data)} /></Field>
      </div>
      <Field label="Skills" hint="Comma-separated."><Input value={skills} onChange={(e) => setSkills(e.target.value)} /></Field>
      <Button size="sm" variant="secondary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save profile</Button>
    </div>
  );
}

export function ProfileDrawer({ profileId, onOpenChange }: { profileId: string | null; onOpenChange: (o: boolean) => void }) {
  const auth = useAuth();
  const profile = useProfile(profileId);
  const [applying, setApplying] = useState(false);
  const [outcomeFor, setOutcomeFor] = useState<ApplicationDto | null>(null);
  const [interviewFor, setInterviewFor] = useState<ApplicationDto | null>(null);
  const stage = usePlacementMutation(({ id, stage: s }: { id: string; stage: string }) => api.post(`/placements/profiles/${id}/stage`, { stage: s }), 'Stage updated');
  const result = usePlacementMutation(({ id, result: r }: { id: string; result: string }) => api.post(`/placements/interviews/${id}/result`, { result: r }), 'Interview updated');
  const p = profile.data;
  const canWrite = auth.can('placements:write');

  return (
    <DialogRoot open={!!profileId} onOpenChange={onOpenChange}>
      <DrawerContent title={p ? p.studentName : 'Placement profile'} description={p ? `${p.courseName} · ${humanize(p.track)} track` : undefined} width="xl">
        {profile.isPending ? <LoadingBlock /> : profile.isError ? <ErrorState error={profile.error} /> : p ? (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={p.stage} />
              {p.placed ? <Badge tone="success">Placed</Badge> : <Badge tone="neutral">Not yet placed</Badge>}
              <span className="text-xs text-fg-subtle">Eligible {date(p.eligibleOn)} · <Link to={`/students/${p.studentId}?tab=placement`} className="text-primary hover:underline">student profile</Link></span>
            </div>
            {canWrite && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-fg-subtle">Stage</span>
                  <Select className="h-9 w-52" value={p.stage} onChange={(e) => stage.mutate({ id: p.id, stage: e.target.value })} options={PLACEMENT_STAGES.map((s) => ({ value: s, label: humanize(s), disabled: s === 'joined' && !p.placed }))} />
                </label>
                <Button size="sm" className="h-9" onClick={() => setApplying(true)}><Plus aria-hidden className="size-4" /> Application</Button>
              </div>
            )}
            {canWrite && <ProfileEditor key={p.id + p.resumeStatus} profile={p} />}

            <section className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-fg"><Briefcase aria-hidden className="size-4 text-fg-subtle" /> Applications ({p.applicationsList.length})</h3>
              {p.applicationsList.length === 0 && <p className="text-sm text-fg-muted">No applications yet.</p>}
              {p.applicationsList.map((a) => (
                <article key={a.id} className="rounded-control border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-fg">{a.companyName} · {a.jobTitle}</p>
                      <p className="text-xs text-fg-subtle">Applied {date(a.appliedOn)}{a.location ? ` · ${a.location}` : ''}{a.jobCategoryName ? ` · ${a.jobCategoryName}` : ''}</p>
                      {a.offerPackageMinor !== null && <p className="text-xs text-fg-muted">Package {money(a.offerPackageMinor, { compactDecimals: true })}{a.joiningOn ? ` · joined ${date(a.joiningOn)}` : ''}</p>}
                    </div>
                    <div className="flex items-center gap-1">
                      <StatusBadge status={a.outcome} />
                      {canWrite && <Button size="sm" variant="ghost" onClick={() => setOutcomeFor(a)}>Outcome</Button>}
                      {canWrite && <Button size="sm" variant="ghost" onClick={() => setInterviewFor(a)} aria-label="Schedule interview"><CalendarPlus aria-hidden className="size-4" /></Button>}
                    </div>
                  </div>
                  {a.interviews.length > 0 && (
                    <ul className="mt-2 space-y-1 border-t pt-2">
                      {a.interviews.map((i) => (
                        <li key={i.id} className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-fg">Round {i.roundNumber}: {i.roundName}</span>
                          <span className="text-fg-subtle">{dateTime(i.scheduledAt)} · {humanize(i.mode)}</span>
                          {canWrite ? (
                            <Select aria-label="Interview result" className="ml-auto h-7 w-32 text-xs" value={i.result} onChange={(e) => result.mutate({ id: i.id, result: e.target.value })} options={INTERVIEW_RESULTS.map((r) => ({ value: r, label: humanize(r) }))} />
                          ) : <StatusBadge status={i.result} />}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </section>
            <NewApplicationDialog profile={p} open={applying} onOpenChange={setApplying} />
            <OutcomeDialog application={outcomeFor} onClose={() => setOutcomeFor(null)} />
            <InterviewDialog application={interviewFor} onClose={() => setInterviewFor(null)} />
          </div>
        ) : null}
      </DrawerContent>
    </DialogRoot>
  );
}
