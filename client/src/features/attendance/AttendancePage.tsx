import { ATTENDANCE_STATUSES, todayInZone, type AttendanceRosterDto } from '@ims/shared';
import { CalendarCheck, CheckCheck, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { DataTableView } from '@/components/charts/ChartKit';
import { DateFilter, FilterSelect, Toolbar } from '@/components/data/Toolbar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { date, dateTime, getFormatConfig, humanize, number, percent } from '@/utils/format';
import { useAction, useAttendanceSessions, useAttendanceSummary, useMyBatches, useRoster } from '../campus/api';

type Mark = { status: string; minutesLate: number; remark: string };
const SHORT: Record<string, string> = { present: 'P', late: 'L', on_duty: 'OD', absent: 'A', holiday: 'H' };
const TONE: Record<string, string> = {
  present: 'border-success/50 bg-success-soft text-success',
  late: 'border-warning/50 bg-warning-soft text-warning',
  on_duty: 'border-primary/50 bg-primary-soft text-primary',
  absent: 'border-danger/50 bg-danger-soft text-danger',
  holiday: 'border-border-strong bg-surface-raised text-fg-muted',
};
const LOW = 0.75;

function Register({ roster, classId }: { roster: AttendanceRosterDto; classId: string | null }) {
  const { can } = useAuth();
  const canWrite = can('attendance:write');
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [topic, setTopic] = useState('');

  useEffect(() => {
    setMarks(Object.fromEntries(roster.rows.map((r) => [r.admissionId, { status: r.status ?? '', minutesLate: r.minutesLate, remark: r.remark ?? '' }])));
    setTopic(roster.topic ?? '');
  }, [roster]);

  const save = useAction(
    () =>
      api.post('/attendance', {
        batchId: roster.batch.id,
        date: roster.date,
        topic: topic || undefined,
        classSessionId: classId ?? roster.classSessionId ?? undefined,
        records: Object.entries(marks)
          .filter(([, m]) => m.status)
          .map(([admissionId, m]) => ({ admissionId, status: m.status, minutesLate: m.status === 'late' ? m.minutesLate : 0, remark: m.remark || undefined })),
      }),
    { invalidate: [['attendance'], ['schedule']], success: 'Attendance saved' },
  );

  const set = (id: string, patch: Partial<Mark>) => setMarks((m) => ({ ...m, [id]: { ...m[id]!, ...patch } }));
  const marked = Object.values(marks).filter((m) => m.status).length;
  const tally = Object.values(marks).reduce<Record<string, number>>((acc, m) => (m.status ? { ...acc, [m.status]: (acc[m.status] ?? 0) + 1 } : acc), {});
  const future = roster.date > todayInZone(getFormatConfig().timeZone);

  if (roster.rows.length === 0) return <EmptyState icon={CalendarCheck} title="Nobody was in this batch on that day" description="Students appear here from the day they are assigned to the batch." />;

  return (
    <Card className="overflow-hidden">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-fg">{roster.batch.batchCode} · {date(roster.date)}</p>
          <p className="text-xs text-fg-subtle">
            {roster.sessionId ? `Taken by ${roster.takenByName ?? 'someone'} · updated ${dateTime(roster.updatedAt)}` : 'Not taken yet'} · {marked}/{roster.rows.length} marked
            {Object.entries(tally).map(([k, v]) => ` · ${v} ${humanize(k).toLowerCase()}`).join('')}
          </p>
        </div>
        {canWrite && !future && (
          <div className="flex flex-wrap items-end gap-2">
            <Input aria-label="Topic covered" className="h-9 w-56" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic covered (optional)" maxLength={200} />
            <Button variant="secondary" className="h-9" onClick={() => setMarks((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v, status: v.status || 'present' }])))}>
              <CheckCheck aria-hidden className="size-4" /> Mark the rest present
            </Button>
            <Button className="h-9" loading={save.isPending} disabled={marked === 0} onClick={() => save.mutate(undefined)}>
              <Save aria-hidden className="size-4" /> Save
            </Button>
          </div>
        )}
      </header>
      {future && <p className="px-4 py-2 text-sm text-warning">Attendance cannot be taken for a future day.</p>}
      <ul className="divide-y">
        {roster.rows.map((r) => {
          const m = marks[r.admissionId] ?? { status: '', minutesLate: 0, remark: '' };
          return (
            <li key={r.admissionId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div className="min-w-48 flex-1">
                <p className="font-medium text-fg">{r.studentName}</p>
                <p className="text-xs text-fg-subtle">
                  {r.studentCode}
                  {r.percent !== null && <span className={cn('ml-2', r.percent < LOW && 'text-danger')}>· {percent(r.percent, 0)} so far</span>}
                </p>
              </div>
              <div role="radiogroup" aria-label={`Attendance for ${r.studentName}`} className="flex gap-1">
                {ATTENDANCE_STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={m.status === s}
                    aria-label={humanize(s)}
                    title={humanize(s)}
                    disabled={!canWrite || future}
                    onClick={() => set(r.admissionId, { status: s })}
                    className={cn('h-8 min-w-9 rounded-lg border px-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed', m.status === s ? TONE[s] : 'border-border text-fg-subtle hover:border-border-strong hover:text-fg')}
                  >
                    {SHORT[s]}
                  </button>
                ))}
              </div>
              {m.status === 'late' && (
                <Input aria-label="Minutes late" type="number" min={0} max={720} className="h-8 w-24" value={m.minutesLate} disabled={!canWrite} onChange={(e) => set(r.admissionId, { minutesLate: Number(e.target.value) })} trailing={<span className="text-xs">min</span>} />
              )}
              <Input aria-label="Remark" className="h-8 w-48" value={m.remark} disabled={!canWrite || future} onChange={(e) => set(r.admissionId, { remark: e.target.value })} placeholder="Remark" maxLength={200} />
            </li>
          );
        })}
      </ul>
      <p className="border-t px-4 py-2 text-xs text-fg-subtle">P present · L late · OD on duty (counts as attended) · A absent · H holiday (not counted)</p>
    </Card>
  );
}

