/**
 * The app's navigation, in one place. Sidebar, mobile menu, command palette
 * and the post-login landing page all derive from this list.
 *
 * What a person sees depends on who signed in:
 *   - team (owner, office staff): the back office, filtered by permission,
 *     with the person's own work first: a counsellor starts with enquiries
 *     and admissions, office staff with fees and payments;
 *   - faculty: a teaching workspace (their batches, classes, attendance,
 *     exams, material) plus tasks, leave and requests;
 *   - student: the student portal only.
 * The server enforces the same rules on every route independently -- hiding
 * a link is convenience, never security.
 */

import { JOB_ROLE_LABELS, type AccountType, type JobRole, type Permission } from '@ims/shared';
import {
  Award,
  Banknote,
  Bell,
  BookOpen,
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FileStack,
  FolderOpen,
  GraduationCap,
  HandCoins,
  History,
  House,
  Landmark,
  LayoutDashboard,
  LineChart,
  ListChecks,
  Megaphone,
  Package,
  PlaneTakeoff,
  Receipt,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Required permission; omitted = anyone who can see the section. */
  permission?: Permission;
  /** Which kinds of account see it. Omitted = team and faculty. */
  audience?: readonly AccountType[];
  /** Extra words the command palette matches on. */
  keywords?: string[];
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

const TEAM: readonly AccountType[] = ['team'];
const FACULTY: readonly AccountType[] = ['faculty'];

export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Executive dashboard', to: '/', icon: LayoutDashboard, permission: 'reports:read', audience: TEAM, keywords: ['home', 'kpi', 'overview'] },
      { label: 'My teaching', to: '/', icon: House, audience: FACULTY, keywords: ['home', 'today', 'faculty'] },
    ],
  },
  {
    label: 'Growth',
    items: [
      { label: 'Enquiries & leads', to: '/leads', icon: Megaphone, permission: 'leads:read', audience: TEAM, keywords: ['crm', 'pipeline', 'kanban', 'follow up'] },
      { label: 'Students', to: '/students', icon: UsersRound, permission: 'students:read', audience: TEAM, keywords: ['learners', 'profile'] },
      { label: 'Admissions', to: '/admissions', icon: ClipboardList, permission: 'admissions:read', audience: TEAM, keywords: ['enrolment', 'register'] },
      { label: 'Courses', to: '/courses', icon: BookOpen, permission: 'courses:read', audience: TEAM, keywords: ['programs', 'catalogue'] },
    ],
  },
  {
    label: 'Finance',
    items: [
      { label: 'Fees & payments', to: '/payments', icon: Receipt, permission: 'payments:read', audience: TEAM, keywords: ['receipts', 'collections', 'refund'] },
      { label: 'Instalment plans', to: '/instalments', icon: CalendarClock, permission: 'feePlans:read', audience: TEAM, keywords: ['due', 'overdue', 'schedule'] },
      { label: 'Loans & financing', to: '/loans', icon: Landmark, permission: 'loans:read', audience: TEAM, keywords: ['finance', 'emi', 'disbursement'] },
      { label: 'Expenses', to: '/expenses', icon: HandCoins, permission: 'expenses:read', audience: TEAM, keywords: ['spend', 'costs', 'bills'] },
    ],
  },
  {
    label: 'Teaching',
    items: [
      { label: 'Batches & trainers', to: '/batches', icon: GraduationCap, permission: 'batches:read', keywords: ['classes', 'roster', 'queue'] },
      { label: 'Class schedule', to: '/schedule', icon: CalendarDays, permission: 'schedule:read', keywords: ['timetable', 'lectures', 'sessions'] },
      { label: 'Attendance', to: '/attendance', icon: CalendarCheck, permission: 'attendance:read', keywords: ['register', 'present', 'absent'] },
      { label: 'Exams', to: '/exams', icon: ClipboardCheck, permission: 'exams:read', keywords: ['tests', 'assessment', 'results', 'marks'] },
      { label: 'Study material', to: '/materials', icon: FolderOpen, permission: 'materials:read', keywords: ['notes', 'slides', 'videos'] },
      { label: 'Certificates', to: '/certificates', icon: Award, permission: 'certificates:read', audience: TEAM, keywords: ['completion', 'issue'] },
    ],
  },
  {
    label: 'Placement',
    items: [
      { label: 'Technical placement', to: '/placements/technical', icon: BriefcaseBusiness, permission: 'placements:read', audience: TEAM, keywords: ['jobs', 'interviews', 'it'] },
      { label: 'Non-technical placement', to: '/placements/non-technical', icon: Banknote, permission: 'placements:read', audience: TEAM, keywords: ['jobs', 'hr', 'sales'] },
      { label: 'Placement drives', to: '/drives', icon: Sparkles, permission: 'placements:read', audience: TEAM, keywords: ['hiring', 'campus', 'recruitment'] },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { label: 'Reports & analytics', to: '/reports', icon: LineChart, permission: 'reports:read', audience: TEAM, keywords: ['pdf', 'excel', 'email', 'daily', 'monthly'] },
      { label: 'Document center', to: '/documents', icon: FileStack, permission: 'documents:read', audience: TEAM, keywords: ['files', 'uploads'] },
    ],
  },
  {
    label: 'Workplace',
    items: [
      { label: 'Notifications', to: '/notifications', icon: Bell, keywords: ['alerts', 'reminders'] },
      { label: 'Tasks', to: '/tasks', icon: ListChecks, keywords: ['to do', 'assignments', 'work'] },
      { label: 'Leave', to: '/leave', icon: PlaneTakeoff, keywords: ['holiday', 'time off', 'absence'] },
      { label: 'Inventory & assets', to: '/inventory', icon: Package, keywords: ['laptop', 'equipment', 'request', 'stock'] },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Staff & permissions', to: '/staff', icon: ShieldCheck, permission: 'users:read', audience: TEAM, keywords: ['users', 'roles', 'access', 'faculty'] },
      { label: 'Audit history', to: '/audit', icon: History, permission: 'audit:read', audience: TEAM, keywords: ['log', 'changes', 'who'] },
      { label: 'Institute settings', to: '/settings', icon: Settings, permission: 'settings:read', audience: TEAM, keywords: ['configuration', 'lead sources', 'categories'] },
    ],
  },
];

