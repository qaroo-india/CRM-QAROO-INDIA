/**
 * Shapes the API returns, shared so the client is typed against exactly what
 * the server sends. Money is always integer minor units; business dates are
 * 'YYYY-MM-DD'; instants are ISO strings.
 */

import type { AccountType, Role } from './constants/roles';
import type { DateRange } from './dates';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  /** Which application this person uses: back office, faculty, or student portal. */
  accountType: AccountType;
  /** The student record a student login belongs to. */
  studentId: string | null;
  /** The trainer record a faculty login belongs to. */
  trainerId: string | null;
  hasPhoto: boolean;
  permissions: string[];
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

export interface InstituteInfo {
  name: string;
  legalName: string | null;
  tagline: string | null;
  logoUrl: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  taxId: string | null;
  timezone: string;
  currency: string;
  locale: string;
  fiscalYearStartMonth: number;
  weekStartsOn: number;
  studentCodePrefix: string;
  admissionNumberPrefix: string;
  receiptNumberPrefix: string;
  leadCodePrefix: string;
  expenseCodePrefix: string;
  expenseApprovalRequired: boolean;
  dueReminderDays: number;
  unassignedAlertDays: number;
  reportRecipients: string[];
}

export interface SessionResponse {
  user: SessionUser;
  institute: InstituteInfo;
  csrfToken: string;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  accountType: AccountType;
  permissions: string[];
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  staffCode: string | null;
  designation: string | null;
  department: string | null;
  employmentType: string | null;
  joinedOn: string | null;
  specialisation: string | null;
  bio: string | null;
  hasPhoto: boolean;
  /** Set for faculty logins. */
  trainerId: string | null;
  /** Set for student logins. */
  studentId: string | null;
}

/** Minimal person reference for dropdowns (counsellors, coordinators). */
export interface UserOption {
  id: string;
  name: string;
  role: Role;
}

export interface LookupItem {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

export interface JobCategoryItem extends LookupItem {
  track: 'technical' | 'non_technical';
}

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  requestId: string | null;
  occurredAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/* ------------------------------------------------------------------ *
 * Academics (Milestone 3)
 * ------------------------------------------------------------------ */

export interface CourseDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  durationWeeks: number | null;
  standardFeeMinor: number;
  modules: string[];
  placementTrack: 'technical' | 'non_technical' | 'both' | null;
  defaultAdmissionFeeMinor: number | null;
  defaultInstalmentCount: number | null;
  isActive: boolean;
  activeAdmissions: number;
  createdAt: string;
}

