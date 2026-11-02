/**
 * Response shapes for the campus modules and the student portal. Money is
 * integer minor units; business dates are 'YYYY-MM-DD'; instants are ISO.
 */

/* ------------------------------------------------------------------ *
 * Class schedule and attendance
 * ------------------------------------------------------------------ */

export interface ClassSessionDto {
  id: string;
  batchId: string;
  batchCode: string;
  batchName: string;
  courseId: string;
  courseName: string;
  trainerId: string | null;
  trainerName: string | null;
  title: string;
  kind: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  location: string | null;
  meetingLink: string | null;
  description: string | null;
  examId: string | null;
  examTitle: string | null;
  cancelReason: string | null;
  /** The institute calendar day the class falls on. */
  date: string;
  attendanceTaken: boolean;
}

export interface AttendanceRosterRow {
  admissionId: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  status: string | null;
  minutesLate: number;
  remark: string | null;
  /** Attendance so far in this batch, 0..1; null before any class counts. */
  percent: number | null;
}

export interface AttendanceRosterDto {
  batch: { id: string; batchCode: string; name: string; courseName: string; startDate: string; endDate: string | null };
  date: string;
  sessionId: string | null;
  topic: string | null;
  classSessionId: string | null;
  takenByName: string | null;
  updatedAt: string | null;
  /** Students in the batch on that day (assignment history respected). */
  rows: AttendanceRosterRow[];
}

export interface AttendanceSessionDto {
  id: string;
  batchId: string;
  batchCode: string;
  date: string;
  topic: string | null;
  takenByName: string | null;
  present: number;
  late: number;
  onDuty: number;
  absent: number;
  holiday: number;
  total: number;
}

export interface AttendanceSummaryRow {
  admissionId: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  sessions: number;
  present: number;
  late: number;
  onDuty: number;
  absent: number;
  holiday: number;
  /** (present + late + on duty) / (sessions - holidays); null when nothing counts yet. */
  percent: number | null;
}

/* ------------------------------------------------------------------ *
 * Exams
 * ------------------------------------------------------------------ */

export interface ExamDto {
  id: string;
  title: string;
  kind: string;
  status: 'draft' | 'published' | 'closed' | 'archived';
  batchId: string | null;
  batchCode: string | null;
  courseId: string | null;
  /** The course the exam is for (via its batch, or directly). */
  courseName: string;
  authorName: string | null;
  instructions: string | null;
  durationMinutes: number;
  passPercent: number;
  maxAttempts: number;
  availableFrom: string | null;
  availableUntil: string | null;
  shuffleQuestions: boolean;
  totalMarks: number;
  questionCount: number;
  publishedAt: string | null;
  submissions: number;
  /** Basis points; null before anyone has submitted. */
  averagePercentBps: number | null;
  passRate: number | null;
  createdAt: string;
}

export interface ExamQuestionDto {
  id: string;
  position: number;
  text: string;
  marks: number;
  isActive: boolean;
  options: { id: string; position: number; text: string; isCorrect: boolean }[];
}

export interface ExamDetail extends ExamDto {
  /** Staff only: includes which option is correct. */
  questions: ExamQuestionDto[];
}

export interface ExamResultRow {
  attemptId: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  attemptNumber: number;
  startedAt: string;
  submittedAt: string | null;
  score: number | null;
  totalMarks: number | null;
  percentBps: number | null;
  passed: boolean | null;
  autoSubmitted: boolean;
}

/* ------------------------------------------------------------------ *
 * Study material and certificates
 * ------------------------------------------------------------------ */

export interface MaterialDto {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  courseId: string;
  courseName: string;
  batchId: string | null;
  batchCode: string | null;
  hasFile: boolean;
  fileName: string | null;
  fileSize: number | null;
  externalUrl: string | null;
  isPublished: boolean;
  uploadedByName: string | null;
  createdAt: string;
  /** Staff only: how many times it was opened. */
  opens: number | null;
}

export interface CertificateDto {
  id: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  admissionId: string;
  admissionNumber: string;
  courseName: string;
  admissionStatus: string;
  status: 'requested' | 'under_review' | 'approved' | 'issued' | 'rejected';
  referenceNumber: string | null;
  issuedOn: string | null;
  requestNote: string | null;
  reviewNote: string | null;
  hasFile: boolean;
  requestedAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
}

export interface CertificateVerification {
  valid: boolean;
  referenceNumber: string;
  studentName?: string;
  courseName?: string;
  issuedOn?: string;
  institute?: string;
}

/* ------------------------------------------------------------------ *
 * Placement drives
 * ------------------------------------------------------------------ */

export interface DriveDto {
  id: string;
  companyId: string;
  companyName: string;
  roleTitle: string;
  description: string | null;
  track: 'technical' | 'non_technical';
  status: 'planned' | 'open' | 'closed';
  driveDate: string;
  applyBy: string | null;
  packageMinor: number | null;
  openings: number;
  location: string | null;
  isRemote: boolean;
  eligibilityNote: string | null;
  coordinatorId: string | null;
  coordinatorName: string | null;
  batches: { id: string; batchCode: string; name: string }[];
  applicants: number;
  offers: number;
  joined: number;
}

