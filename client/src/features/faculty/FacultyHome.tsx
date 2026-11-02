import { addDays, todayInZone } from '@ims/shared';
import { CalendarCheck, CalendarDays, ClipboardCheck, GraduationCap, ListChecks } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { HeroHeader } from '@/components/visual/HeroHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { cn } from '@/lib/cn';
import { date, getFormatConfig, humanize } from '@/utils/format';
import { useExams, useMyBatches, useSchedule, useTasks } from '../campus/api';
import { ClassList } from '../campus/ClassList';

/** The faculty landing page: today's teaching, their batches, their work. */
export function FacultyHome() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const today = todayInZone(getFormatConfig().timeZone);
  const classes = useSchedule({ from: today, to: addDays(today, 6) });
  const batches = useMyBatches();
  const tasks = useTasks({ scope: 'mine', status: 'todo,in_progress', limit: 8 });
  const drafts = useExams({ status: 'draft', limit: 5 });
  const live = (batches.data?.items ?? []).filter((b) => b.status !== 'completed');
  const pendingAttendance = (classes.data ?? []).filter((s) => s.date <= today && s.status !== 'cancelled' && !s.attendanceTaken);

  return (
    <>
      <HeroHeader eyebrow="My teaching" title={`Good to see you, ${user?.name.split(' ')[0] ?? ''}`} description="Your classes this week, your batches and what is waiting for you." />
      <div className="stagger grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>This week's classes</CardTitle>
            <Link to="/schedule" className="text-xs text-primary hover:underline">Full schedule</Link>
          </CardHeader>
          <CardContent>
            {classes.isPending ? (
              <LoadingBlock />
            ) : classes.error ? (
              <ErrorState error={classes.error} onRetry={() => void classes.refetch()} />
            ) : (
              <ClassList
                sessions={classes.data ?? []}
                today={today}
                empty={<EmptyState compact icon={CalendarDays} title="No classes in the next 7 days" action={can('schedule:write') ? <Button size="sm" variant="secondary" onClick={() => navigate('/schedule?action=new')}>Schedule a class</Button> : undefined} />}
                action={(s) =>
                  s.date <= today && s.status !== 'cancelled' && can('attendance:write') ? (
                    <Button size="sm" variant={s.attendanceTaken ? 'ghost' : 'secondary'} onClick={() => navigate(`/attendance?batchId=${s.batchId}&date=${s.date}&classId=${s.id}`)}>
                      {s.attendanceTaken ? 'Attendance' : 'Take attendance'}
                    </Button>
                  ) : null
                }
              />
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Waiting on you</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Link to="/attendance" className="flex items-center justify-between rounded-control px-2 py-1.5 hover:bg-surface-raised">
                <span className="flex items-center gap-2 text-fg-muted"><CalendarCheck aria-hidden className="size-4" /> Registers not taken</span>
                <span className={cn('font-semibold tabular-nums', pendingAttendance.length ? 'text-warning' : 'text-fg')}>{classes.isPending ? '…' : pendingAttendance.length}</span>
              </Link>
              <Link to="/exams?status=draft" className="flex items-center justify-between rounded-control px-2 py-1.5 hover:bg-surface-raised">
                <span className="flex items-center gap-2 text-fg-muted"><ClipboardCheck aria-hidden className="size-4" /> Exam drafts</span>
                <span className="font-semibold tabular-nums text-fg">{drafts.data?.total ?? '…'}</span>
              </Link>
              <Link to="/tasks" className="flex items-center justify-between rounded-control px-2 py-1.5 hover:bg-surface-raised">
                <span className="flex items-center gap-2 text-fg-muted"><ListChecks aria-hidden className="size-4" /> Open tasks</span>
                <span className="font-semibold tabular-nums text-fg">{tasks.data?.total ?? '…'}</span>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>My tasks</CardTitle>
              <Link to="/tasks" className="text-xs text-primary hover:underline">All</Link>
            </CardHeader>
            <CardContent>
              {tasks.isPending ? (
                <LoadingBlock />
              ) : (tasks.data?.items ?? []).length === 0 ? (
                <p className="text-sm text-fg-muted">Nothing open.</p>
              ) : (
                <ul className="space-y-2">
                  {tasks.data!.items.map((t) => (
                    <li key={t.id} className="flex items-start justify-between gap-2 text-sm">
                      <span className="min-w-0 text-fg">{t.title}</span>
                      <span className={cn('shrink-0 text-xs tabular-nums', t.isOverdue ? 'font-medium text-danger' : 'text-fg-subtle')}>{t.dueDate ? date(t.dueDate) : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>My batches</CardTitle>
            <Link to="/batches" className="text-xs text-primary hover:underline">All batches</Link>
          </CardHeader>
          <CardContent>
            {batches.isPending ? (
              <LoadingBlock />
            ) : live.length === 0 ? (
              <EmptyState compact icon={GraduationCap} title="No batches assigned to you yet" description="The office assigns trainers to batches; yours will appear here." />
            ) : (
              <ul className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {live.map((b) => (
                  <li key={b.id}>
                    <Link to={`/batches/${b.id}`} className="card-interactive block rounded-card border bg-surface p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-fg">{b.batchCode}</p>
                        <StatusBadge status={b.status} />
                      </div>
                      <p className="truncate text-sm text-fg-muted">{b.courseName}</p>
                      <p className="mt-1 text-xs text-fg-subtle">{b.enrolled} students · {b.schedule ?? humanize(b.status)} · from {date(b.startDate)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
