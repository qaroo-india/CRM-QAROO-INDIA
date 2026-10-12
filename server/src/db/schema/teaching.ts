/**
 * Teaching: the class schedule, attendance, exams, study material and
 * certificates.
 *
 * Attendance and exams belong to a STUDENT through their ADMISSION, so a
 * student who takes two courses has two separate attendance records and
 * results, and a batch transfer keeps the history in the right place.
 */

import {
  ATTENDANCE_STATUSES,
  CERTIFICATE_STATUSES,
  CLASS_SESSION_KINDS,
  CLASS_SESSION_STATUSES,
  EXAM_KINDS,
  EXAM_STATUSES,
  MATERIAL_KINDS,
  type AttendanceStatus,
  type CertificateStatus,
  type ClassSessionKind,
  type ClassSessionStatus,
  type ExamKind,
  type ExamStatus,
  type MaterialKind,
} from '@ims/shared';
import {
  bool,
  check,
  dateOnly,
  enumStr,
  id,
  index,
  inList,
  instant,
  int,
  isDateOnly,
  json,
  ref,
  sql,
  str,
  table,
  timestamps,
  uniqueIndex,
  type AnyColumn,
} from '../dialect';
import { courses, students, trainers } from './catalog';
import { admissions, batches } from './enrolment';
import { users } from './users';

/* ------------------------------------------------------------------ *
 * Class schedule
 * ------------------------------------------------------------------ */

export const classSessions = table(
  'class_sessions',
  {
    id: id(),
    batchId: ref('batch_id')
      .notNull()
      .references(() => batches.id),
    trainerId: ref('trainer_id').references(() => trainers.id),
    title: str('title').notNull(),
    kind: enumStr('kind', CLASS_SESSION_KINDS).$type<ClassSessionKind>().notNull().default('lecture'),
    status: enumStr('status', CLASS_SESSION_STATUSES).$type<ClassSessionStatus>().notNull().default('scheduled'),
    startsAt: instant('starts_at').notNull(),
    durationMinutes: int('duration_minutes').notNull().default(60),
    location: str('location'),
    meetingLink: str('meeting_link'),
    description: str('description'),
    examId: ref('exam_id').references((): AnyColumn => exams.id),
    cancelReason: str('cancel_reason'),
    createdById: ref('created_by_id').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    index('class_sessions_batch_idx').on(t.batchId, t.startsAt),
    index('class_sessions_starts_idx').on(t.startsAt),
    check('class_sessions_kind_check', inList(t.kind, CLASS_SESSION_KINDS)),
    check('class_sessions_status_check', inList(t.status, CLASS_SESSION_STATUSES)),
    check('class_sessions_duration_range', sql`${t.durationMinutes} between 5 and 720`),
    check('class_sessions_cancel_reason', sql`${t.status} <> 'cancelled' or ${t.cancelReason} is not null`),
  ],
);

/* ------------------------------------------------------------------ *
 * Attendance
 * ------------------------------------------------------------------ */

/** One register per batch per calendar day. */
export const attendanceSessions = table(
  'attendance_sessions',
  {
    id: id(),
    batchId: ref('batch_id')
      .notNull()
      .references(() => batches.id),
    date: dateOnly('date').notNull(),
    classSessionId: ref('class_session_id').references(() => classSessions.id),
    topic: str('topic'),
    takenById: ref('taken_by_id').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('attendance_sessions_batch_date_unique').on(t.batchId, t.date),
    index('attendance_sessions_date_idx').on(t.date),
    check('attendance_sessions_date_format', isDateOnly(t.date)),
  ],
);

