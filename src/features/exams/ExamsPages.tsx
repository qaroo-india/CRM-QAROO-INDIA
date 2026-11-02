import { EXAM_KINDS, EXAM_STATUSES, type ExamDetail, type ExamDto, type ExamQuestionDto } from '@ims/shared';
import { Archive, ArrowLeft, CircleCheck, ClipboardCheck, Lock, Pencil, Plus, RotateCcw, Send, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { DataTableView } from '@/components/charts/ChartKit';
import { DataTable, type Column } from '@/components/data/DataTable';
import { Pagination } from '@/components/data/Pagination';
import { FilterSelect, ResetFilters, SearchInput, Toolbar } from '@/components/data/Toolbar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DialogContent, DialogRoot } from '@/components/ui/Dialog';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { SegmentedItem, SegmentedList } from '@/components/ui/Segmented';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Switch } from '@/components/ui/Toggle';
import { useListParams } from '@/hooks/useListParams';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dateTime, humanize, number, percent } from '@/utils/format';
import { useActionParam } from '../shared/hooks';
import { useAction, useExam, useExamResults, useExams, useFieldErrors, useMyBatches, useTeachingCourses } from '../campus/api';
import { splitInstant, toInstant } from '../campus/time';

const bpsText = (bps: number | null) => (bps === null ? '—' : percent(bps / 10_000, 1));

/* ------------------------------------------------------------------ *
 * Exam settings dialog (create and edit)
 * ------------------------------------------------------------------ */

interface SettingsForm {
  title: string;
  kind: string;
  target: 'batch' | 'course';
  batchId: string;
  courseId: string;
  instructions: string;
  durationMinutes: string;
  passPercent: string;
  maxAttempts: string;
  fromDate: string;
  fromTime: string;
  untilDate: string;
  untilTime: string;
  shuffleQuestions: boolean;
}

