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

async function toExamDto(r: ExamRow): Promise<ExamDto> {
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
    totalMarks: live ?? await draftMarks(e.id),
    questionCount: r.questionCount,
    publishedAt: e.publishedAt?.toISOString() ?? null,
    submissions: r.submissions,
    averagePercentBps: r.averageBps === null ? null : Math.round(Number(r.averageBps)),
    passRate: r.submissions > 0 ? r.passes / r.submissions : null,
    createdAt: e.createdAt.toISOString(),
  };
}

async function draftMarks(examId: string): Promise<number> {
  return Number((await db.get<{ n: number }>(sql`select coalesce(sum(marks), 0) as n from exam_questions where exam_id = ${examId} and is_active = 1`))?.n ?? 0);
}

/** Faculty: exams for their batches, plus course-wide exams of the courses they teach. */
async function examScope(ctx: RequestContext): Promise<SQL | undefined> {
  const ids = await facultyBatchIds(ctx);
  if (ids === null) return undefined;
  if (ids.length === 0) return sql`0`;
  const courseIds = (await db.select({ courseId: batches.courseId }).from(batches).where(inArray(batches.id, ids)).all()).map((b) => b.courseId);
  return or(inArray(exams.batchId, ids), inArray(exams.courseId, courseIds));
}

async function examForStaff(ctx: RequestContext, id: string, forWrite = false): Promise<Exam> {
  const exam = await db.select().from(exams).where(and(eq(exams.id, id), await examScope(ctx))).get();
  if (!exam) throw ApiError.notFound('Exam');
  // Faculty may change only their batch exams, or course-wide exams they wrote.
  if (forWrite && ctx.accountType === 'faculty' && !exam.batchId && exam.authorId !== ctx.actorId) throw ApiError.forbidden('Only the author can change a course-wide exam.');
  return exam;
}

export async function listExams(ctx: RequestContext, q: z.output<typeof examListQuerySchema>) {
  const conditions: (SQL | undefined)[] = [await examScope(ctx)];
  if (q.q) conditions.push(containsText(exams.title, q.q));
  if (q.batchId) conditions.push(eq(exams.batchId, q.batchId));
  if (q.courseId) conditions.push(or(eq(exams.courseId, q.courseId), eq(batches.courseId, q.courseId)));
  if (q.kind) conditions.push(eq(exams.kind, q.kind));
  if (q.status?.length) conditions.push(inArray(exams.status, q.status));
  const where = and(...conditions);
  const total = (await db.select({ n: count() }).from(exams).leftJoin(batches, eq(batches.id, exams.batchId)).where(where).get())?.n ?? 0;
  const { limit, offset } = pageWindow(q.page, q.limit);
  const rows = await examQuery().where(where).orderBy(desc(exams.createdAt)).limit(limit).offset(offset).all();
  return paginated((await Promise.all(rows.map(toExamDto))), total, q.page, q.limit);
}

export async function getExam(ctx: RequestContext, id: string): Promise<ExamDetail> {
  await examForStaff(ctx, id);
  const row = (await examQuery().where(eq(exams.id, id)).get())!;
  const questions = await db.select().from(examQuestions).where(eq(examQuestions.examId, id)).orderBy(asc(examQuestions.position), asc(examQuestions.createdAt)).all();
  const options = questions.length ? await db.select().from(examOptions).where(inArray(examOptions.questionId, questions.map((q) => q.id))).orderBy(asc(examOptions.position)).all() : [];
  return {
    ...await toExamDto(row),
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

async function assertTarget(ctx: RequestContext, batchId: string | undefined, courseId: string | undefined): Promise<void> {
  if (batchId) {
    if (!await db.select({ id: batches.id }).from(batches).where(eq(batches.id, batchId)).get()) throw ApiError.validation([{ path: 'batchId', message: 'Choose a valid batch' }]);
    const ids = await facultyBatchIds(ctx);
    if (ids && !ids.includes(batchId)) throw ApiError.forbidden('You can only set exams for your own batches.');
  }
  if (courseId) {
    if (!await db.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId)).get()) throw ApiError.validation([{ path: 'courseId', message: 'Choose a valid course' }]);
    const ids = await facultyBatchIds(ctx);
    if (ids && !await db.select({ id: batches.id }).from(batches).where(and(eq(batches.courseId, courseId), inArray(batches.id, ids.length ? ids : ['-']))).get()) {
      throw ApiError.forbidden('You can only set exams for courses you teach.');
    }
  }
}

