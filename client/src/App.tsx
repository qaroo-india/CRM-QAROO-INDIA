/**
 * Route table. Every feature page is lazy-loaded, so the first visit downloads
 * the shell and only the module being opened.
 *
 * Public:     /login, /status, /forgot-password, /activate, /reset-password,
 *             /verify/:reference (certificate check)
 * Signed in:  the back office (team and faculty), each page gated by the
 *             permission it needs, and /portal/* for students. The API
 *             enforces the same rules independently.
 */

import type { AccountType, Permission } from '@ims/shared';
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { createBrowserRouter, Outlet, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AppShell } from '@/app/AppShell';
import { AuthProvider } from '@/auth/AuthProvider';
import { HomeGate, RequireAccount, RequireAuth, RequirePermission } from '@/auth/guards';
import { LoginPage } from '@/auth/LoginPage';
import { ActivatePage, ForgotPasswordPage, ResetPasswordPage, VerifyCertificatePage } from '@/auth/SelfServicePages';
import { SystemStatusPage } from '@/features/system/SystemStatusPage';
import { NotFoundPage } from '@/routes/NotFoundPage';
import { RouteErrorPage } from '@/routes/RouteErrorPage';

function lazyPage<K extends string>(loader: () => Promise<Record<K, ComponentType>>, name: K): LazyExoticComponent<ComponentType> {
  return lazy(() => loader().then((module) => ({ default: module[name] })));
}