function ExamSettingsDialog({ open, onOpenChange, exam }: { open: boolean; onOpenChange: (o: boolean) => void; exam: ExamDto | null }) {
  const navigate = useNavigate();
  const { accountType } = useAuth();
  const batches = useMyBatches();
  const courses = useTeachingCourses();
  const fields = useFieldErrors();
  const [form, setForm] = useState<SettingsForm | null>(null);
  const frozen = Boolean(exam && exam.status !== 'draft');

  useEffect(() => {
    if (!open) return;
    fields.clear();
    const from = exam?.availableFrom ? splitInstant(exam.availableFrom) : { date: '', time: '09:00' };
    const until = exam?.availableUntil ? splitInstant(exam.availableUntil) : { date: '', time: '18:00' };
    setForm({
      title: exam?.title ?? '',
      kind: exam?.kind ?? 'unit_test',
      target: exam?.courseId && !exam.batchId ? 'course' : 'batch',
      batchId: exam?.batchId ?? '',
      courseId: exam?.courseId ?? '',
      instructions: exam?.instructions ?? '',
      durationMinutes: String(exam?.durationMinutes ?? 30),
      passPercent: String(exam?.passPercent ?? 40),
      maxAttempts: String(exam?.maxAttempts ?? 1),
      fromDate: from.date,
      fromTime: from.time,
      untilDate: until.date,
      untilTime: until.time,
      shuffleQuestions: exam?.shuffleQuestions ?? true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, exam]);

  const save = useAction(
    (f: SettingsForm) => {
      const body = {
        title: f.title,
        kind: f.kind,
        batchId: f.target === 'batch' ? f.batchId : undefined,
        courseId: f.target === 'course' ? f.courseId : undefined,
        instructions: f.instructions,
        durationMinutes: Number(f.durationMinutes),
        passPercent: Number(f.passPercent),
        maxAttempts: Number(f.maxAttempts),
        availableFrom: f.fromDate ? toInstant(f.fromDate, f.fromTime || '00:00') : undefined,
        availableUntil: f.untilDate ? toInstant(f.untilDate, f.untilTime || '23:59') : undefined,
        shuffleQuestions: f.shuffleQuestions,
      };
      return exam ? api.put<ExamDetail>(`/exams/${exam.id}`, body) : api.post<ExamDetail>('/exams', body);
    },
    {
      invalidate: [['exams']],
      success: exam ? 'Exam updated' : 'Exam created: now add its questions',
      onDone: (r) => {
        onOpenChange(false);
        if (!exam) navigate(`/exams/${r.id}`);
      },
      silentErrors: true,
    },
  );

  if (!form) return null;
  const set = (patch: Partial<SettingsForm>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const myCourseIds = new Set((batches.data?.items ?? []).map((b) => b.courseId));
  const courseOptions = (courses.data ?? []).filter((c) => accountType === 'team' || myCourseIds.has(c.id)).map((c) => ({ value: c.id, label: c.name }));

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={exam ? 'Exam settings' : 'New exam'}
        description={frozen ? 'Published: only the title, instructions and opening times can change.' : 'Questions come next.'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={save.isPending} onClick={() => save.mutate(form, { onError: fields.capture })}>{exam ? 'Save' : 'Create exam'}</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" error={fields.errors.title} required className="sm:col-span-2">
            <Input value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={160} />
          </Field>
          <Field label="Type">
            <Select value={form.kind} disabled={frozen} onChange={(e) => set({ kind: e.target.value })} options={EXAM_KINDS.map((k) => ({ value: k, label: humanize(k) }))} />
          </Field>
          <Field label="For">
            <Select value={form.target} disabled={frozen} onChange={(e) => set({ target: e.target.value as SettingsForm['target'] })} options={[{ value: 'batch', label: 'One batch' }, { value: 'course', label: 'Everyone on a course' }]} />
          </Field>
          {form.target === 'batch' ? (
            <Field label="Batch" error={fields.errors.batchId} required className="sm:col-span-2">
              <Select value={form.batchId} disabled={frozen} onChange={(e) => set({ batchId: e.target.value })} options={(batches.data?.items ?? []).map((b) => ({ value: b.id, label: `${b.batchCode} · ${b.name}` }))} placeholder="Choose a batch" />
            </Field>
          ) : (
            <Field label="Course" error={fields.errors.courseId ?? fields.errors.batchId} required className="sm:col-span-2">
              <Select value={form.courseId} disabled={frozen} onChange={(e) => set({ courseId: e.target.value })} options={courseOptions} placeholder="Choose a course" />
            </Field>
          )}
          <Field label="Time allowed (minutes)" error={fields.errors.durationMinutes}>
            <Input type="number" min={1} max={600} disabled={frozen} value={form.durationMinutes} onChange={(e) => set({ durationMinutes: e.target.value })} />
          </Field>
          <Field label="Pass mark (%)" error={fields.errors.passPercent}>
            <Input type="number" min={0} max={100} disabled={frozen} value={form.passPercent} onChange={(e) => set({ passPercent: e.target.value })} />
          </Field>
          <Field label="Attempts allowed" error={fields.errors.maxAttempts}>
            <Input type="number" min={1} max={20} disabled={frozen} value={form.maxAttempts} onChange={(e) => set({ maxAttempts: e.target.value })} />
          </Field>
          <div className="flex items-end">
            <Switch label="Shuffle question order for each student" checked={form.shuffleQuestions} disabled={frozen} onCheckedChange={(v: boolean) => set({ shuffleQuestions: v })} />
          </div>
          <Field label="Opens (optional)" hint="Blank: as soon as it is published">
            <div className="flex gap-2">
              <Input type="date" value={form.fromDate} onChange={(e) => set({ fromDate: e.target.value })} />
              <Input type="time" aria-label="Opening time" value={form.fromTime} onChange={(e) => set({ fromTime: e.target.value })} />
            </div>
          </Field>
          <Field label="Closes (optional)" error={fields.errors.availableUntil} hint="Blank: until you close it">
            <div className="flex gap-2">
              <Input type="date" value={form.untilDate} onChange={(e) => set({ untilDate: e.target.value })} />
              <Input type="time" aria-label="Closing time" value={form.untilTime} onChange={(e) => set({ untilTime: e.target.value })} />
            </div>
          </Field>
          <Field label="Instructions for students" className="sm:col-span-2">
            <Textarea rows={3} value={form.instructions} onChange={(e) => set({ instructions: e.target.value })} />
          </Field>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

/* ------------------------------------------------------------------ *
 * List
 * ------------------------------------------------------------------ */

export function ExamsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const list = useListParams(['status', 'kind', 'batchId'] as const, { sort: { key: 'createdAt', order: 'desc' } });
  const exams = useExams({ ...list.query, sort: undefined });
  const batches = useMyBatches();
  const [open, setOpen] = useState(false);
  const openNew = useCallback(() => setOpen(true), []);
  useActionParam('new', openNew);

  const columns: Column<ExamDto>[] = [
    { id: 'title', header: 'Exam', hideable: false, cell: (e) => <div><p className="font-medium text-fg">{e.title}</p><p className="text-xs text-fg-subtle">{e.batchCode ?? `All of ${e.courseName}`} · {humanize(e.kind)}</p></div> },
    { id: 'status', header: 'Status', cell: (e) => <StatusBadge status={e.status} /> },
    { id: 'paper', header: 'Paper', cell: (e) => <span className="text-fg-muted">{e.questionCount} Q · {e.totalMarks} marks · {e.durationMinutes} min</span> },
    { id: 'subs', header: 'Submitted', align: 'right', cell: (e) => number(e.submissions) },
    { id: 'avg', header: 'Average', align: 'right', cell: (e) => bpsText(e.averagePercentBps) },
    { id: 'pass', header: 'Pass rate', align: 'right', cell: (e) => percent(e.passRate, 0) },
    { id: 'window', header: 'Closes', cell: (e) => <span className="text-fg-muted">{e.availableUntil ? dateTime(e.availableUntil) : '—'}</span> },
  ];

  return (
    <>
      <PageHeader title="Exams" description="Multiple-choice tests graded on the server. Students never receive the answers." actions={can('exams:write') && <Button onClick={openNew}><Plus aria-hidden className="size-4" /> New exam</Button>} />
      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Exam title" />
        <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={EXAM_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
        <FilterSelect label="Type" value={list.filters.kind} onChange={(v) => list.setFilter('kind', v)} options={EXAM_KINDS.map((s) => ({ value: s, label: humanize(s) }))} />
        <FilterSelect label="Batch" value={list.filters.batchId} onChange={(v) => list.setFilter('batchId', v)} options={(batches.data?.items ?? []).map((b) => ({ value: b.id, label: b.batchCode }))} />
        <ResetFilters onReset={list.reset} disabled={!list.isFiltered} />
      </Toolbar>
      <DataTable caption="Exams" columns={columns} rows={exams.data?.items} rowKey={(e) => e.id} loading={exams.isPending} fetching={exams.isFetching} error={exams.error} onRowClick={(e) => navigate(`/exams/${e.id}`)} empty={<EmptyState icon={ClipboardCheck} title="No exams yet" description={can('exams:write') ? 'Create one, add its questions, then publish it to the students.' : undefined} />} />
      {exams.data && <Pagination page={exams.data.page} totalPages={exams.data.totalPages} total={exams.data.total} limit={exams.data.limit} onPageChange={list.setPage} onLimitChange={list.setLimit} />}
      <ExamSettingsDialog open={open} onOpenChange={setOpen} exam={null} />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Question editor
 * ------------------------------------------------------------------ */

function QuestionEditor({ examId, question, onDone }: { examId: string; question: ExamQuestionDto | null; onDone: () => void }) {
  const [text, setText] = useState(question?.text ?? '');
  const [marks, setMarks] = useState(String(question?.marks ?? 1));
  const [options, setOptions] = useState<{ text: string; isCorrect: boolean }[]>(question?.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect })) ?? [{ text: '', isCorrect: true }, { text: '', isCorrect: false }]);
  const fields = useFieldErrors();
  const save = useAction(() => (question ? api.put(`/exams/questions/${question.id}`, { text, marks: Number(marks), options }) : api.post(`/exams/${examId}/questions`, { text, marks: Number(marks), options })), {
    invalidate: [['exams']],
    success: question ? 'Question updated' : 'Question added',
    onDone,
    silentErrors: true,
  });
  return (
    <div className="space-y-3 rounded-card border border-primary/30 bg-primary-soft/30 p-4">
      <Field label="Question" error={fields.errors.text} required>
        <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Field label="Options (choose the correct one)" error={fields.errors.options}>
        <ul className="space-y-2">
          {options.map((o, i) => (
            <li key={i} className="flex items-center gap-2">
              <input type="radio" name={`correct-${question?.id ?? 'new'}`} aria-label={`Option ${i + 1} is correct`} checked={o.isCorrect} onChange={() => setOptions((list) => list.map((x, j) => ({ ...x, isCorrect: j === i })))} className="size-4 accent-[var(--color-primary)]" />
              <Input aria-label={`Option ${i + 1}`} value={o.text} onChange={(e) => setOptions((list) => list.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} placeholder={`Option ${i + 1}`} maxLength={500} />
              <Button variant="ghost" size="icon" aria-label={`Remove option ${i + 1}`} disabled={options.length <= 2} onClick={() => setOptions((list) => list.filter((_, j) => j !== i).map((x, j, arr) => (arr.some((y) => y.isCorrect) ? x : { ...x, isCorrect: j === 0 })))}><X aria-hidden className="size-4" /></Button>
            </li>
          ))}
        </ul>
      </Field>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-end gap-2">
          <Button variant="secondary" size="sm" disabled={options.length >= 8} onClick={() => setOptions((list) => [...list, { text: '', isCorrect: false }])}><Plus aria-hidden className="size-4" /> Option</Button>
          <Field label="Marks">
            <Input type="number" min={1} max={100} className="h-8 w-20" value={marks} onChange={(e) => setMarks(e.target.value)} />
          </Field>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onDone}>Cancel</Button>
          <Button size="sm" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: fields.capture })}>{question ? 'Save question' : 'Add question'}</Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Detail
 * ------------------------------------------------------------------ */

export function ExamDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const exam = useExam(id);
  const [tab, setTab] = useState<'questions' | 'results'>('questions');
  const results = useExamResults(id, tab === 'results');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [removing, setRemoving] = useState<ExamQuestionDto | null>(null);
  const canWrite = can('exams:write');

  const status = useAction((s: string) => api.post(`/exams/${id}/status`, { status: s }), { invalidate: [['exams']], success: (r) => `Exam ${(r as ExamDetail).status}` });
  const remove = useAction((qid: string) => api.delete(`/exams/questions/${qid}`), { invalidate: [['exams']], success: 'Question removed', onDone: () => setRemoving(null) });

  if (exam.isPending) return <LoadingBlock />;
  if (exam.isError) return <ErrorState error={exam.error} onRetry={() => void exam.refetch()} />;
  const e = exam.data;
  const draft = e.status === 'draft';

  return (
    <>
      <PageHeader
        title={e.title}
        description={`${e.batchCode ?? `Everyone on ${e.courseName}`} · ${humanize(e.kind)} · ${e.durationMinutes} minutes · pass ${e.passPercent}% · ${e.maxAttempts} attempt(s)`}
        breadcrumbs={[{ label: 'Exams', to: '/exams' }, { label: e.title }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/exams" className="inline-flex h-9 items-center gap-1 rounded-control px-3 text-sm text-fg-muted hover:text-fg"><ArrowLeft aria-hidden className="size-4" /> All exams</Link>
            {canWrite && <Button variant="secondary" onClick={() => setSettingsOpen(true)}><Pencil aria-hidden className="size-4" /> Settings</Button>}
            {canWrite && draft && <Button loading={status.isPending} onClick={() => status.mutate('published')}><Send aria-hidden className="size-4" /> Publish</Button>}
            {canWrite && e.status === 'published' && <Button variant="secondary" loading={status.isPending} onClick={() => status.mutate('closed')}><Lock aria-hidden className="size-4" /> Close</Button>}
            {canWrite && e.status === 'closed' && <Button variant="secondary" loading={status.isPending} onClick={() => status.mutate('published')}><RotateCcw aria-hidden className="size-4" /> Reopen</Button>}
            {canWrite && e.status !== 'archived' && !draft && <Button variant="ghost" loading={status.isPending} onClick={() => status.mutate('archived')}><Archive aria-hidden className="size-4" /> Archive</Button>}
            {canWrite && e.status === 'published' && e.submissions === 0 && <Button variant="ghost" loading={status.isPending} onClick={() => status.mutate('draft')}>Back to draft</Button>}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge status={e.status} />
        <Badge>{e.questionCount} questions · {e.totalMarks} marks</Badge>
        {e.availableFrom && <Badge>Opens {dateTime(e.availableFrom)}</Badge>}
        {e.availableUntil && <Badge>Closes {dateTime(e.availableUntil)}</Badge>}
        {e.submissions > 0 && <Badge tone="primary">{e.submissions} submitted · average {bpsText(e.averagePercentBps)} · pass rate {percent(e.passRate, 0)}</Badge>}
      </div>

      <SegmentedList label="Exam views" className="mb-4 inline-flex gap-1 rounded-control border bg-surface p-1">
        {(['questions', 'results'] as const).map((t) => (
          <SegmentedItem key={t} selected={tab === t} onClick={() => setTab(t)}>{humanize(t)}</SegmentedItem>
        ))}
      </SegmentedList>

      {tab === 'questions' ? (
        <div className="space-y-3">
          {!draft && <p className="text-sm text-fg-muted">The paper is frozen while published, so results stay fair. {e.submissions === 0 && canWrite ? 'Move it back to draft to edit questions.' : ''}</p>}
          {e.questions.length === 0 && editing !== 'new' && <EmptyState icon={ClipboardCheck} title="No questions yet" description="Add multiple-choice questions, each with exactly one correct option." />}
          {e.questions.map((q, i) =>
            editing === q.id ? (
              <QuestionEditor key={q.id} examId={e.id} question={q} onDone={() => setEditing(null)} />
            ) : (
              <Card key={q.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-fg"><span className="mr-2 text-fg-subtle">Q{i + 1}.</span>{q.text}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge>{q.marks} mark{q.marks === 1 ? '' : 's'}</Badge>
                    {canWrite && draft && (
                      <>
                        <Button variant="ghost" size="icon" aria-label={`Edit question ${i + 1}`} onClick={() => setEditing(q.id)}><Pencil aria-hidden className="size-4" /></Button>
                        <Button variant="ghost" size="icon" aria-label={`Remove question ${i + 1}`} onClick={() => setRemoving(q)}><Trash2 aria-hidden className="size-4" /></Button>
                      </>
                    )}
                  </div>
                </div>
                <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {q.options.map((o) => (
                    <li key={o.id} className={cn('flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm', o.isCorrect ? 'border-success/40 bg-success-soft text-fg' : 'text-fg-muted')}>
                      {o.isCorrect ? <CircleCheck aria-label="Correct answer" className="size-4 text-success" /> : <span aria-hidden className="size-4" />}
                      {o.text}
                    </li>
                  ))}
                </ul>
              </Card>
            ),
          )}
          {canWrite && draft && (editing === 'new' ? <QuestionEditor examId={e.id} question={null} onDone={() => setEditing(null)} /> : <Button variant="secondary" onClick={() => setEditing('new')}><Plus aria-hidden className="size-4" /> Add a question</Button>)}
        </div>
      ) : results.isPending ? (
        <LoadingBlock />
      ) : (results.data ?? []).length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="No attempts yet" />
      ) : (
        <Card className="overflow-x-auto p-3">
          <DataTableView
            rows={results.data ?? []}
            columns={[
              { key: 's', label: 'Student', render: (r) => <span>{r.studentName} <span className="text-xs text-fg-subtle">{r.studentCode}</span></span> },
              { key: 'n', label: 'Attempt', align: 'right', render: (r) => r.attemptNumber },
              { key: 'st', label: 'Started', render: (r) => dateTime(r.startedAt) },
              { key: 'sc', label: 'Score', align: 'right', render: (r) => (r.score === null ? 'In progress' : `${r.score}/${r.totalMarks}`) },
              { key: 'p', label: '%', align: 'right', render: (r) => bpsText(r.percentBps) },
              { key: 'r', label: 'Result', render: (r) => (r.passed === null ? '—' : <StatusBadge status={r.passed ? 'passed' : 'failed'} />) },
              { key: 'a', label: '', render: (r) => (r.autoSubmitted ? <Badge tone="warning">Time ran out</Badge> : null) },
            ]}
          />
        </Card>
      )}

      <ExamSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} exam={e} />
      <ConfirmDialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)} title="Remove this question?" description={removing?.text} confirmLabel="Remove" tone="danger" loading={remove.isPending} onConfirm={() => removing && remove.mutate(removing.id)} />
    </>
  );
}