export async function createExam(ctx: RequestContext, raw: unknown): Promise<ExamDetail> {
  const input = examSchema.parse(raw);
  await assertTarget(ctx, input.batchId, input.courseId);
  const id = await db.transaction(async (tx) => {
    const row = await tx
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
    await recordAudit(tx, ctx, { action: 'create', entityType: 'exam', entityId: row.id, summary: `Created exam "${row.title}"` });
    return row.id;
  });
  return await getExam(ctx, id);
}

async function attemptsExist(examId: string): Promise<boolean> {
  return Boolean(await db.select({ id: examAttempts.id }).from(examAttempts).where(eq(examAttempts.examId, examId)).get());
}

export async function updateExam(ctx: RequestContext, id: string, raw: unknown): Promise<ExamDetail> {
  const exam = await examForStaff(ctx, id, true);
  const input = examSchema.parse(raw);
  if (exam.status !== 'draft') {
    // Once published only the window and instructions may move: the paper itself is frozen.
    const frozen: (keyof typeof input)[] = ['kind', 'batchId', 'courseId', 'durationMinutes', 'passPercent', 'maxAttempts', 'shuffleQuestions'];
    const before: Record<string, unknown> = { kind: exam.kind, batchId: exam.batchId ?? undefined, courseId: exam.courseId ?? undefined, durationMinutes: exam.durationMinutes, passPercent: exam.passPercent, maxAttempts: exam.maxAttempts, shuffleQuestions: exam.shuffleQuestions };
    if (frozen.some((k) => (input[k] ?? undefined) !== before[k])) throw ApiError.conflict('A published exam can only change its title, instructions and opening times. Move it back to draft (if nobody has attempted it) to change the rest.', 'EXAM_FROZEN');
  }
  await assertTarget(ctx, input.batchId, input.courseId);
  await db.transaction(async (tx) => {
    await tx.update(exams)
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
    await recordAudit(tx, ctx, { action: 'update', entityType: 'exam', entityId: id, summary: `Updated exam "${input.title}"` });
  });
  return await getExam(ctx, id);
}

function assertDraft(exam: Exam): void {
  if (exam.status !== 'draft') throw ApiError.conflict('Questions can only be changed while the exam is a draft.', 'EXAM_FROZEN');
}

export async function addQuestion(ctx: RequestContext, examId: string, raw: unknown): Promise<ExamDetail> {
  const exam = await examForStaff(ctx, examId, true);
  assertDraft(exam);
  const input = examQuestionSchema.parse(raw);
  const position = Number((await db.get<{ n: number }>(sql`select coalesce(max(position), 0) + 1 as n from exam_questions where exam_id = ${examId}`))?.n ?? 1);
  await db.transaction(async (tx) => {
    const q = await tx.insert(examQuestions).values({ examId, position, text: input.text, marks: input.marks }).returning().get();
    for (const [i, o] of input.options.entries()) {
      await tx.insert(examOptions).values({ questionId: q.id, position: i + 1, text: o.text, isCorrect: o.isCorrect }).run();
    }
  });
  return await getExam(ctx, examId);
}

async function questionForStaff(ctx: RequestContext, questionId: string) {
  const q = await db.select().from(examQuestions).where(eq(examQuestions.id, questionId)).get();
  if (!q) throw ApiError.notFound('Question');
  const exam = await examForStaff(ctx, q.examId, true);
  assertDraft(exam);
  return q;
}

export async function updateQuestion(ctx: RequestContext, questionId: string, raw: unknown): Promise<ExamDetail> {
  const q = await questionForStaff(ctx, questionId);
  const input = examQuestionSchema.parse(raw);
  await db.transaction(async (tx) => {
    await tx.update(examQuestions).set({ text: input.text, marks: input.marks }).where(eq(examQuestions.id, q.id)).run();
    // A draft has no attempts, so its options can be replaced outright.
    await tx.delete(examOptions).where(eq(examOptions.questionId, q.id)).run();
    for (const [i, o] of input.options.entries()) {
      await tx.insert(examOptions).values({ questionId: q.id, position: i + 1, text: o.text, isCorrect: o.isCorrect }).run();
    }
  });
  return await getExam(ctx, q.examId);
}