const DashboardPage = lazyPage(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage');
const LeadsPage = lazyPage(() => import('@/features/leads/LeadsPage'), 'LeadsPage');
const StudentsPage = lazyPage(() => import('@/features/students/StudentsPage'), 'StudentsPage');
const StudentProfilePage = lazyPage(() => import('@/features/students/StudentProfilePage'), 'StudentProfilePage');
const AdmissionsPage = lazyPage(() => import('@/features/admissions/AdmissionsPage'), 'AdmissionsPage');
const NewAdmissionPage = lazyPage(() => import('@/features/admissions/NewAdmissionPage'), 'NewAdmissionPage');
const CoursesPage = lazyPage(() => import('@/features/courses/CoursesPage'), 'CoursesPage');
const PaymentsPage = lazyPage(() => import('@/features/payments/PaymentsPage'), 'PaymentsPage');
const InstalmentsPage = lazyPage(() => import('@/features/payments/InstalmentsPage'), 'InstalmentsPage');
const LoansPage = lazyPage(() => import('@/features/loans/LoansPage'), 'LoansPage');
const ExpensesPage = lazyPage(() => import('@/features/expenses/ExpensesPage'), 'ExpensesPage');
const BatchesPage = lazyPage(() => import('@/features/batches/BatchesPage'), 'BatchesPage');
const BatchDetailPage = lazyPage(() => import('@/features/batches/BatchDetailPage'), 'BatchDetailPage');
const PlacementsPage = lazyPage(() => import('@/features/placements/PlacementsPage'), 'PlacementsPage');
const ReportsPage = lazyPage(() => import('@/features/reports/ReportsPage'), 'ReportsPage');
const NotificationsPage = lazyPage(() => import('@/features/notifications/NotificationsPage'), 'NotificationsPage');
const DocumentsPage = lazyPage(() => import('@/features/documents/DocumentsPage'), 'DocumentsPage');
const StaffPage = lazyPage(() => import('@/features/staff/StaffPage'), 'StaffPage');
const AuditPage = lazyPage(() => import('@/features/audit/AuditPage'), 'AuditPage');
const SettingsPage = lazyPage(() => import('@/features/settings/SettingsPage'), 'SettingsPage');
const AccountPage = lazyPage(() => import('@/features/account/AccountPage'), 'AccountPage');
const FacultyHome = lazyPage(() => import('@/features/faculty/FacultyHome'), 'FacultyHome');
const SchedulePage = lazyPage(() => import('@/features/schedule/SchedulePage'), 'SchedulePage');
const AttendancePage = lazyPage(() => import('@/features/attendance/AttendancePage'), 'AttendancePage');
const ExamsPage = lazyPage(() => import('@/features/exams/ExamsPages'), 'ExamsPage');
const ExamDetailPage = lazyPage(() => import('@/features/exams/ExamsPages'), 'ExamDetailPage');
const MaterialsPage = lazyPage(() => import('@/features/materials/MaterialsPage'), 'MaterialsPage');
const CertificatesPage = lazyPage(() => import('@/features/certificates/CertificatesPage'), 'CertificatesPage');
const DrivesPage = lazyPage(() => import('@/features/drives/DrivesPage'), 'DrivesPage');
const TasksPage = lazyPage(() => import('@/features/workplace/TasksPage'), 'TasksPage');
const LeavePage = lazyPage(() => import('@/features/workplace/LeavePage'), 'LeavePage');
const InventoryPage = lazyPage(() => import('@/features/workplace/InventoryPage'), 'InventoryPage');
const PortalOverviewPage = lazyPage(() => import('@/features/portal/PortalPages'), 'PortalOverviewPage');
const PortalClassesPage = lazyPage(() => import('@/features/portal/PortalPages'), 'PortalClassesPage');
const PortalAttendancePage = lazyPage(() => import('@/features/portal/PortalPages'), 'PortalAttendancePage');
const PortalFeesPage = lazyPage(() => import('@/features/portal/PortalPages'), 'PortalFeesPage');
const PortalMaterialsPage = lazyPage(() => import('@/features/portal/PortalPages'), 'PortalMaterialsPage');
const PortalCertificatesPage = lazyPage(() => import('@/features/portal/PortalPages'), 'PortalCertificatesPage');
const PortalPlacementsPage = lazyPage(() => import('@/features/portal/PortalPages'), 'PortalPlacementsPage');
const PortalExamsPage = lazyPage(() => import('@/features/portal/ExamPortal'), 'PortalExamsPage');
const PortalAttemptPage = lazyPage(() => import('@/features/portal/ExamPortal'), 'PortalAttemptPage');

function gated(permission: Permission, Page: ComponentType) {
  return (
    <RequirePermission permission={permission}>
      <Page />
    </RequirePermission>
  );
}

const BACK_OFFICE: AccountType[] = ['team', 'faculty'];

/** Back-office pages every staff login may open (no single permission). */
function staffOnly(Page: ComponentType) {
  return (
    <RequireAccount types={BACK_OFFICE}>
      <Page />
    </RequireAccount>
  );
}

function RootLayout() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/status', element: <SystemStatusPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/activate', element: <ActivatePage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/verify', element: <VerifyCertificatePage /> },
      { path: '/verify/:reference', element: <VerifyCertificatePage /> },
      {
        element: (
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        ),
        children: [
          {
            index: true,
            element: (
              <HomeGate faculty={<FacultyHome />}>
                <DashboardPage />
              </HomeGate>
            ),
          },
          { path: 'leads', element: gated('leads:read', LeadsPage) },
          { path: 'students', element: gated('students:read', StudentsPage) },
          { path: 'students/:id', element: gated('students:read', StudentProfilePage) },
          { path: 'admissions', element: gated('admissions:read', AdmissionsPage) },
          { path: 'admissions/new', element: gated('admissions:write', NewAdmissionPage) },
          { path: 'courses', element: gated('courses:read', CoursesPage) },
          { path: 'payments', element: gated('payments:read', PaymentsPage) },
          { path: 'instalments', element: gated('feePlans:read', InstalmentsPage) },
          { path: 'loans', element: gated('loans:read', LoansPage) },
          { path: 'expenses', element: gated('expenses:read', ExpensesPage) },
          { path: 'batches', element: gated('batches:read', BatchesPage) },
          { path: 'batches/:id', element: gated('batches:read', BatchDetailPage) },
          { path: 'schedule', element: gated('schedule:read', SchedulePage) },
          { path: 'attendance', element: gated('attendance:read', AttendancePage) },
          { path: 'exams', element: gated('exams:read', ExamsPage) },
          { path: 'exams/:id', element: gated('exams:read', ExamDetailPage) },
          { path: 'materials', element: gated('materials:read', MaterialsPage) },
          { path: 'certificates', element: gated('certificates:read', CertificatesPage) },
          { path: 'placements/:track', element: gated('placements:read', PlacementsPage) },
          { path: 'drives', element: gated('placements:read', DrivesPage) },
          { path: 'reports', element: gated('reports:read', ReportsPage) },
          { path: 'notifications', element: <NotificationsPage /> },
          { path: 'tasks', element: staffOnly(TasksPage) },
          { path: 'leave', element: staffOnly(LeavePage) },
          { path: 'inventory', element: staffOnly(InventoryPage) },
          { path: 'documents', element: gated('documents:read', DocumentsPage) },
          { path: 'staff', element: gated('users:read', StaffPage) },
          { path: 'audit', element: gated('audit:read', AuditPage) },
          { path: 'settings', element: gated('settings:read', SettingsPage) },
          { path: 'account', element: <AccountPage /> },
          {
            path: 'portal',
            element: (
              <RequireAccount types={['student']}>
                <Outlet />
              </RequireAccount>
            ),
            children: [
              { index: true, element: <PortalOverviewPage /> },
              { path: 'classes', element: <PortalClassesPage /> },
              { path: 'attendance', element: <PortalAttendancePage /> },
              { path: 'exams', element: <PortalExamsPage /> },
              { path: 'attempts/:attemptId', element: <PortalAttemptPage /> },
              { path: 'materials', element: <PortalMaterialsPage /> },
              { path: 'fees', element: <PortalFeesPage /> },
              { path: 'certificates', element: <PortalCertificatesPage /> },
              { path: 'placements', element: <PortalPlacementsPage /> },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

const router = createBrowserRouter(routes);

export function App() {
  return <RouterProvider router={router} />;
}