/** The student portal: everything is the signed-in student's own. */
export const STUDENT_NAV_SECTIONS: NavSection[] = [
  {
    label: 'My studies',
    items: [
      { label: 'Overview', to: '/portal', icon: House, audience: ['student'], keywords: ['home', 'dashboard'] },
      { label: 'Classes', to: '/portal/classes', icon: CalendarDays, audience: ['student'], keywords: ['timetable', 'schedule'] },
      { label: 'Attendance', to: '/portal/attendance', icon: CalendarCheck, audience: ['student'], keywords: ['present', 'absent'] },
      { label: 'Exams & results', to: '/portal/exams', icon: BookOpenCheck, audience: ['student'], keywords: ['tests', 'marks', 'score'] },
      { label: 'Study material', to: '/portal/materials', icon: FolderOpen, audience: ['student'], keywords: ['notes', 'slides', 'videos'] },
    ],
  },
  {
    label: 'My account',
    items: [
      { label: 'Fees & receipts', to: '/portal/fees', icon: Receipt, audience: ['student'], keywords: ['payments', 'due', 'instalments'] },
      { label: 'Certificates', to: '/portal/certificates', icon: Award, audience: ['student'], keywords: ['completion'] },
      { label: 'Placement', to: '/portal/placements', icon: BriefcaseBusiness, audience: ['student'], keywords: ['jobs', 'drives', 'interviews'] },
      { label: 'Notifications', to: '/notifications', icon: Bell, audience: ['student'], keywords: ['alerts'] },
      { label: 'My profile', to: '/account', icon: UserRound, audience: ['student'], keywords: ['password'] },
    ],
  },
];

export const ALL_NAV_ITEMS = [...NAV_SECTIONS, ...STUDENT_NAV_SECTIONS].flatMap((s) => s.items);

type Can = (permission: Permission) => boolean;

export interface Viewer {
  accountType: AccountType;
  /** Office job role; orders the menu and picks the landing page. */
  jobRole?: JobRole | null;
  can: Can;
}