export async function removeQuestion(ctx: RequestContext, questionId: string): Promise<ExamDetail> {
  const q = await questionForStaff(ctx, questionId);
  await db.transaction(async (tx) => {
    await tx.delete(examOptions).where(eq(examOptions.questionId, q.id)).run();
    await tx.delete(examQuestions).where(eq(examQuestions.id, q.id)).run();
  });
  return await getExam(ctx, q.examId);
}

/** Students (with a portal login) an exam is for. */
async function examAudience(exam: Pick<Exam, 'batchId' | 'courseId'>): Promise<string[]> {
  const who = exam.batchId
    ? sql`${students.id} in (select ba.student_id from batch_assignments ba where ba.batch_id = ${exam.batchId} and ba.status = 'active')`
    : sql`${students.id} in (select a.student_id from admissions a where a.course_id = ${exam.courseId} and a.status in ('pending_payment', 'active'))`;
  return (await db
    .select({ userId: students.userId })
    .from(students)
    .innerJoin(users, eq(users.id, students.userId))
    .where(and(eq(users.isActive, true), who))
    .all())
    .map((r) => r.userId!)
    .filter(Boolean);
}

export async function setExamStatus(ctx: RequestContext, id: string, raw: unknown): Promise<ExamDetail> {
  const exam = await examForStaff(ctx, id, true);
  const { status } = examStatusSchema.parse(raw);
  if (status === exam.status) return await getExam(ctx, id);

  let totalMarks = exam.totalMarks;
  if (status === 'published') {
    if (exam.status === 'archived') throw ApiError.conflict('An archived exam cannot be reopened.', 'INVALID_TRANSITION');
    const detail = await getExam(ctx, id);
    const active = detail.questions.filter((q) => q.isActive);
    if (active.length === 0) throw ApiError.unprocessable('Add at least one question before publishing.', 'NO_QUESTIONS');
    const broken = active.find((q) => q.options.length < 2 || q.options.filter((o) => o.isCorrect).length !== 1);
    if (broken) throw ApiError.unprocessable(`Question ${broken.position} needs at least two options and exactly one correct answer.`, 'INVALID_QUESTION');
    if (exam.availableUntil && exam.availableUntil.getTime() <= Date.now()) throw ApiError.unprocessable('The closing time has already passed. Move it later before publishing.', 'WINDOW_PASSED');
    totalMarks = active.reduce((s, q) => s + q.marks, 0);
  }
  if (status === 'draft' && await attemptsExist(id)) throw ApiError.conflict('Students have already attempted this exam, so it cannot go back to draft. Close it instead.', 'HAS_ATTEMPTS');

  await db.transaction(async (tx) => {
    await tx.update(exams)
      .set({ status, totalMarks, ...(status === 'published' && !exam.publishedAt && { publishedAt: new Date() }) })
      .where(eq(exams.id, id))
      .run();
    await recordAudit(tx, ctx, { action: 'status_change', entityType: 'exam', entityId: id, summary: `Exam "${exam.title}": ${exam.status} → ${status}`, before: { status: exam.status }, after: { status, totalMarks } });
  });
  if (status === 'published' && exam.status === 'draft') {
    await safely('exam_published', async () => {
      await notifyUsers(await examAudience(exam), { type: 'exam_published', title: `New exam: ${exam.title}`, body: `${exam.durationMinutes} minutes · ${totalMarks} marks`, link: '/portal/exams', entityType: 'exam', entityId: id, dedupeKey: `exam_published:${id}` });
    });
  }
  return await getExam(ctx, id);
}