export const attendanceRecords = table(
  'attendance_records',
  {
    id: id(),
    attendanceSessionId: ref('attendance_session_id')
      .notNull()
      .references(() => attendanceSessions.id),
    admissionId: ref('admission_id')
      .notNull()
      .references(() => admissions.id),
    studentId: ref('student_id')
      .notNull()
      .references(() => students.id),
    status: enumStr('status', ATTENDANCE_STATUSES).$type<AttendanceStatus>().notNull(),
    minutesLate: int('minutes_late').notNull().default(0),
    remark: str('remark'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('attendance_records_session_admission_unique').on(t.attendanceSessionId, t.admissionId),
    index('attendance_records_admission_idx').on(t.admissionId),
    index('attendance_records_student_idx').on(t.studentId),
    check('attendance_records_status_check', inList(t.status, ATTENDANCE_STATUSES)),
    check('attendance_records_minutes_late_range', sql`${t.minutesLate} between 0 and 720`),
  ],
);

/* ------------------------------------------------------------------ *
 * Exams. Correct answers never leave the server; scores are computed
 * only by the grading service, never accepted from a client.
 * ------------------------------------------------------------------ */

export const exams = table(
  'exams',
  {
    id: id(),
    title: str('title').notNull(),
    kind: enumStr('kind', EXAM_KINDS).$type<ExamKind>().notNull().default('unit_test'),
    status: enumStr('status', EXAM_STATUSES).$type<ExamStatus>().notNull().default('draft'),
    /** Exactly one of batch (that batch's students) or course (everyone admitted to it). */
    batchId: ref('batch_id').references(() => batches.id),
    courseId: ref('course_id').references(() => courses.id),
    authorId: ref('author_id').references(() => users.id),
    instructions: str('instructions'),
    durationMinutes: int('duration_minutes').notNull().default(30),
    passPercent: int('pass_percent').notNull().default(40),
    maxAttempts: int('max_attempts').notNull().default(1),
    availableFrom: instant('available_from'),
    availableUntil: instant('available_until'),
    shuffleQuestions: bool('shuffle_questions').notNull().default(true),
    /** Frozen when published, so a later edit cannot change past results. */
    totalMarks: int('total_marks').notNull().default(0),
    publishedAt: instant('published_at'),
    ...timestamps(),
  },
  (t) => [
    index('exams_batch_idx').on(t.batchId, t.status),
    index('exams_course_idx').on(t.courseId, t.status),
    check('exams_kind_check', inList(t.kind, EXAM_KINDS)),
    check('exams_status_check', inList(t.status, EXAM_STATUSES)),
    check('exams_target', sql`(${t.batchId} is null) <> (${t.courseId} is null)`),
    check('exams_duration_range', sql`${t.durationMinutes} between 1 and 600`),
    check('exams_pass_range', sql`${t.passPercent} between 0 and 100`),
    check('exams_attempts_range', sql`${t.maxAttempts} between 1 and 20`),
    check('exams_window', sql`${t.availableFrom} is null or ${t.availableUntil} is null or ${t.availableUntil} > ${t.availableFrom}`),
  ],
);

export const examQuestions = table(
  'exam_questions',
  {
    id: id(),
    examId: ref('exam_id')
      .notNull()
      .references(() => exams.id),
    position: int('position').notNull().default(0),
    text: str('text').notNull(),
    marks: int('marks').notNull().default(1),
    isActive: bool('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    index('exam_questions_exam_idx').on(t.examId, t.position),
    check('exam_questions_marks_range', sql`${t.marks} between 1 and 100`),
  ],
);

export const examOptions = table(
  'exam_options',
  {
    id: id(),
    questionId: ref('question_id')
      .notNull()
      .references(() => examQuestions.id),
    position: int('position').notNull().default(0),
    text: str('text').notNull(),
    isCorrect: bool('is_correct').notNull().default(false),
  },
  (t) => [
    index('exam_options_question_idx').on(t.questionId, t.position),
    // Exactly-one-correct is checked on publish; at-most-one is guaranteed here.
    uniqueIndex('exam_options_one_correct').on(t.questionId).where(sql`is_correct = 1`),
  ],
);

export const examAttempts = table(
  'exam_attempts',
  {
    id: id(),
    examId: ref('exam_id')
      .notNull()
      .references(() => exams.id),
    studentId: ref('student_id')
      .notNull()
      .references(() => students.id),
    attemptNumber: int('attempt_number').notNull(),
    /** Question ids in the order this student sees them. */
    questionOrder: json<string[]>('question_order').notNull(),
    startedAt: instant('started_at').notNull(),
    deadlineAt: instant('deadline_at').notNull(),
    submittedAt: instant('submitted_at'),
    /** Submitted after the deadline (graded with what was saved by then). */
    autoSubmitted: bool('auto_submitted').notNull().default(false),
    score: int('score'),
    totalMarks: int('total_marks'),
    /** Basis points: 8350 = 83.50%. */
    percentBps: int('percent_bps'),
    passed: bool('passed'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('exam_attempts_number_unique').on(t.examId, t.studentId, t.attemptNumber),
    index('exam_attempts_student_idx').on(t.studentId),
    check('exam_attempts_number_positive', sql`${t.attemptNumber} >= 1`),
    check('exam_attempts_score_range', sql`${t.score} is null or (${t.score} >= 0 and ${t.score} <= ${t.totalMarks})`),
    check('exam_attempts_graded_together', sql`(${t.submittedAt} is null) = (${t.score} is null)`),
  ],
);

export const examAnswers = table(
  'exam_answers',
  {
    id: id(),
    attemptId: ref('attempt_id')
      .notNull()
      .references(() => examAttempts.id),
    questionId: ref('question_id')
      .notNull()
      .references(() => examQuestions.id),
    optionId: ref('option_id').references(() => examOptions.id),
    isCorrect: bool('is_correct').notNull().default(false),
    marksAwarded: int('marks_awarded').notNull().default(0),
    answeredAt: instant('answered_at').notNull(),
  },
  (t) => [
    uniqueIndex('exam_answers_attempt_question_unique').on(t.attemptId, t.questionId),
    check('exam_answers_marks_nonneg', sql`${t.marksAwarded} >= 0`),
  ],
);

/* ------------------------------------------------------------------ *
 * Study material
 * ------------------------------------------------------------------ */

export const materials = table(
  'materials',
  {
    id: id(),
    title: str('title').notNull(),
    description: str('description'),
    kind: enumStr('kind', MATERIAL_KINDS).$type<MaterialKind>().notNull().default('notes'),
    courseId: ref('course_id')
      .notNull()
      .references(() => courses.id),
    /** Null: every batch of the course. */
    batchId: ref('batch_id').references(() => batches.id),
    fileKey: str('file_key'),
    fileName: str('file_name'),
    fileMime: str('file_mime'),
    fileSize: int('file_size'),
    externalUrl: str('external_url'),
    isPublished: bool('is_published').notNull().default(true),
    uploadedById: ref('uploaded_by_id').references(() => users.id),
    deletedAt: instant('deleted_at'),
    ...timestamps(),
  },
  (t) => [
    index('materials_course_idx').on(t.courseId, t.isPublished),
    index('materials_batch_idx').on(t.batchId),
    check('materials_kind_check', inList(t.kind, MATERIAL_KINDS)),
    check('materials_has_content', sql`${t.fileKey} is not null or ${t.externalUrl} is not null`),
  ],
);

/** Who opened which material, and when. */
export const materialAccess = table(
  'material_access',
  {
    id: id(),
    materialId: ref('material_id')
      .notNull()
      .references(() => materials.id),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id),
    accessedAt: instant('accessed_at').notNull(),
  },
  (t) => [index('material_access_material_idx').on(t.materialId, t.accessedAt), index('material_access_user_idx').on(t.userId)],
);

/* ------------------------------------------------------------------ *
 * Certificates
 * ------------------------------------------------------------------ */

export const certificates = table(
  'certificates',
  {
    id: id(),
    studentId: ref('student_id')
      .notNull()
      .references(() => students.id),
    admissionId: ref('admission_id')
      .notNull()
      .references(() => admissions.id),
    courseId: ref('course_id')
      .notNull()
      .references(() => courses.id),
    status: enumStr('status', CERTIFICATE_STATUSES).$type<CertificateStatus>().notNull().default('requested'),
    /** CERT-2026-00012; assigned only when issued. */
    referenceNumber: str('reference_number'),
    issuedOn: dateOnly('issued_on'),
    requestNote: str('request_note'),
    reviewNote: str('review_note'),
    fileKey: str('file_key'),
    requestedById: ref('requested_by_id').references(() => users.id),
    reviewedById: ref('reviewed_by_id').references(() => users.id),
    reviewedAt: instant('reviewed_at'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('certificates_reference_unique').on(t.referenceNumber),
    // At most one live (not rejected) certificate per admission.
    uniqueIndex('certificates_one_live').on(t.admissionId).where(sql`status <> 'rejected'`),
    index('certificates_student_idx').on(t.studentId, t.status),
    check('certificates_status_check', inList(t.status, CERTIFICATE_STATUSES)),
    check('certificates_issued_complete', sql`${t.status} <> 'issued' or (${t.referenceNumber} is not null and ${t.issuedOn} is not null)`),
  ],
);

export type ClassSession = typeof classSessions.$inferSelect;
export type AttendanceSessionRow = typeof attendanceSessions.$inferSelect;
export type Exam = typeof exams.$inferSelect;
export type ExamQuestion = typeof examQuestions.$inferSelect;
export type ExamOption = typeof examOptions.$inferSelect;
export type ExamAttempt = typeof examAttempts.$inferSelect;
export type Material = typeof materials.$inferSelect;
export type Certificate = typeof certificates.$inferSelect;
