/**
 * Exams with server-side grading.
 *
 * - Correct answers never leave the server for students; the paper carries
 *   question and option text only.
 * - A student sends only "question -> chosen option". Scores are computed
 *   here, never accepted from a client.
 * - An option that belongs to a different question is tampering and is
 *   refused outright.
 * - Every attempt has a deadline (start + duration, capped by the exam's
 *   closing time). Answers after it are refused; an expired attempt is
 *   graded automatically with what was saved in time.
 * - Questions are frozen once the exam is published, and total marks with
 *   them, so a later edit can never change a past result.
 */

import { randomInt } from 'node:crypto';
import {
  examAnswerSchema,
  examQuestionSchema,
  examSchema,
  examStatusSchema,
  type AttemptResult,
  type ExamDetail,
  type ExamDto,
  type ExamPaper,
  type ExamResultRow,
  type PortalExam,
  type examListQuerySchema,
} from '@ims/shared';
import { and, asc, count, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { db } from '../../db';
import { qualified } from '../../db/dialect';
import { batches, courses, examAnswers, examAttempts, examOptions, examQuestions, exams, students, users, type Exam, type ExamAttempt } from '../../db/schema';
import { recordAudit } from '../../services/audit';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { containsText, pageWindow, paginated } from '../../utils/pagination';
import { facultyBatchIds } from '../../utils/scope';
import { notifyUsers, safely } from '../notifications/notifications.service';

/** Network slack for a submission sent right at the deadline. */
const GRACE_MS = 30_000;

/* ------------------------------------------------------------------ *
 * Staff: listing and scope
 * ------------------------------------------------------------------ */

const E_ID = qualified('exams', 'id');
const examStats = {
  questionCount: sql<number>`(select count(*) from exam_questions q where q.exam_id = ${E_ID} and q.is_active = 1)`.mapWith(Number),
  submissions: sql<number>`(select count(*) from exam_attempts a where a.exam_id = ${E_ID} and a.submitted_at is not null)`.mapWith(Number),
  averageBps: sql<number | null>`(select avg(a.percent_bps) from exam_attempts a where a.exam_id = ${E_ID} and a.submitted_at is not null)`,
  passes: sql<number>`(select count(*) from exam_attempts a where a.exam_id = ${E_ID} and a.passed = 1)`.mapWith(Number),
};

function examQuery() {
  return db
    .select({ e: exams, batchCode: batches.batchCode, courseName: sql<string>`coalesce(${courses.name}, (select c2.name from courses c2 where c2.id = ${batches.courseId}))`, authorName: users.name, ...examStats })
    .from(exams)
    .leftJoin(batches, eq(batches.id, exams.batchId))
    .leftJoin(courses, eq(courses.id, exams.courseId))
    .leftJoin(users, eq(users.id, exams.authorId));
}

type ExamRow = Awaited<ReturnType<ReturnType<typeof examQuery>['all']>>[number];

function toExamDto(r: ExamRow): ExamDto {
  const e = r.e;
  const live = e.status === 'draft' ? null : e.totalMarks;
  return {
    id: e.id,
    title: e.title,
    kind: e.kind,
    status: e.status,
    batchId: e.batchId,
    batchCode: r.batchCode,
    courseId: e.courseId,
    courseName: r.courseName ?? '',
    authorName: r.authorName,
    instructions: e.instructions,
    durationMinutes: e.durationMinutes,
    passPercent: e.passPercent,
    maxAttempts: e.maxAttempts,
    availableFrom: e.availableFrom?.toISOString() ?? null,
    availableUntil: e.availableUntil?.toISOString() ?? null,
    shuffleQuestions: e.shuffleQuestions,
    totalMarks: live ?? draftMarks(e.id),
    questionCount: r.questionCount,
    publishedAt: e.publishedAt?.toISOString() ?? null,
    submissions: r.submissions,
    averagePercentBps: r.averageBps === null ? null : Math.round(Number(r.averageBps)),
    passRate: r.submissions > 0 ? r.passes / r.submissions : null,
    createdAt: e.createdAt.toISOString(),
  };
}

function draftMarks(examId: string): number {
  return Number(db.get<{ n: number }>(sql`select coalesce(sum(marks), 0) as n from exam_questions where exam_id = ${examId} and is_active = 1`)?.n ?? 0);
}

/** Faculty: exams for their batches, plus course-wide exams of the courses they teach. */
function examScope(ctx: RequestContext): SQL | undefined {
  const ids = facultyBatchIds(ctx);
  if (ids === null) return undefined;
  if (ids.length === 0) return sql`0`;
  const courseIds = db.select({ courseId: batches.courseId }).from(batches).where(inArray(batches.id, ids)).all().map((b) => b.courseId);
  return or(inArray(exams.batchId, ids), inArray(exams.courseId, courseIds));
}

function examForStaff(ctx: RequestContext, id: string, forWrite = false): Exam {
  const exam = db.select().from(exams).where(and(eq(exams.id, id), examScope(ctx))).get();
  if (!exam) throw ApiError.notFound('Exam');
  // Faculty may change only their batch exams, or course-wide exams they wrote.
  if (forWrite && ctx.accountType === 'faculty' && !exam.batchId && exam.authorId !== ctx.actorId) throw ApiError.forbidden('Only the author can change a course-wide exam.');
  return exam;
}

export function listExams(ctx: RequestContext, q: z.output<typeof examListQuerySchema>) {
  const conditions: (SQL | undefined)[] = [examScope(ctx)];
  if (q.q) conditions.push(containsText(exams.title, q.q));
  if (q.batchId) conditions.push(eq(exams.batchId, q.batchId));
  if (q.courseId) conditions.push(or(eq(exams.courseId, q.courseId), eq(batches.courseId, q.courseId)));
  if (q.kind) conditions.push(eq(exams.kind, q.kind));
  if (q.status?.length) conditions.push(inArray(exams.status, q.status));
  const where = and(...conditions);
  const total = db.select({ n: count() }).from(exams).leftJoin(batches, eq(batches.id, exams.batchId)).where(where).get()?.n ?? 0;
  const { limit, offset } = pageWindow(q.page, q.limit);
  const rows = examQuery().where(where).orderBy(desc(exams.createdAt)).limit(limit).offset(offset).all();
  return paginated(rows.map(toExamDto), total, q.page, q.limit);
}

export function getExam(ctx: RequestContext, id: string): ExamDetail {
  examForStaff(ctx, id);
  const row = examQuery().where(eq(exams.id, id)).get()!;
  const questions = db.select().from(examQuestions).where(eq(examQuestions.examId, id)).orderBy(asc(examQuestions.position), asc(examQuestions.createdAt)).all();
  const options = questions.length ? db.select().from(examOptions).where(inArray(examOptions.questionId, questions.map((q) => q.id))).orderBy(asc(examOptions.position)).all() : [];
  return {
    ...toExamDto(row),
    questions: questions.map((q) => ({
      id: q.id,
      position: q.position,
      text: q.text,
      marks: q.marks,
      isActive: q.isActive,
      options: options.filter((o) => o.questionId === q.id).map((o) => ({ id: o.id, position: o.position, text: o.text, isCorrect: o.isCorrect })),
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Staff: authoring
 * ------------------------------------------------------------------ */

function assertTarget(ctx: RequestContext, batchId: string | undefined, courseId: string | undefined): void {
  if (batchId) {
    if (!db.select({ id: batches.id }).from(batches).where(eq(batches.id, batchId)).get()) throw ApiError.validation([{ path: 'batchId', message: 'Choose a valid batch' }]);
    const ids = facultyBatchIds(ctx);
    if (ids && !ids.includes(batchId)) throw ApiError.forbidden('You can only set exams for your own batches.');
  }
  if (courseId) {
    if (!db.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId)).get()) throw ApiError.validation([{ path: 'courseId', message: 'Choose a valid course' }]);
    const ids = facultyBatchIds(ctx);
    if (ids && !db.select({ id: batches.id }).from(batches).where(and(eq(batches.courseId, courseId), inArray(batches.id, ids.length ? ids : ['-']))).get()) {
      throw ApiError.forbidden('You can only set exams for courses you teach.');
    }
  }
}

export function createExam(ctx: RequestContext, raw: unknown): ExamDetail {
  const input = examSchema.parse(raw);
  assertTarget(ctx, input.batchId, input.courseId);
  const id = db.transaction((tx) => {
    const row = tx
      .insert(exams)
      .values({
        title: input.title,
        kind: input.kind,
        batchId: input.batchId ?? null,
        courseId: input.courseId ?? null,
        authorId: ctx.actorId || null,
        instructions: input.instructions ?? null,
        durationMinutes: input.durationMinutes,
        passPercent: input.passPercent,
        maxAttempts: input.maxAttempts,
        availableFrom: input.availableFrom ? new Date(input.availableFrom) : null,
        availableUntil: input.availableUntil ? new Date(input.availableUntil) : null,
        shuffleQuestions: input.shuffleQuestions,
      })
      .returning()
      .get();
    recordAudit(tx, ctx, { action: 'create', entityType: 'exam', entityId: row.id, summary: `Created exam "${row.title}"` });
    return row.id;
  });
  return getExam(ctx, id);
}

function attemptsExist(examId: string): boolean {
  return Boolean(db.select({ id: examAttempts.id }).from(examAttempts).where(eq(examAttempts.examId, examId)).get());
}

export function updateExam(ctx: RequestContext, id: string, raw: unknown): ExamDetail {
  const exam = examForStaff(ctx, id, true);
  const input = examSchema.parse(raw);
  if (exam.status !== 'draft') {
    // Once published only the window and instructions may move: the paper itself is frozen.
    const frozen: (keyof typeof input)[] = ['kind', 'batchId', 'courseId', 'durationMinutes', 'passPercent', 'maxAttempts', 'shuffleQuestions'];
    const before: Record<string, unknown> = { kind: exam.kind, batchId: exam.batchId ?? undefined, courseId: exam.courseId ?? undefined, durationMinutes: exam.durationMinutes, passPercent: exam.passPercent, maxAttempts: exam.maxAttempts, shuffleQuestions: exam.shuffleQuestions };
    if (frozen.some((k) => (input[k] ?? undefined) !== before[k])) throw ApiError.conflict('A published exam can only change its title, instructions and opening times. Move it back to draft (if nobody has attempted it) to change the rest.', 'EXAM_FROZEN');
  }
  assertTarget(ctx, input.batchId, input.courseId);
  db.transaction((tx) => {
    tx.update(exams)
      .set({
        title: input.title,
        kind: input.kind,
        batchId: input.batchId ?? null,
        courseId: input.courseId ?? null,
        instructions: input.instructions ?? null,
        durationMinutes: input.durationMinutes,
        passPercent: input.passPercent,
        maxAttempts: input.maxAttempts,
        availableFrom: input.availableFrom ? new Date(input.availableFrom) : null,
        availableUntil: input.availableUntil ? new Date(input.availableUntil) : null,
        shuffleQuestions: input.shuffleQuestions,
      })
      .where(eq(exams.id, id))
      .run();
    recordAudit(tx, ctx, { action: 'update', entityType: 'exam', entityId: id, summary: `Updated exam "${input.title}"` });
  });
  return getExam(ctx, id);
}

function assertDraft(exam: Exam): void {
  if (exam.status !== 'draft') throw ApiError.conflict('Questions can only be changed while the exam is a draft.', 'EXAM_FROZEN');
}

export function addQuestion(ctx: RequestContext, examId: string, raw: unknown): ExamDetail {
  const exam = examForStaff(ctx, examId, true);
  assertDraft(exam);
  const input = examQuestionSchema.parse(raw);
  const position = Number(db.get<{ n: number }>(sql`select coalesce(max(position), 0) + 1 as n from exam_questions where exam_id = ${examId}`)?.n ?? 1);
  db.transaction((tx) => {
    const q = tx.insert(examQuestions).values({ examId, position, text: input.text, marks: input.marks }).returning().get();
    input.options.forEach((o, i) => tx.insert(examOptions).values({ questionId: q.id, position: i + 1, text: o.text, isCorrect: o.isCorrect }).run());
  });
  return getExam(ctx, examId);
}

function questionForStaff(ctx: RequestContext, questionId: string) {
  const q = db.select().from(examQuestions).where(eq(examQuestions.id, questionId)).get();
  if (!q) throw ApiError.notFound('Question');
  const exam = examForStaff(ctx, q.examId, true);
  assertDraft(exam);
  return q;
}

export function updateQuestion(ctx: RequestContext, questionId: string, raw: unknown): ExamDetail {
  const q = questionForStaff(ctx, questionId);
  const input = examQuestionSchema.parse(raw);
  db.transaction((tx) => {
    tx.update(examQuestions).set({ text: input.text, marks: input.marks }).where(eq(examQuestions.id, q.id)).run();
    // A draft has no attempts, so its options can be replaced outright.
    tx.delete(examOptions).where(eq(examOptions.questionId, q.id)).run();
    input.options.forEach((o, i) => tx.insert(examOptions).values({ questionId: q.id, position: i + 1, text: o.text, isCorrect: o.isCorrect }).run());
  });
  return getExam(ctx, q.examId);
}

export function removeQuestion(ctx: RequestContext, questionId: string): ExamDetail {
  const q = questionForStaff(ctx, questionId);
  db.transaction((tx) => {
    tx.delete(examOptions).where(eq(examOptions.questionId, q.id)).run();
    tx.delete(examQuestions).where(eq(examQuestions.id, q.id)).run();
  });
  return getExam(ctx, q.examId);
}

/** Students (with a portal login) an exam is for. */
function examAudience(exam: Pick<Exam, 'batchId' | 'courseId'>): string[] {
  const who = exam.batchId
    ? sql`${students.id} in (select ba.student_id from batch_assignments ba where ba.batch_id = ${exam.batchId} and ba.status = 'active')`
    : sql`${students.id} in (select a.student_id from admissions a where a.course_id = ${exam.courseId} and a.status in ('pending_payment', 'active'))`;
  return db
    .select({ userId: students.userId })
    .from(students)
    .innerJoin(users, eq(users.id, students.userId))
    .where(and(eq(users.isActive, true), who))
    .all()
    .map((r) => r.userId!)
    .filter(Boolean);
}

export function setExamStatus(ctx: RequestContext, id: string, raw: unknown): ExamDetail {
  const exam = examForStaff(ctx, id, true);
  const { status } = examStatusSchema.parse(raw);
  if (status === exam.status) return getExam(ctx, id);

  let totalMarks = exam.totalMarks;
  if (status === 'published') {
    if (exam.status === 'archived') throw ApiError.conflict('An archived exam cannot be reopened.', 'INVALID_TRANSITION');
    const detail = getExam(ctx, id);
    const active = detail.questions.filter((q) => q.isActive);
    if (active.length === 0) throw ApiError.unprocessable('Add at least one question before publishing.', 'NO_QUESTIONS');
    const broken = active.find((q) => q.options.length < 2 || q.options.filter((o) => o.isCorrect).length !== 1);
    if (broken) throw ApiError.unprocessable(`Question ${broken.position} needs at least two options and exactly one correct answer.`, 'INVALID_QUESTION');
    if (exam.availableUntil && exam.availableUntil.getTime() <= Date.now()) throw ApiError.unprocessable('The closing time has already passed. Move it later before publishing.', 'WINDOW_PASSED');
    totalMarks = active.reduce((s, q) => s + q.marks, 0);
  }
  if (status === 'draft' && attemptsExist(id)) throw ApiError.conflict('Students have already attempted this exam, so it cannot go back to draft. Close it instead.', 'HAS_ATTEMPTS');

  db.transaction((tx) => {
    tx.update(exams)
      .set({ status, totalMarks, ...(status === 'published' && !exam.publishedAt && { publishedAt: new Date() }) })
      .where(eq(exams.id, id))
      .run();
    recordAudit(tx, ctx, { action: 'status_change', entityType: 'exam', entityId: id, summary: `Exam "${exam.title}": ${exam.status} → ${status}`, before: { status: exam.status }, after: { status, totalMarks } });
  });
  if (status === 'published' && exam.status === 'draft') {
    safely('exam_published', () => {
      notifyUsers(examAudience(exam), { type: 'exam_published', title: `New exam: ${exam.title}`, body: `${exam.durationMinutes} minutes · ${totalMarks} marks`, link: '/portal/exams', entityType: 'exam', entityId: id, dedupeKey: `exam_published:${id}` });
    });
  }
  return getExam(ctx, id);
}

export function examResults(ctx: RequestContext, id: string): ExamResultRow[] {
  examForStaff(ctx, id);
  finalizeExpired({ examId: id });
  return db
    .select({ a: examAttempts, studentName: students.fullName, studentCode: students.studentCode })
    .from(examAttempts)
    .innerJoin(students, eq(students.id, examAttempts.studentId))
    .where(eq(examAttempts.examId, id))
    .orderBy(asc(students.fullName), asc(examAttempts.attemptNumber))
    .all()
    .map(({ a, studentName, studentCode }) => ({
      attemptId: a.id,
      studentId: a.studentId,
      studentName,
      studentCode,
      attemptNumber: a.attemptNumber,
      startedAt: a.startedAt.toISOString(),
      submittedAt: a.submittedAt?.toISOString() ?? null,
      score: a.score,
      totalMarks: a.totalMarks,
      percentBps: a.percentBps,
      passed: a.passed,
      autoSubmitted: a.autoSubmitted,
    }));
}

/* ------------------------------------------------------------------ *
 * Students
 * ------------------------------------------------------------------ */

function studentCanSee(studentId: string): SQL {
  return or(
    sql`${exams.batchId} in (select ba.batch_id from batch_assignments ba where ba.student_id = ${studentId})`,
    sql`${exams.courseId} in (select a.course_id from admissions a where a.student_id = ${studentId} and a.status <> 'cancelled')`,
  )!;
}

function isOpen(exam: Exam, now = Date.now()): string | null {
  if (exam.status !== 'published') return exam.status === 'closed' ? 'This exam is closed.' : 'This exam is not open.';
  if (exam.availableFrom && now < exam.availableFrom.getTime()) return 'This exam has not opened yet.';
  if (exam.availableUntil && now > exam.availableUntil.getTime()) return 'This exam has closed.';
  return null;
}

/** Grade every submitted-late or expired attempt that is still open. */
export function finalizeExpired(filter: { examId?: string; studentId?: string }): void {
  const cutoff = Date.now() - GRACE_MS;
  const open = db
    .select()
    .from(examAttempts)
    .where(and(isNull(examAttempts.submittedAt), sql`${examAttempts.deadlineAt} < ${cutoff}`, filter.examId ? eq(examAttempts.examId, filter.examId) : undefined, filter.studentId ? eq(examAttempts.studentId, filter.studentId) : undefined))
    .all();
  for (const attempt of open) grade(attempt, true);
}

export function portalExams(studentId: string): PortalExam[] {
  finalizeExpired({ studentId });
  const rows = examQuery().where(and(inArray(exams.status, ['published', 'closed']), studentCanSee(studentId))).orderBy(desc(exams.publishedAt)).all();
  if (rows.length === 0) return [];
  const attempts = db.select().from(examAttempts).where(and(eq(examAttempts.studentId, studentId), inArray(examAttempts.examId, rows.map((r) => r.e.id)))).all();
  return rows.map((r) => {
    const e = r.e;
    const mine = attempts.filter((a) => a.examId === e.id);
    const done = mine.filter((a) => a.submittedAt);
    const inProgress = mine.find((a) => !a.submittedAt) ?? null;
    const best = done.reduce<number | null>((m, a) => (a.percentBps !== null && (m === null || a.percentBps > m) ? a.percentBps : m), null);
    let blockedReason = isOpen(e);
    if (!blockedReason && !inProgress && mine.length >= e.maxAttempts) blockedReason = `You have used all ${e.maxAttempts} attempt(s).`;
    return {
      id: e.id,
      title: e.title,
      kind: e.kind,
      courseName: r.courseName ?? '',
      instructions: e.instructions,
      durationMinutes: e.durationMinutes,
      totalMarks: e.totalMarks,
      questionCount: r.questionCount,
      passPercent: e.passPercent,
      availableFrom: e.availableFrom?.toISOString() ?? null,
      availableUntil: e.availableUntil?.toISOString() ?? null,
      maxAttempts: e.maxAttempts,
      attemptsUsed: mine.length,
      inProgressAttemptId: inProgress?.id ?? null,
      bestPercentBps: best,
      passed: done.length ? done.some((a) => a.passed) : null,
      blockedReason,
    };
  });
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function startAttempt(studentId: string, examId: string): ExamPaper {
  finalizeExpired({ studentId, examId });
  const exam = db.select().from(exams).where(and(eq(exams.id, examId), studentCanSee(studentId))).get();
  if (!exam) throw ApiError.notFound('Exam');
  const open = db.select().from(examAttempts).where(and(eq(examAttempts.examId, examId), eq(examAttempts.studentId, studentId), isNull(examAttempts.submittedAt))).get();
  if (open) return getPaper(studentId, open.id);
  const closed = isOpen(exam);
  if (closed) throw ApiError.unprocessable(closed, 'EXAM_NOT_OPEN');
  const used = db.select({ n: count() }).from(examAttempts).where(and(eq(examAttempts.examId, examId), eq(examAttempts.studentId, studentId))).get()?.n ?? 0;
  if (used >= exam.maxAttempts) throw ApiError.unprocessable(`You have used all ${exam.maxAttempts} attempt(s).`, 'NO_ATTEMPTS_LEFT');

  const questionIds = db.select({ id: examQuestions.id }).from(examQuestions).where(and(eq(examQuestions.examId, examId), eq(examQuestions.isActive, true))).orderBy(asc(examQuestions.position)).all().map((q) => q.id);
  const now = new Date();
  const byDuration = now.getTime() + exam.durationMinutes * 60_000;
  const deadline = new Date(exam.availableUntil ? Math.min(byDuration, exam.availableUntil.getTime()) : byDuration);
  const attempt = db
    .insert(examAttempts)
    .values({ examId, studentId, attemptNumber: used + 1, questionOrder: exam.shuffleQuestions ? shuffled(questionIds) : questionIds, startedAt: now, deadlineAt: deadline })
    .returning()
    .get();
  return getPaper(studentId, attempt.id);
}

function attemptFor(studentId: string, attemptId: string): ExamAttempt {
  const attempt = db.select().from(examAttempts).where(and(eq(examAttempts.id, attemptId), eq(examAttempts.studentId, studentId))).get();
  if (!attempt) throw ApiError.notFound('Attempt');
  return attempt;
}

export function getPaper(studentId: string, attemptId: string): ExamPaper {
  const attempt = attemptFor(studentId, attemptId);
  if (attempt.submittedAt) throw ApiError.conflict('This attempt has been submitted.', 'ALREADY_SUBMITTED');
  if (attempt.deadlineAt.getTime() + GRACE_MS < Date.now()) {
    grade(attempt, true);
    throw ApiError.conflict('Time is up: your saved answers were submitted.', 'TIME_UP');
  }
  const exam = db.select().from(exams).where(eq(exams.id, attempt.examId)).get()!;
  const questions = attempt.questionOrder.length ? db.select().from(examQuestions).where(inArray(examQuestions.id, attempt.questionOrder)).all() : [];
  const options = questions.length ? db.select({ id: examOptions.id, questionId: examOptions.questionId, text: examOptions.text, position: examOptions.position }).from(examOptions).where(inArray(examOptions.questionId, questions.map((q) => q.id))).orderBy(asc(examOptions.position)).all() : [];
  const answers = db.select().from(examAnswers).where(eq(examAnswers.attemptId, attempt.id)).all();
  return {
    attemptId: attempt.id,
    examId: exam.id,
    examTitle: exam.title,
    instructions: exam.instructions,
    deadlineAt: attempt.deadlineAt.toISOString(),
    totalMarks: exam.totalMarks,
    questions: attempt.questionOrder
      .map((qid) => questions.find((q) => q.id === qid))
      .filter((q): q is NonNullable<typeof q> => Boolean(q))
      .map((q) => ({ id: q.id, text: q.text, marks: q.marks, options: options.filter((o) => o.questionId === q.id).map((o) => ({ id: o.id, text: o.text })) })),
    answers: Object.fromEntries(answers.filter((a) => a.optionId).map((a) => [a.questionId, a.optionId!])),
  };
}

export function saveAnswer(studentId: string, attemptId: string, raw: unknown): { saved: true } {
  const attempt = attemptFor(studentId, attemptId);
  if (attempt.submittedAt) throw ApiError.conflict('This attempt has been submitted.', 'ALREADY_SUBMITTED');
  if (attempt.deadlineAt.getTime() + GRACE_MS < Date.now()) {
    grade(attempt, true);
    throw ApiError.conflict('Time is up: your saved answers were submitted.', 'TIME_UP');
  }
  const input = examAnswerSchema.parse(raw);
  if (!attempt.questionOrder.includes(input.questionId)) throw ApiError.validation([{ path: 'questionId', message: 'That question is not part of this paper' }]);
  if (input.optionId) {
    const option = db.select({ questionId: examOptions.questionId }).from(examOptions).where(eq(examOptions.id, input.optionId)).get();
    if (!option || option.questionId !== input.questionId) throw ApiError.unprocessable('That answer does not belong to the question.', 'INVALID_OPTION');
  }
  db.insert(examAnswers)
    .values({ attemptId, questionId: input.questionId, optionId: input.optionId, answeredAt: new Date() })
    .onConflictDoUpdate({ target: [examAnswers.attemptId, examAnswers.questionId], set: { optionId: input.optionId, answeredAt: new Date() } })
    .run();
  return { saved: true };
}

/** Score an attempt from the saved answers. The only place scores are written. */
function grade(attempt: ExamAttempt, auto: boolean): void {
  const exam = db.select().from(exams).where(eq(exams.id, attempt.examId)).get()!;
  const questions = attempt.questionOrder.length ? db.select().from(examQuestions).where(inArray(examQuestions.id, attempt.questionOrder)).all() : [];
  const correct = new Map(
    questions.length ? db.select({ questionId: examOptions.questionId, id: examOptions.id }).from(examOptions).where(and(inArray(examOptions.questionId, questions.map((q) => q.id)), eq(examOptions.isCorrect, true))).all().map((o) => [o.questionId, o.id]) : [],
  );
  const answers = db.select().from(examAnswers).where(eq(examAnswers.attemptId, attempt.id)).all();
  const total = questions.reduce((s, q) => s + q.marks, 0);
  db.transaction((tx) => {
    let score = 0;
    for (const a of answers) {
      const q = questions.find((x) => x.id === a.questionId);
      const right = Boolean(q && a.optionId && correct.get(q.id) === a.optionId);
      const marks = right ? q!.marks : 0;
      score += marks;
      tx.update(examAnswers).set({ isCorrect: right, marksAwarded: marks }).where(eq(examAnswers.id, a.id)).run();
    }
    const percentBps = total > 0 ? Math.round((score * 10_000) / total) : 0;
    const updated = tx
      .update(examAttempts)
      .set({ submittedAt: new Date(), autoSubmitted: auto, score, totalMarks: total, percentBps, passed: percentBps >= exam.passPercent * 100 })
      .where(and(eq(examAttempts.id, attempt.id), isNull(examAttempts.submittedAt)))
      .run();
    if (updated.changes === 0) return; // graded concurrently
  });
}

export function submitAttempt(studentId: string, attemptId: string): AttemptResult {
  const attempt = attemptFor(studentId, attemptId);
  if (!attempt.submittedAt) grade(attempt, attempt.deadlineAt.getTime() + GRACE_MS < Date.now());
  return attemptResult(studentId, attemptId);
}

export function attemptResult(studentId: string, attemptId: string): AttemptResult {
  let attempt = attemptFor(studentId, attemptId);
  if (!attempt.submittedAt) {
    if (attempt.deadlineAt.getTime() + GRACE_MS >= Date.now()) throw ApiError.conflict('This attempt is still in progress.', 'IN_PROGRESS');
    grade(attempt, true);
    attempt = attemptFor(studentId, attemptId);
  }
  const exam = db.select({ title: exams.title }).from(exams).where(eq(exams.id, attempt.examId)).get()!;
  const answers = db.select().from(examAnswers).where(eq(examAnswers.attemptId, attempt.id)).all();
  return {
    attemptId: attempt.id,
    examId: attempt.examId,
    examTitle: exam.title,
    attemptNumber: attempt.attemptNumber,
    submittedAt: attempt.submittedAt!.toISOString(),
    autoSubmitted: attempt.autoSubmitted,
    score: attempt.score ?? 0,
    totalMarks: attempt.totalMarks ?? 0,
    percentBps: attempt.percentBps ?? 0,
    passed: Boolean(attempt.passed),
    answered: answers.filter((a) => a.optionId).length,
    correct: answers.filter((a) => a.isCorrect).length,
    questionCount: attempt.questionOrder.length,
  };
}

export function myResults(studentId: string): AttemptResult[] {
  finalizeExpired({ studentId });
  return db
    .select({ id: examAttempts.id })
    .from(examAttempts)
    .where(and(eq(examAttempts.studentId, studentId), sql`${examAttempts.submittedAt} is not null`))
    .orderBy(desc(examAttempts.submittedAt))
    .all()
    .map((a) => attemptResult(studentId, a.id));
}