export interface LeadDto {
  id: string;
  leadCode: string;
  name: string;
  phone: string;
  email: string | null;
  enquiryDate: string;
  leadSourceId: string;
  sourceName: string;
  campaignName: string | null;
  adReference: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  interestedCourseId: string | null;
  courseName: string | null;
  counsellorId: string | null;
  counsellorName: string | null;
  followUpDate: string | null;
  priority: 'low' | 'medium' | 'high';
  status: string;
  lostReason: string | null;
  notes: string | null;
  convertedOn: string | null;
  studentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadActivityDto {
  id: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  actorName: string | null;
  occurredAt: string;
}

export interface LeadDetail extends LeadDto {
  activities: LeadActivityDto[];
  admissionId: string | null;
}

export interface LeadBoardColumn {
  status: string;
  total: number;
  leads: LeadDto[];
}

export interface DuplicateMatch {
  kind: 'lead' | 'student';
  id: string;
  code: string;
  name: string;
  phone: string;
  email: string | null;
  status: string | null;
  matchedOn: ('phone' | 'email')[];
}

export interface StudentDto {
  id: string;
  studentCode: string;
  fullName: string;
  phone: string;
  email: string | null;
  address: string | null;
  city: string | null;
  dateOfBirth: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
  gender: string | null;
  qualification: string | null;
  yearOfPassing: number | null;
  state: string | null;
  pincode: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  status: string;
  /** Portal login, if one was given: whether it is active and when last used. */
  portal: { userId: string; isActive: boolean; lastLoginAt: string | null } | null;
  admissionCount: number;
  latestCourseName: string | null;
  outstandingMinor: number;
  createdAt: string;
}

/** Live balance of one admission, computed from the ledger. */
export interface AdmissionFinance {
  agreedFeeMinor: number;
  adjustmentsMinor: number;
  paidMinor: number;
  refundedMinor: number;
  netPaidMinor: number;
  outstandingMinor: number;
  overdueMinor: number;
}

export interface AdmissionDto extends AdmissionFinance {
  id: string;
  admissionNumber: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  studentPhone: string;
  leadId: string | null;
  attributedSourceId: string | null;
  sourceName: string | null;
  courseId: string;
  courseName: string;
  courseCode: string;
  admissionDate: string;
  listFeeMinor: number;
  discountMinor: number;
  admissionFeeRequiredMinor: number;
  counsellorId: string | null;
  counsellorName: string | null;
  status: string;
  batchStatus: string;
  notes: string | null;
  activatedOn: string | null;
  completedOn: string | null;
  withdrawnOn: string | null;
  cancelledOn: string | null;
  statusReason: string | null;
  hasActivePlan: boolean;
  createdAt: string;
}

export interface TimelineEvent {
  id: string;
  at: string;
  kind: string;
  title: string;
  detail: string | null;
  actorName: string | null;
  href: string | null;
}

export interface StudentProfile {
  student: StudentDto;
  admissions: AdmissionDto[];
  leads: LeadDto[];
  timeline: TimelineEvent[];
}

/* ------------------------------------------------------------------ *
 * Finance (Milestone 4)
 * ------------------------------------------------------------------ */

export interface InstalmentDto {
  id: string;
  feePlanId: string;
  admissionId: string;
  sequence: number;
  kind: string;
  dueDate: string;
  amountMinor: number;
  /** From allocations of succeeded receipts -- never stored. */
  paidMinor: number;
  remainingMinor: number;
  /** scheduled | partially_paid | paid | overdue | waived | cancelled */
  status: string;
  state: string;
}

export interface InstalmentRow extends InstalmentDto {
  studentId: string;
  studentName: string;
  studentCode: string;
  studentPhone: string;
  admissionNumber: string;
  courseName: string;
}

export interface FeePlanDto {
  id: string;
  admissionId: string;
  planType: string;
  totalMinor: number;
  admissionFeeMinor: number;
  instalmentCount: number;
  startDate: string;
  status: string;
  supersededAt: string | null;
  notes: string | null;
  createdAt: string;
  instalments: InstalmentDto[];
}

export interface AllocationDto {
  id: string;
  instalmentId: string | null;
  instalmentSequence: number | null;
  instalmentDueDate: string | null;
  amountMinor: number;
}

export interface PaymentDto {
  id: string;
  receiptNumber: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  admissionId: string;
  admissionNumber: string;
  courseName: string;
  paymentDate: string;
  amountMinor: number;
  direction: 'in' | 'refund';
  paymentType: string;
  method: string;
  referenceNumber: string | null;
  notes: string | null;
  status: string;
  reversedAt: string | null;
  reversalReason: string | null;
  reversedByName: string | null;
  refundOfId: string | null;
  recordedByName: string | null;
  createdAt: string;
  allocations: AllocationDto[];
}

export interface PaymentListSummary {
  count: number;
  grossMinor: number;
  refundsMinor: number;
  netMinor: number;
  reversedCount: number;
}

export interface PaymentList extends Paginated<PaymentDto> {
  summary: PaymentListSummary;
}

/** Receipt view: the payment plus the admission's balance after it. */
export interface ReceiptDto {
  payment: PaymentDto;
  institute: InstituteInfo;
  agreedFeeMinor: number;
  totalReceivedMinor: number;
  balanceAfterMinor: number;
  amountInWords: string;
}

export interface FeeAdjustmentDto {
  id: string;
  admissionId: string;
  type: string;
  amountMinor: number;
  effectiveDate: string;
  reason: string;
  approvedByName: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
}

export interface LoanDisbursementDto {
  id: string;
  disbursedOn: string;
  amountMinor: number;
  reference: string | null;
  notes: string | null;
  paymentId: string | null;
  receiptNumber: string | null;
  /** True when the linked receipt succeeded: the money actually arrived. */
  received: boolean;
  createdAt: string;
}

export interface LoanDto {
  id: string;
  admissionId: string;
  admissionNumber: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  courseName: string;
  financeType: 'internal_instalment' | 'external_loan';
  providerName: string;
  applicationReference: string | null;
  requestedMinor: number;
  approvedMinor: number | null;
  disbursedMinor: number;
  receivedMinor: number;
  status: string;
  disbursementStatus: 'not_applicable' | 'awaiting_disbursement' | 'partially_disbursed' | 'fully_disbursed';
  appliedOn: string | null;
  decisionOn: string | null;
  rejectionReason: string | null;
  notes: string | null;
  createdAt: string;
}

export interface LoanDetail extends LoanDto {
  disbursements: LoanDisbursementDto[];
  history: { at: string; summary: string; actorName: string | null }[];
}

export interface LoanSummary {
  byStatus: { status: string; count: number; requestedMinor: number }[];
  requestedMinor: number;
  approvedMinor: number;
  disbursedMinor: number;
  receivedMinor: number;
  pendingApplications: number;
  byProvider: { providerName: string; count: number; approvedMinor: number; receivedMinor: number }[];
}

export interface AdmissionFinanceView {
  admission: AdmissionDto;
  activePlan: FeePlanDto | null;
  previousPlans: FeePlanDto[];
  payments: PaymentDto[];
  adjustments: FeeAdjustmentDto[];
  loans: LoanDto[];
}

/* ------------------------------------------------------------------ *
 * Expenses and delivery (Milestone 5)
 * ------------------------------------------------------------------ */

export interface ExpenseDto {
  id: string;
  expenseCode: string;
  expenseDate: string;
  categoryId: string;
  categoryName: string;
  description: string;
  amountMinor: number;
  paymentMethod: string;
  payee: string | null;
  referenceNumber: string | null;
  receiptDocumentId: string | null;
  approvalStatus: string;
  approvedByName: string | null;
  rejectionReason: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  recordedByName: string | null;
  createdAt: string;
}

export interface ExpenseList extends Paginated<ExpenseDto> {
  summary: {
    /** Recorded or approved, not voided: what counts as spent. */
    totalMinor: number;
    pendingCount: number;
    pendingMinor: number;
    byCategory: { categoryId: string; categoryName: string; totalMinor: number; count: number }[];
  };
}

export interface TrainerDto {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  expertise: string | null;
  isActive: boolean;
  activeBatches: number;
  /** Faculty login, if one was given. */
  portal: { userId: string; isActive: boolean; lastLoginAt: string | null } | null;
}

export interface BatchDto {
  id: string;
  batchCode: string;
  name: string;
  courseId: string;
  courseName: string;
  trainerId: string | null;
  trainerName: string | null;
  startDate: string;
  endDate: string | null;
  capacity: number;
  enrolled: number;
  seatsLeft: number;
  schedule: string | null;
  status: string;
  notes: string | null;
}

export interface AssignmentDto {
  id: string;
  admissionId: string;
  admissionNumber: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  studentPhone: string;
  batchId: string;
  batchCode: string;
  batchName: string;
  status: string;
  assignedOn: string;
  endedOn: string | null;
  reason: string | null;
  transferredToId: string | null;
  assignedByName: string | null;
}

export interface BatchDetail extends BatchDto {
  roster: AssignmentDto[];
  history: AssignmentDto[];
}

export interface QueueItem {
  admissionId: string;
  admissionNumber: string;
  studentId: string;
  studentName: string;
  studentPhone: string;
  courseId: string;
  courseName: string;
  admissionDate: string;
  admissionStatus: string;
  batchStatus: string;
  daysWaiting: number;
  openBatches: { id: string; batchCode: string; name: string; startDate: string; seatsLeft: number }[];
}

/* ------------------------------------------------------------------ *
 * Placement (Milestone 6)
 * ------------------------------------------------------------------ */

export interface PlacementProfileDto {
  id: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  studentPhone: string;
  admissionId: string;
  admissionNumber: string;
  courseName: string;
  track: 'technical' | 'non_technical';
  stage: string;
  eligibleOn: string | null;
  resumeStatus: string;
  skills: string[];
  readinessScore: number | null;
  coordinatorId: string | null;
  coordinatorName: string | null;
  notes: string | null;
  applications: number;
  interviewsUpcoming: number;
  placed: boolean;
  stageChangedAt: string | null;
}

export interface InterviewDto {
  id: string;
  applicationId: string;
  roundNumber: number;
  roundName: string;
  scheduledAt: string;
  mode: string;
  result: string;
  feedback: string | null;
}

export interface ApplicationDto {
  id: string;
  profileId: string;
  studentId: string;
  studentName: string;
  track: 'technical' | 'non_technical';
  companyId: string;
  companyName: string;
  jobTitle: string;
  jobCategoryId: string | null;
  jobCategoryName: string | null;
  location: string | null;
  appliedOn: string;
  source: string | null;
  jobDescriptionRef: string | null;
  outcome: string;
  rejectionReason: string | null;
  offerPackageMinor: number | null;
  offerOn: string | null;
  joiningOn: string | null;
  notes: string | null;
  interviews: InterviewDto[];
}

export interface PlacementProfileDetail extends PlacementProfileDto {
  applicationsList: ApplicationDto[];
}

export interface CompanyDto {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  applications: number;
  joined: number;
}

export interface PlacementFunnel {
  /** Became eligible in the period (the cohort). */
  eligible: number;
  /** Opted out (withdrawn / not seeking): removed from the rate's denominator. */
  excluded: number;
  ready: number;
  applied: number;
  interviewed: number;
  /** Unique students with at least one offer. */
  offered: number;
  /** Unique students who joined -- the only "placed". */
  joined: number;
  /** joined / (eligible - excluded); null when the denominator is zero. */
  placementRate: number | null;
}

export interface PlacementAnalytics {
  range: DateRange;
  funnel: PlacementFunnel;
  byTrack: ({ track: 'technical' | 'non_technical' } & PlacementFunnel)[];
  byCourse: ({ courseId: string; courseName: string } & PlacementFunnel)[];
  byCompany: { companyId: string; companyName: string; applications: number; offers: number; joined: number }[];
  /** Joins per month by joining date, within the range. */
  monthlyJoined: { month: string; technical: number; nonTechnical: number }[];
  /** Activity dated inside the range, regardless of cohort. */
  activity: { applications: number; interviews: number; offers: number; joined: number };
}

/* ------------------------------------------------------------------ *
 * Reports and dashboard
 * ------------------------------------------------------------------ */

/** A figure for the period and the comparison period (null when not comparable). */
export interface Metric {
  current: number;
  previous: number | null;
}

export interface ReportFilterEcho {
  courseId: string | null;
  courseName: string | null;
  leadSourceId: string | null;
  leadSourceName: string | null;
  counsellorId: string | null;
  counsellorName: string | null;
}

export interface ReportFinanceSummary {
  /** Succeeded incoming receipts dated in the period. */
  collectedMinor: Metric;
  /** Succeeded refunds dated in the period. */
  refundedMinor: Metric;
  /** collected - refunded. */
  netCollectedMinor: Metric;
  receipts: Metric;
  /** Counted expenses (recorded or approved, not voided). Null while a course/source/counsellor filter is on. */
  expensesMinor: Metric | null;
  /** net collected - expenses. Null while a dimension filter is on. */
  netCashFlowMinor: Metric | null;
  /** Owed at the end of `asOf` by admissions made on or before it. */
  outstandingMinor: number;
  /** Instalments unpaid at the end of `asOf` that fell due before it. */
  overdueMinor: number;
  /** Fees agreed on admissions made in the period. */
  agreedFeeMinor: Metric;
}

export interface ReportSummary {
  /** Enquiries dated in the period. */
  leads: Metric;
  /** Of those enquiries, how many converted by the period's end (cohort). */
  convertedLeads: Metric;
  /** convertedLeads / leads; null when there were no leads. */
  conversionRate: { current: number | null; previous: number | null };
  /** Admissions dated in the period, excluding cancelled ones. */
  admissions: Metric;
  /** Unique students who joined a job in the period. */
  placementsJoined: Metric;
  finance: ReportFinanceSummary | null;
}

export interface ReportSourceRow {
  leadSourceId: string;
  name: string;
  leads: number;
  converted: number;
  conversionRate: number | null;
  admissions: number;
  collectedMinor: number | null;
}

export interface ReportCourseRow {
  courseId: string;
  name: string;
  leads: number;
  admissions: number;
  agreedFeeMinor: number | null;
  collectedMinor: number | null;
  outstandingMinor: number | null;
}

export interface ReportCounsellorRow {
  userId: string | null;
  name: string;
  leads: number;
  converted: number;
  conversionRate: number | null;
  admissions: number;
  collectedMinor: number | null;
}

export interface ReportAdmissionRow {
  admissionNumber: string;
  admissionDate: string;
  studentName: string;
  studentPhone: string;
  courseName: string;
  sourceName: string | null;
  counsellorName: string | null;
  status: string;
  agreedFeeMinor: number | null;
  paidMinor: number | null;
  outstandingMinor: number | null;
}

export interface ReportPaymentRow {
  receiptNumber: string;
  paymentDate: string;
  studentName: string;
  admissionNumber: string;
  courseName: string;
  direction: 'in' | 'refund';
  method: string;
  paymentType: string;
  /** Signed: refunds are negative so a column sum is the net collection. */
  amountMinor: number;
}

export interface ReportExpenseRow {
  expenseCode: string;
  expenseDate: string;
  categoryName: string;
  description: string;
  payee: string | null;
  method: string;
  amountMinor: number;
}

export type AgeingBucket = 'not_due' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';

export interface ReportDataset {
  generatedAt: string;
  timeZone: string;
  label: string;
  range: DateRange;
  previous: DateRange;
  /** Balances are as of the end of this day (the period end, capped at today). */
  asOf: string;
  bucket: 'day' | 'week' | 'month';
  filters: ReportFilterEcho;
  /** False when the viewer lacks reports:financial -- money sections are null. */
  includesFinance: boolean;
  summary: ReportSummary;
  trend: { key: string; leads: number; admissions: number }[];
  cashTrend: { key: string; collectedMinor: number; refundedMinor: number; expensesMinor: number | null }[] | null;
  sources: ReportSourceRow[];
  courses: ReportCourseRow[];
  counsellors: ReportCounsellorRow[];
  paymentMethods: { method: string; receipts: number; amountMinor: number }[] | null;
  expenseCategories: { categoryId: string; name: string; count: number; amountMinor: number }[] | null;
  ageing: { bucket: AgeingBucket; amountMinor: number }[] | null;
  placements: { track: 'technical' | 'non_technical'; eligible: number; offered: number; joined: number; placementRate: number | null }[];
  admissionRows: ReportAdmissionRow[];
  paymentRows: ReportPaymentRow[] | null;
  expenseRows: ReportExpenseRow[] | null;
  /** Row lists are capped; the totals above always cover everything. */
  truncated: { admissions: boolean; payments: boolean; expenses: boolean };
}

export interface DashboardBatchProgress {
  id: string;
  batchCode: string;
  name: string;
  courseName: string;
  status: string;
  startDate: string;
  endDate: string | null;
  capacity: number;
  enrolled: number;
  /** Share of the calendar elapsed, 0..1; null without an end date. */
  progress: number | null;
}

export interface DashboardData extends ReportDataset {
  /** Live counts, independent of the period. */
  live: {
    activeStudents: number;
    pendingPaymentAdmissions: number;
    unassignedStudents: number;
    followUpsDueToday: number;
    overdueFollowUps: number;
    openLeads: number;
    instalmentsDueThisWeek: number | null;
    overdueInstalments: number | null;
    pendingExpenseApprovals: number | null;
    activeLoans: number | null;
  };
  /** The 12 months ending with the period. */
  monthly: { month: string; admissions: number; leads: number; netCollectedMinor: number | null }[];
  batches: DashboardBatchProgress[];
}

/* ------------------------------------------------------------------ *
 * Notifications, report jobs, documents, imports
 * ------------------------------------------------------------------ */

export interface NotificationDto {
  id: string;
  type: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  title: string;
  body: string | null;
  link: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface ReportDeliveryDto {
  id: string;
  recipients: string[];
  subject: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  lastError: string | null;
  /** 'smtp' when really sent; 'log' means development mode -- nothing left the server. */
  transport: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface ReportJobDto {
  id: string;
  reportType: string;
  format: 'pdf' | 'excel';
  params: Record<string, unknown>;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  fileName: string | null;
  sizeBytes: number | null;
  error: string | null;
  requestedByName: string | null;
  scheduleId: string | null;
  scheduleName: string | null;
  createdAt: string;
  finishedAt: string | null;
  downloadable: boolean;
  deliveries: ReportDeliveryDto[];
}

export interface ReportScheduleDto {
  id: string;
  name: string;
  reportType: string;
  format: 'pdf' | 'excel';
  cadence: 'daily' | 'weekly' | 'monthly';
  timeOfDay: string;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  recipients: string[];
  filters: { courseId?: string; leadSourceId?: string; counsellorId?: string };
  isActive: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
  createdByName: string | null;
}

export interface EmailStatusDto {
  transport: 'smtp' | 'log' | 'disabled' | 'test';
  /** False when nothing actually leaves the server. */
  delivers: boolean;
  from: string;
}

export interface DocumentDto {
  id: string;
  ownerType: string;
  ownerId: string;
  ownerLabel: string | null;
  kind: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  accessLevel: 'general' | 'restricted';
  uploadedByName: string | null;
  createdAt: string;
}

export interface ImportRowResult {
  /** 1-based row number in the uploaded sheet (after the header). */
  row: number;
  data: Record<string, unknown>;
  errors: { field: string; message: string }[];
  /** Existing records or earlier rows with the same phone/email. */
  duplicates: { kind: 'existing' | 'in_file'; label: string }[];
}

export interface ImportPreview {
  token: string;
  entity: 'leads' | 'students';
  fileName: string;
  expiresAt: string;
  columns: string[];
  rows: ImportRowResult[];
  summary: { total: number; valid: number; invalid: number; duplicates: number };
}

export interface ImportResult {
  created: number;
  skipped: number;
  /** Codes of the records created (lead or student codes). */
  codes: string[];
  /** Rows not imported and why (invalid, duplicate, or rejected on save). */
  failures: { row: number; message: string }[];
}