export async function examResults(ctx: RequestContext, id: string): Promise<ExamResultRow[]> {
  await examForStaff(ctx, id);
  await finalizeExpired({ examId: id });
  return (await db
    .select({ a: examAttempts, studentName: students.fullName, studentCode: students.studentCode })
    .from(examAttempts)
    .innerJoin(students, eq(students.id, examAttempts.studentId))
    .where(eq(examAttempts.examId, id))
    .orderBy(asc(students.fullName), asc(examAttempts.attemptNumber))
    .all())
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
export async function finalizeExpired(filter: { examId?: string; studentId?: string }): Promise<void> {
  const cutoff = Date.now() - GRACE_MS;
  const open = await db
    .select()
    .from(examAttempts)
    .where(and(isNull(examAttempts.submittedAt), sql`${examAttempts.deadlineAt} < ${cutoff}`, filter.examId ? eq(examAttempts.examId, filter.examId) : undefined, filter.studentId ? eq(examAttempts.studentId, filter.studentId) : undefined))
    .all();
  for (const attempt of open) await grade(attempt, true);
}

export async function portalExams(studentId: string): Promise<PortalExam[]> {
  await finalizeExpired({ studentId });
  const rows = await examQuery().where(and(inArray(exams.status, ['published', 'closed']), studentCanSee(studentId))).orderBy(desc(exams.publishedAt)).all();
  if (rows.length === 0) return [];
  const attempts = await db.select().from(examAttempts).where(and(eq(examAttempts.studentId, studentId), inArray(examAttempts.examId, rows.map((r) => r.e.id)))).all();
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

export async function startAttempt(studentId: string, examId: string): Promise<ExamPaper> {
  await finalizeExpired({ studentId, examId });
  const exam = await db.select().from(exams).where(and(eq(exams.id, examId), studentCanSee(studentId))).get();
  if (!exam) throw ApiError.notFound('Exam');
  const open = await db.select().from(examAttempts).where(and(eq(examAttempts.examId, examId), eq(examAttempts.studentId, studentId), isNull(examAttempts.submittedAt))).get();
  if (open) return await getPaper(studentId, open.id);
  const closed = isOpen(exam);
  if (closed) throw ApiError.unprocessable(closed, 'EXAM_NOT_OPEN');
  const used = (await db.select({ n: count() }).from(examAttempts).where(and(eq(examAttempts.examId, examId), eq(examAttempts.studentId, studentId))).get())?.n ?? 0;
  if (used >= exam.maxAttempts) throw ApiError.unprocessable(`You have used all ${exam.maxAttempts} attempt(s).`, 'NO_ATTEMPTS_LEFT');

  const questionIds = (await db.select({ id: examQuestions.id }).from(examQuestions).where(and(eq(examQuestions.examId, examId), eq(examQuestions.isActive, true))).orderBy(asc(examQuestions.position)).all()).map((q) => q.id);
  const now = new Date();
  const byDuration = now.getTime() + exam.durationMinutes * 60_000;
  const deadline = new Date(exam.availableUntil ? Math.min(byDuration, exam.availableUntil.getTime()) : byDuration);
  const attempt = await db
    .insert(examAttempts)
    .values({ examId, studentId, attemptNumber: used + 1, questionOrder: exam.shuffleQuestions ? shuffled(questionIds) : questionIds, startedAt: now, deadlineAt: deadline })
    .returning()
    .get();
  return await getPaper(studentId, attempt.id);
}

async function attemptFor(studentId: string, attemptId: string): Promise<ExamAttempt> {
  const attempt = await db.select().from(examAttempts).where(and(eq(examAttempts.id, attemptId), eq(examAttempts.studentId, studentId))).get();
  if (!attempt) throw ApiError.notFound('Attempt');
  return attempt;
}

export async function getPaper(studentId: string, attemptId: string): Promise<ExamPaper> {
  const attempt = await attemptFor(studentId, attemptId);
  if (attempt.submittedAt) throw ApiError.conflict('This attempt has been submitted.', 'ALREADY_SUBMITTED');
  if (attempt.deadlineAt.getTime() + GRACE_MS < Date.now()) {
    await grade(attempt, true);
    throw ApiError.conflict('Time is up: your saved answers were submitted.', 'TIME_UP');
  }
  const exam = (await db.select().from(exams).where(eq(exams.id, attempt.examId)).get())!;
  const questions = attempt.questionOrder.length ? await db.select().from(examQuestions).where(inArray(examQuestions.id, attempt.questionOrder)).all() : [];
  const options = questions.length ? await db.select({ id: examOptions.id, questionId: examOptions.questionId, text: examOptions.text, position: examOptions.position }).from(examOptions).where(inArray(examOptions.questionId, questions.map((q) => q.id))).orderBy(asc(examOptions.position)).all() : [];
  const answers = await db.select().from(examAnswers).where(eq(examAnswers.attemptId, attempt.id)).all();
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

export async function saveAnswer(studentId: string, attemptId: string, raw: unknown): Promise<{ saved: true }> {
  const attempt = await attemptFor(studentId, attemptId);
  if (attempt.submittedAt) throw ApiError.conflict('This attempt has been submitted.', 'ALREADY_SUBMITTED');
  if (attempt.deadlineAt.getTime() + GRACE_MS < Date.now()) {
    await grade(attempt, true);
    throw ApiError.conflict('Time is up: your saved answers were submitted.', 'TIME_UP');
  }
  const input = examAnswerSchema.parse(raw);
  if (!attempt.questionOrder.includes(input.questionId)) throw ApiError.validation([{ path: 'questionId', message: 'That question is not part of this paper' }]);
  if (input.optionId) {
    const option = await db.select({ questionId: examOptions.questionId }).from(examOptions).where(eq(examOptions.id, input.optionId)).get();
    if (!option || option.questionId !== input.questionId) throw ApiError.unprocessable('That answer does not belong to the question.', 'INVALID_OPTION');
  }
  await db.insert(examAnswers)
    .values({ attemptId, questionId: input.questionId, optionId: input.optionId, answeredAt: new Date() })
    .onConflictDoUpdate({ target: [examAnswers.attemptId, examAnswers.questionId], set: { optionId: input.optionId, answeredAt: new Date() } })
    .run();
  return { saved: true };
}

/** Score an attempt from the saved answers. The only place scores are written. */
async function grade(attempt: ExamAttempt, auto: boolean): Promise<void> {
  const exam = (await db.select().from(exams).where(eq(exams.id, attempt.examId)).get())!;
  const questions = attempt.questionOrder.length ? await db.select().from(examQuestions).where(inArray(examQuestions.id, attempt.questionOrder)).all() : [];
  const correct = new Map(
    questions.length ? (await db.select({ questionId: examOptions.questionId, id: examOptions.id }).from(examOptions).where(and(inArray(examOptions.questionId, questions.map((q) => q.id)), eq(examOptions.isCorrect, true))).all()).map((o) => [o.questionId, o.id]) : [],
  );
  const answers = await db.select().from(examAnswers).where(eq(examAnswers.attemptId, attempt.id)).all();
  const total = questions.reduce((s, q) => s + q.marks, 0);
  await db.transaction(async (tx) => {
    let score = 0;
    for (const a of answers) {
      const q = questions.find((x) => x.id === a.questionId);
      const right = Boolean(q && a.optionId && correct.get(q.id) === a.optionId);
      const marks = right ? q!.marks : 0;
      score += marks;
      await tx.update(examAnswers).set({ isCorrect: right, marksAwarded: marks }).where(eq(examAnswers.id, a.id)).run();
    }
    const percentBps = total > 0 ? Math.round((score * 10_000) / total) : 0;
    const updated = await tx
      .update(examAttempts)
      .set({ submittedAt: new Date(), autoSubmitted: auto, score, totalMarks: total, percentBps, passed: percentBps >= exam.passPercent * 100 })
      .where(and(eq(examAttempts.id, attempt.id), isNull(examAttempts.submittedAt)))
      .run();
    if (updated.rowsAffected === 0) return; // graded concurrently
  });
}

export async function submitAttempt(studentId: string, attemptId: string): Promise<AttemptResult> {
  const attempt = await attemptFor(studentId, attemptId);
  if (!attempt.submittedAt) await grade(attempt, attempt.deadlineAt.getTime() + GRACE_MS < Date.now());
  return await attemptResult(studentId, attemptId);
}

export async function attemptResult(studentId: string, attemptId: string): Promise<AttemptResult> {
  let attempt = await attemptFor(studentId, attemptId);
  if (!attempt.submittedAt) {
    if (attempt.deadlineAt.getTime() + GRACE_MS >= Date.now()) throw ApiError.conflict('This attempt is still in progress.', 'IN_PROGRESS');
    await grade(attempt, true);
    attempt = await attemptFor(studentId, attemptId);
  }
  const exam = (await db.select({ title: exams.title }).from(exams).where(eq(exams.id, attempt.examId)).get())!;
  const answers = await db.select().from(examAnswers).where(eq(examAnswers.attemptId, attempt.id)).all();
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

export async function myResults(studentId: string): Promise<AttemptResult[]> {
  await finalizeExpired({ studentId });
  return (await Promise.all((await db
    .select({ id: examAttempts.id })
    .from(examAttempts)
    .where(and(eq(examAttempts.studentId, studentId), sql`${examAttempts.submittedAt} is not null`))
    .orderBy(desc(examAttempts.submittedAt))
    .all())
    .map(async (a) => await attemptResult(studentId, a.id))));
}