/** The section each office job role works in most, moved to the top. */
const SECTION_FIRST: Record<JobRole, string> = {
  counsellor: 'Growth',
  office_staff: 'Finance',
};

/** What to call the signed-in person's role (account menu, staff list). */
export function roleLabel(user: { role: string; accountType: AccountType; jobRole?: JobRole | null }): string {
  if (user.accountType === 'student') return 'Student';
  if (user.accountType === 'faculty') return 'Faculty';
  if (user.role === 'owner') return 'Owner / Admin';
  return user.jobRole ? JOB_ROLE_LABELS[user.jobRole] : 'Staff';
}

const DEFAULT_AUDIENCE: readonly AccountType[] = ['team', 'faculty'];

function allowed(item: NavItem, viewer: Viewer): boolean {
  return (item.audience ?? DEFAULT_AUDIENCE).includes(viewer.accountType) && (!item.permission || viewer.can(item.permission));
}

export function visibleSections(viewer: Viewer): NavSection[] {
  const source = viewer.accountType === 'student' ? STUDENT_NAV_SECTIONS : NAV_SECTIONS;
  const sections = source
    .map((section) => ({ ...section, items: section.items.filter((item) => allowed(item, viewer)) }))
    .filter((section) => section.items.length > 0);
  const first = viewer.accountType === 'team' && viewer.jobRole ? SECTION_FIRST[viewer.jobRole] : undefined;
  const at = first ? sections.findIndex((s) => s.label === first) : -1;
  if (at <= 0) return sections;
  // Overview (the dashboard, when permitted) stays on top; the role's own section follows it.
  const top = sections[0]!.label === 'Overview' ? 1 : 0;
  if (at === top) return sections;
  const reordered = [...sections];
  const [own] = reordered.splice(at, 1);
  reordered.splice(top, 0, own!);
  return reordered;
}

export function visibleItems(viewer: Viewer): NavItem[] {
  return visibleSections(viewer).flatMap((s) => s.items);
}

/** Where to land after sign-in: the first page of the person's own menu. */
export function firstAllowedPath(viewer: Viewer): string {
  if (viewer.accountType === 'student') return '/portal';
  if (viewer.accountType === 'faculty') return '/';
  return visibleItems(viewer)[0]?.to ?? '/notifications';
}

/** Quick-create actions (top bar "+" and command palette). */
export interface QuickAction {
  label: string;
  to: string;
  permission: Permission;
  icon: LucideIcon;
  audience?: readonly AccountType[];
}

export const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Add enquiry', to: '/leads?action=new', permission: 'leads:write', icon: Megaphone, audience: TEAM },
  { label: 'Register admission', to: '/admissions/new', permission: 'admissions:write', icon: ClipboardList, audience: TEAM },
  { label: 'Record payment', to: '/payments?action=new', permission: 'payments:write', icon: Receipt, audience: TEAM },
  { label: 'Add expense', to: '/expenses?action=new', permission: 'expenses:write', icon: HandCoins, audience: TEAM },
  { label: 'Assign batch', to: '/batches?tab=queue', permission: 'batches:assign', icon: GraduationCap, audience: TEAM },
  { label: 'Schedule a class', to: '/schedule?action=new', permission: 'schedule:write', icon: CalendarDays },
  { label: 'Take attendance', to: '/attendance', permission: 'attendance:write', icon: CalendarCheck },
  { label: 'Create an exam', to: '/exams?action=new', permission: 'exams:write', icon: ClipboardCheck },
  { label: 'Share material', to: '/materials?action=new', permission: 'materials:write', icon: FolderOpen },
  { label: 'Update placement', to: '/placements/technical', permission: 'placements:write', icon: BriefcaseBusiness, audience: TEAM },
  { label: 'Generate report', to: '/reports', permission: 'reports:read', icon: LineChart, audience: TEAM },
];

export function visibleQuickActions(viewer: Viewer): QuickAction[] {
  if (viewer.accountType === 'student') return [];
  return QUICK_ACTIONS.filter((a) => (a.audience ?? DEFAULT_AUDIENCE).includes(viewer.accountType) && viewer.can(a.permission));
}
