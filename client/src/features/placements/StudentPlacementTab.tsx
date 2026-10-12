import type { AdmissionDto } from '@ims/shared';
import { BriefcaseBusiness, Plus } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState, LoadingBlock } from '@/components/ui/Feedback';
import { Select } from '@/components/ui/Input';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { api } from '@/lib/api';
import { date } from '@/utils/format';
import { useCourses } from '../shared/hooks';
import { usePlacementMutation, useProfiles } from './api';
import { ProfileDrawer } from './ProfileDrawer';

export function StudentPlacementTab({ studentId, admissions }: { studentId: string; admissions: AdmissionDto[] }) {
  const auth = useAuth();
  const profiles = useProfiles({ studentId, limit: 20 });
  const courses = useCourses();
  const [open, setOpen] = useState<string | null>(null);
  const [admissionId, setAdmissionId] = useState('');
  const create = usePlacementMutation((id: string) => api.post('/placements/profiles', { admissionId: id, track: courses.data?.find((c) => c.id === admissions.find((a) => a.id === id)?.courseId)?.placementTrack === 'non_technical' ? 'non_technical' : 'technical' }), 'Placement profile opened');

  if (profiles.isPending) return <LoadingBlock />;
  const existing = new Set(profiles.data?.items.map((p) => p.admissionId));
  const candidates = admissions.filter((a) => !existing.has(a.id) && a.status !== 'cancelled' && courses.data?.find((c) => c.id === a.courseId)?.placementTrack);

  return (
    <div className="space-y-3">
      {profiles.data?.items.length === 0 && <EmptyState icon={BriefcaseBusiness} compact title="No placement profile" description="One opens automatically when a placement course is completed." />}
      {profiles.data?.items.map((p) => (
        <button key={p.id} type="button" onClick={() => setOpen(p.id)} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-card border bg-surface p-4 text-left shadow-card hover:border-primary/40">
          <div>
            <p className="font-medium text-fg">{p.courseName} · {p.track === 'technical' ? 'Technical' : 'Non-technical'}</p>
            <p className="text-xs text-fg-subtle">Eligible {date(p.eligibleOn)} · {p.applications} application(s)</p>
          </div>
          <div className="flex items-center gap-2">{p.placed && <StatusBadge status="joined" label="Placed" />}<StatusBadge status={p.stage} /></div>
        </button>
      ))}
      {auth.can('placements:write') && candidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Admission" className="h-9 w-72" value={admissionId} onChange={(e) => setAdmissionId(e.target.value)} placeholder="Open a profile for…" options={candidates.map((a) => ({ value: a.id, label: `${a.courseName} (${a.admissionNumber})` }))} />
          <Button size="sm" className="h-9" disabled={!admissionId} loading={create.isPending} onClick={() => create.mutate(admissionId)}><Plus aria-hidden className="size-4" /> Open profile</Button>
        </div>
      )}
      <ProfileDrawer profileId={open} onOpenChange={(o) => !o && setOpen(null)} />
    </div>
  );
}
