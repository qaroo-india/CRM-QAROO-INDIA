/**
 * Student exams: the list, a timed attempt and the result. The paper never
 * contains the correct answers; each choice is saved to the server as it is
 * made, and grading happens on the server when the student submits or time
 * runs out.
 */

import type { AttemptResult, ExamPaper, PortalExam } from '@ims/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpenCheck, CircleCheck, CircleX, Clock, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { api, ApiRequestError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { toastError } from '@/lib/forms';
import { dateTime, humanize, percent } from '@/utils/format';
import { useAction, useExamPaper, usePortalExams, usePortalResults } from '../campus/api';

const bpsText = (bps: number | null) => (bps === null ? '—' : percent(bps / 10_000, 1));

function ExamCard({ exam, onStart }: { exam: PortalExam; onStart: (e: PortalExam) => void }) {
  const navigate = useNavigate();
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-fg">{exam.title}</p>
            <p className="text-sm text-fg-muted">{exam.courseName} · {humanize(exam.kind)}</p>
          </div>
          {exam.passed !== null && <Badge tone={exam.passed ? 'success' : 'warning'}>{exam.passed ? 'Passed' : 'Not passed yet'} · best {bpsText(exam.bestPercentBps)}</Badge>}
        </div>
        <p className="text-sm text-fg-subtle">
          {exam.questionCount} questions · {exam.totalMarks} marks · {exam.durationMinutes} minutes · pass mark {exam.passPercent}% · attempts {exam.attemptsUsed}/{exam.maxAttempts}
        </p>
        {(exam.availableFrom || exam.availableUntil) && (
          <p className="text-xs text-fg-subtle">
            {exam.availableFrom && `Opens ${dateTime(exam.availableFrom)}`}
            {exam.availableFrom && exam.availableUntil && ' · '}
            {exam.availableUntil && `Closes ${dateTime(exam.availableUntil)}`}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {exam.inProgressAttemptId ? (
            <Button onClick={() => navigate(`/portal/attempts/${exam.inProgressAttemptId}`)}>Continue attempt</Button>
          ) : exam.blockedReason ? (
            <p className="text-sm text-fg-muted">{exam.blockedReason}</p>
          ) : (
            <Button onClick={() => onStart(exam)}>{exam.attemptsUsed ? 'Try again' : 'Start exam'}</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function PortalExamsPage() {
  const navigate = useNavigate();
  const exams = usePortalExams();
  const results = usePortalResults();
  const [starting, setStarting] = useState<PortalExam | null>(null);
  const start = useAction((id: string) => api.post<ExamPaper>(`/portal/exams/${id}/start`), {
    invalidate: [['portal', 'exams']],
    onDone: (paper) => navigate(`/portal/attempts/${paper.attemptId}`),
  });

  return (
    <>
      <PageHeader title="Exams & results" description="Online tests for your course. Your answers save as you go; the timer keeps running if you close the page." />
      {exams.isPending ? (
        <LoadingBlock />
      ) : exams.error ? (
        <ErrorState error={exams.error} onRetry={() => void exams.refetch()} />
      ) : exams.data.length === 0 ? (
        <Card><EmptyState icon={BookOpenCheck} title="No exams yet" description="When your trainer publishes an exam you get a notification and it appears here." /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">{exams.data.map((e) => <ExamCard key={e.id} exam={e} onStart={setStarting} />)}</div>
      )}

      <h2 className="mt-8 mb-3 text-sm font-semibold text-fg">My results</h2>
      <Card>
        {results.isPending ? (
          <LoadingBlock />
        ) : (results.data ?? []).length === 0 ? (
          <EmptyState compact title="No submitted attempts yet" />
        ) : (
          <ul className="divide-y">
            {results.data!.map((r) => (
              <li key={r.attemptId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div className="min-w-0">
                  <Link to={`/portal/attempts/${r.attemptId}`} className="font-medium text-fg hover:underline">{r.examTitle}</Link>
                  <p className="text-xs text-fg-subtle">Attempt {r.attemptNumber} · {dateTime(r.submittedAt)}{r.autoSubmitted ? ' · submitted when time ran out' : ''}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm tabular-nums text-fg">{r.score}/{r.totalMarks} · {bpsText(r.percentBps)}</span>
                  <Badge tone={r.passed ? 'success' : 'danger'}>{r.passed ? 'Pass' : 'Fail'}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(starting)}
        onOpenChange={(o) => !o && setStarting(null)}
        title={`Start ${starting?.title}?`}
        description={`You have ${starting?.durationMinutes} minutes from now. The timer cannot be paused, and unanswered questions score nothing when time runs out.`}
        confirmLabel="Start now"
        loading={start.isPending}
        onConfirm={() => starting && start.mutate(starting.id, { onSettled: () => setStarting(null) })}
      />
    </>
  );
}

function Countdown({ deadlineAt, onExpire }: { deadlineAt: string; onExpire: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.floor((new Date(deadlineAt).getTime() - now) / 1000));
  useEffect(() => {
    if (left === 0 && !fired.current) {
      fired.current = true;
      onExpire();
    }
  }, [left, onExpire]);
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  return (
    <span role="timer" aria-label={`${Math.ceil(left / 60)} minutes left`} className={cn('inline-flex items-center gap-1.5 rounded-control border px-3 py-1.5 font-mono text-sm tabular-nums', left <= 60 ? 'border-danger/40 bg-danger-soft text-danger' : left <= 300 ? 'border-warning/40 text-warning' : 'text-fg')}>
      <Clock aria-hidden className="size-4" />
      {mm}:{ss}
    </span>
  );
}

function ResultView({ result }: { result: AttemptResult }) {
  return (
    <Card className="mx-auto max-w-xl">
      <CardContent className="space-y-4 text-center">
        <span className={cn('mx-auto grid size-12 place-items-center rounded-2xl border', result.passed ? 'border-success/30 bg-success-soft text-success' : 'border-danger/30 bg-danger-soft text-danger')}>
          {result.passed ? <CircleCheck aria-hidden className="size-6" /> : <CircleX aria-hidden className="size-6" />}
        </span>
        <div>
          <p className="text-lg font-semibold text-fg">{result.passed ? 'You passed' : 'Not passed this time'}</p>
          <p className="text-sm text-fg-muted">{result.examTitle} · attempt {result.attemptNumber}</p>
        </div>
        <p className="text-3xl font-semibold tabular-nums text-fg">{result.score}<span className="text-lg text-fg-subtle">/{result.totalMarks}</span></p>
        <p className="text-sm text-fg-muted">
          {bpsText(result.percentBps)} · {result.correct} of {result.questionCount} correct · {result.answered} answered
          {result.autoSubmitted && <><br />Submitted automatically when time ran out.</>}
        </p>
        <Link to="/portal/exams" className="inline-block text-sm text-primary hover:underline">Back to exams</Link>
      </CardContent>
    </Card>
  );
}

const FINISHED = new Set(['ALREADY_SUBMITTED', 'TIME_UP']);

export function PortalAttemptPage() {
  const { attemptId } = useParams();
  const queryClient = useQueryClient();
  const paper = useExamPaper(attemptId);
  const finished = paper.error instanceof ApiRequestError && FINISHED.has(paper.error.code);
  const [submitted, setSubmitted] = useState<AttemptResult | null>(null);
  const result = useQuery({ queryKey: ['portal', 'attempt-result', attemptId], queryFn: () => api.get<AttemptResult>(`/portal/attempts/${attemptId}/result`), enabled: finished && !submitted });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (paper.data) setAnswers(paper.data.answers);
  }, [paper.data]);

  const submit = useCallback(async () => {
    if (!attemptId) return;
    setSubmitting(true);
    try {
      const r = await api.post<AttemptResult>(`/portal/attempts/${attemptId}/submit`);
      setSubmitted(r);
      void queryClient.invalidateQueries({ queryKey: ['portal'] });
    } catch (error) {
      toastError(error);
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  }, [attemptId, queryClient]);

  const choose = async (questionId: string, optionId: string) => {
    const previous = answers[questionId];
    setAnswers((a) => ({ ...a, [questionId]: optionId }));
    setSaving((s) => ({ ...s, [questionId]: true }));
    try {
      await api.put(`/portal/attempts/${attemptId}/answers`, { questionId, optionId });
    } catch (error) {
      if (error instanceof ApiRequestError && FINISHED.has(error.code)) {
        void submit();
        return;
      }
      setAnswers((a) => {
        const next = { ...a };
        if (previous) next[questionId] = previous;
        else delete next[questionId];
        return next;
      });
      toastError(error, 'Could not save that answer. Try again.');
    } finally {
      setSaving((s) => ({ ...s, [questionId]: false }));
    }
  };

  const done = submitted ?? result.data;
  if (done) return <><PageHeader title="Result" breadcrumbs={[{ label: 'Exams & results', to: '/portal/exams' }, { label: done.examTitle }]} /><ResultView result={done} /></>;
  if (paper.isPending || (finished && result.isPending)) return <LoadingBlock />;
  if (paper.error && !finished) return <ErrorState error={paper.error} onRetry={() => void paper.refetch()} />;
  if (result.error) return <ErrorState error={result.error} onRetry={() => void result.refetch()} />;
  if (!paper.data) return <LoadingBlock />;

  const p = paper.data;
  const answered = p.questions.filter((q) => answers[q.id]).length;
  const anySaving = Object.values(saving).some(Boolean);

  return (
    <>
      <div className="sticky top-16 z-20 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-card border bg-surface/95 px-4 py-3 shadow-card backdrop-blur-md">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-fg">{p.examTitle}</h1>
          <p className="text-xs text-fg-subtle">{answered} of {p.questions.length} answered · {p.totalMarks} marks{anySaving ? ' · saving…' : ' · all answers saved'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Countdown deadlineAt={p.deadlineAt} onExpire={() => void submit()} />
          <Button loading={submitting} onClick={() => setConfirming(true)}>Submit</Button>
        </div>
      </div>
      {p.instructions && <Card className="mb-4 p-4 text-sm whitespace-pre-line text-fg-muted">{p.instructions}</Card>}
      <ol className="space-y-4">
        {p.questions.map((q, i) => (
          <li key={q.id}>
            <Card>
              <CardHeader>
                <CardTitle className="font-medium">
                  <span className="mr-2 text-fg-subtle">{i + 1}.</span>
                  <span className="whitespace-pre-line">{q.text}</span>
                </CardTitle>
                <span className="flex shrink-0 items-center gap-1 text-xs text-fg-subtle">
                  {saving[q.id] && <LoaderCircle aria-label="Saving" className="size-3.5 animate-spin" />}
                  {q.marks} mark{q.marks === 1 ? '' : 's'}
                </span>
              </CardHeader>
              <CardContent>
                <fieldset>
                  <legend className="sr-only">Question {i + 1}</legend>
                  <div className="space-y-2">
                    {q.options.map((o) => (
                      <label key={o.id} className={cn('flex cursor-pointer items-start gap-3 rounded-control border px-3 py-2 text-sm transition-colors', answers[q.id] === o.id ? 'border-primary bg-primary-soft text-fg' : 'hover:bg-surface-raised')}>
                        <input type="radio" name={q.id} value={o.id} checked={answers[q.id] === o.id} onChange={() => void choose(q.id, o.id)} className="mt-0.5 accent-[var(--color-primary)]" />
                        <span className="whitespace-pre-line">{o.text}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex justify-end">
        <Button loading={submitting} onClick={() => setConfirming(true)}>Submit answers</Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Submit your answers?"
        description={answered < p.questions.length ? `${p.questions.length - answered} question${p.questions.length - answered === 1 ? ' is' : 's are'} unanswered and will score nothing. You cannot change answers after submitting.` : 'You cannot change answers after submitting.'}
        confirmLabel="Submit"
        loading={submitting}
        onConfirm={() => void submit()}
      />
    </>
  );
}