export interface DriveApplicantDto {
  applicationId: string;
  profileId: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  courseName: string;
  appliedOn: string;
  outcome: string;
  interviews: number;
}

/* ------------------------------------------------------------------ *
 * Leave, tasks, inventory
 * ------------------------------------------------------------------ */

export interface LeaveDto {
  id: string;
  userId: string;
  userName: string;
  accountType: string;
  type: string;
  startDate: string;
  endDate: string;
  dayCount: number;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

export interface TaskDto {
  id: string;
  title: string;
  details: string | null;
  batchId: string | null;
  batchCode: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  createdById: string | null;
  createdByName: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
  dueDate: string | null;
  completedAt: string | null;
  isOverdue: boolean;
  attachmentName: string | null;
  createdAt: string;
}

export interface InventoryItemDto {
  id: string;
  assetTag: string;
  name: string;
  category: string;
  description: string | null;
  quantityTotal: number;
  quantityAvailable: number;
  /** Out with people now (issued, not returned). */
  quantityIssued: number;
  unitValueMinor: number;
  isConsumable: boolean;
  status: 'in_service' | 'repair' | 'retired';
  condition: string | null;
  location: string | null;
  purchasedOn: string | null;
  notes: string | null;
  pendingRequests: number;
}

export interface InventoryRequestDto {
  id: string;
  itemId: string;
  itemName: string;
  assetTag: string;
  isConsumable: boolean;
  requestedById: string;
  requestedByName: string;
  quantity: number;
  status: 'pending' | 'issued' | 'returned' | 'rejected' | 'cancelled';
  reason: string | null;
  neededBy: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  issuedAt: string | null;
  returnedAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ *
 * Student portal (always scoped to the signed-in student)
 * ------------------------------------------------------------------ */

export interface PortalAdmission {
  id: string;
  admissionNumber: string;
  courseId: string;
  courseName: string;
  status: string;
  admissionDate: string;
  batch: { id: string; batchCode: string; name: string; trainerName: string | null; schedule: string | null } | null;
  agreedFeeMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  overdueMinor: number;
  nextInstalment: { dueDate: string; amountMinor: number } | null;
  attendancePercent: number | null;
}

export interface PortalOverview {
  student: { id: string; studentCode: string; fullName: string; email: string | null; phone: string };
  admissions: PortalAdmission[];
  upcomingClasses: ClassSessionDto[];
  openExams: number;
  newMaterials: number;
  certificates: { requested: number; issued: number };
}

export interface PortalInstalment {
  admissionId: string;
  admissionNumber: string;
  courseName: string;
  sequence: number;
  kind: string;
  dueDate: string;
  amountMinor: number;
  paidMinor: number;
  state: 'paid' | 'partly_paid' | 'due' | 'overdue' | 'upcoming';
}

export interface PortalPayment {
  id: string;
  receiptNumber: string;
  paymentDate: string;
  admissionNumber: string;
  courseName: string;
  direction: 'in' | 'refund';
  method: string;
  amountMinor: number;
}

export interface PortalFees {
  admissions: PortalAdmission[];
  instalments: PortalInstalment[];
  payments: PortalPayment[];
}

export interface PortalAttendance {
  admissionId: string;
  admissionNumber: string;
  courseName: string;
  batchCode: string | null;
  summary: Omit<AttendanceSummaryRow, 'admissionId' | 'studentId' | 'studentName' | 'studentCode'>;
  days: { date: string; status: string; minutesLate: number; topic: string | null; remark: string | null }[];
}

export interface PortalExam {
  id: string;
  title: string;
  kind: string;
  courseName: string;
  instructions: string | null;
  durationMinutes: number;
  totalMarks: number;
  questionCount: number;
  passPercent: number;
  availableFrom: string | null;
  availableUntil: string | null;
  maxAttempts: number;
  attemptsUsed: number;
  inProgressAttemptId: string | null;
  bestPercentBps: number | null;
  passed: boolean | null;
  /** Why the student cannot start now, or null when they can. */
  blockedReason: string | null;
}

export interface ExamPaper {
  attemptId: string;
  examId: string;
  examTitle: string;
  instructions: string | null;
  deadlineAt: string;
  totalMarks: number;
  /** In this attempt's order. Never includes which option is correct. */
  questions: { id: string; text: string; marks: number; options: { id: string; text: string }[] }[];
  /** questionId -> optionId saved so far. */
  answers: Record<string, string>;
}

export interface AttemptResult {
  attemptId: string;
  examId: string;
  examTitle: string;
  attemptNumber: number;
  submittedAt: string;
  autoSubmitted: boolean;
  score: number;
  totalMarks: number;
  percentBps: number;
  passed: boolean;
  answered: number;
  correct: number;
  questionCount: number;
}

export interface PortalPlacement {
  profile: { id: string; track: string; stage: string; eligibleOn: string | null; resumeStatus: string; placed: boolean } | null;
  /** Open drives this student may apply to, with whether they already have. */
  drives: (DriveDto & { applied: boolean; canApply: boolean; blockedReason: string | null })[];
  applications: { id: string; companyName: string; jobTitle: string; appliedOn: string; outcome: string; driveId: string | null; interviews: { roundName: string; scheduledAt: string; result: string }[] }[];
}