export function AttendancePage() {
  const [params, setParams] = useSearchParams();
  const today = todayInZone(getFormatConfig().timeZone);
  const batches = useMyBatches();
  const batchId = params.get('batchId') ?? '';
  const day = params.get('date') ?? today;
  const classId = params.get('classId');
  const view = (params.get('view') ?? 'register') as 'register' | 'history' | 'summary';
  const roster = useRoster(batchId, day);
  const sessions = useAttendanceSessions(view === 'history' ? batchId : '');
  const summary = useAttendanceSummary(view === 'summary' ? batchId : '');
  const options = useMemo(() => (batches.data?.items ?? []).map((b) => ({ value: b.id, label: `${b.batchCode} · ${b.name}` })), [batches.data]);

  const setParam = (patch: Record<string, string>) =>
    setParams((c) => {
      const p = new URLSearchParams(c);
      for (const [k, v] of Object.entries(patch)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      return p;
    });

  useEffect(() => {
    if (!batchId && options.length === 1) setParam({ batchId: options[0]!.value });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.length]);

  return (
    <>
      <PageHeader title="Attendance" description="One register per batch per day. Students appear from the day they joined the batch until they left it." />
      <Toolbar>
        <FilterSelect label="Batch" value={batchId} onChange={(v) => setParam({ batchId: v, classId: '' })} options={options} allLabel="Choose a batch" className="min-w-64" />
        {view === 'register' && <DateFilter label="Day" value={day} max={today} onChange={(v) => setParam({ date: v, classId: '' })} />}
        <div role="tablist" aria-label="Attendance views" className="ml-auto flex gap-1 self-end rounded-control border bg-surface p-1">
          {(['register', 'history', 'summary'] as const).map((v) => (
            <button key={v} role="tab" type="button" aria-selected={view === v} onClick={() => setParam({ view: v === 'register' ? '' : v })} className={cn('rounded-lg px-3 py-1.5 text-sm font-medium transition-colors', view === v ? 'bg-primary-soft text-primary' : 'text-fg-muted hover:text-fg')}>
              {humanize(v)}
            </button>
          ))}
        </div>
      </Toolbar>

      {!batchId ? (
        <EmptyState icon={CalendarCheck} title="Choose a batch" description={options.length === 0 && !batches.isPending ? 'You have no batches yet.' : 'Pick a batch to take or review attendance.'} />
      ) : view === 'register' ? (
        roster.isPending ? <LoadingBlock /> : roster.isError ? <ErrorState error={roster.error} onRetry={() => void roster.refetch()} /> : <Register roster={roster.data} classId={classId} />
      ) : view === 'history' ? (
        sessions.isPending ? (
          <LoadingBlock />
        ) : (sessions.data ?? []).length === 0 ? (
          <EmptyState icon={CalendarCheck} title="No attendance taken yet" />
        ) : (
          <Card className="overflow-x-auto p-3">
            <DataTableView
              rows={sessions.data ?? []}
              columns={[
                { key: 'd', label: 'Day', render: (s) => <button type="button" className="text-primary hover:underline" onClick={() => setParam({ view: '', date: s.date })}>{date(s.date)}</button> },
                { key: 't', label: 'Topic', render: (s) => s.topic ?? '—' },
                { key: 'p', label: 'Present', align: 'right', render: (s) => number(s.present + s.late + s.onDuty) },
                { key: 'a', label: 'Absent', align: 'right', render: (s) => (s.absent ? <span className="text-danger">{s.absent}</span> : 0) },
                { key: 'r', label: 'Rate', align: 'right', render: (s) => percent(s.total - s.holiday > 0 ? (s.present + s.late + s.onDuty) / (s.total - s.holiday) : null, 0) },
                { key: 'by', label: 'Taken by', render: (s) => s.takenByName ?? '—' },
              ]}
            />
          </Card>
        )
      ) : summary.isPending ? (
        <LoadingBlock />
      ) : (
        <Card className="overflow-x-auto p-3">
          <DataTableView
            rows={summary.data ?? []}
            columns={[
              { key: 's', label: 'Student', render: (r) => <span>{r.studentName} <span className="text-xs text-fg-subtle">{r.studentCode}</span></span> },
              { key: 'n', label: 'Days marked', align: 'right', render: (r) => r.sessions },
              { key: 'p', label: 'Present', align: 'right', render: (r) => r.present },
              { key: 'l', label: 'Late', align: 'right', render: (r) => r.late },
              { key: 'o', label: 'On duty', align: 'right', render: (r) => r.onDuty },
              { key: 'a', label: 'Absent', align: 'right', render: (r) => r.absent },
              { key: 'h', label: 'Holiday', align: 'right', render: (r) => r.holiday },
              { key: 'pc', label: 'Attendance', align: 'right', render: (r) => (r.percent === null ? '—' : <Badge tone={r.percent < LOW ? 'danger' : 'success'}>{percent(r.percent, 0)}</Badge>) },
            ]}
          />
          <p className="px-2 pt-2 text-xs text-fg-subtle">Below {percent(LOW, 0)} is flagged. Holidays do not count against anyone.</p>
        </Card>
      )}
    </>
  );
}
