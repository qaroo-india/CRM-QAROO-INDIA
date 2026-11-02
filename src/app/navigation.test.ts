import { DEFAULT_FACULTY_PERMISSIONS, hasPermission, JOB_ROLE_PERMISSIONS, type AccountType, type JobRole, type Permission } from '@ims/shared';
import { describe, expect, it } from 'vitest';
import { firstAllowedPath, roleLabel, visibleItems, visibleQuickActions, visibleSections } from './navigation';

const viewer = (accountType: AccountType, granted: readonly string[], jobRole: JobRole | null = null) => ({ accountType, jobRole, can: (permission: Permission) => hasPermission(granted, permission) });
const labels = (v: ReturnType<typeof viewer>) => visibleItems(v).map((i) => i.label);

describe('navigation follows who signed in', () => {
  it('shows an owner the whole back office, and no student pages', () => {
    const items = labels(viewer('team', ['*']));
    expect(items).toContain('Executive dashboard');
    expect(items).toContain('Attendance');
    expect(items).toContain('Placement drives');
    expect(items).toContain('Inventory & assets');
    expect(items).not.toContain('My teaching');
    expect(items).not.toContain('Fees & receipts');
  });

  it('shows staff only what they may open, dropping empty groups', () => {
    const sections = visibleSections(viewer('team', ['leads:read', 'payments:read']));
    const items = sections.flatMap((s) => s.items.map((i) => i.label));
    expect(items).toEqual(['Enquiries & leads', 'Fees & payments', 'Notifications', 'Tasks', 'Leave', 'Inventory & assets']);
    expect(sections.map((s) => s.label)).not.toContain('Administration');
  });

  it('gives faculty a teaching workspace without office pages', () => {
    const items = labels(viewer('faculty', DEFAULT_FACULTY_PERMISSIONS));
    expect(items).toEqual(['My teaching', 'Batches & trainers', 'Class schedule', 'Attendance', 'Exams', 'Study material', 'Notifications', 'Tasks', 'Leave', 'Inventory & assets']);
    // Even a wrongly granted office permission does not surface office pages.
    expect(labels(viewer('faculty', ['payments:read', 'reports:read']))).not.toContain('Fees & payments');
    expect(visibleQuickActions(viewer('faculty', DEFAULT_FACULTY_PERMISSIONS)).map((a) => a.label)).toEqual(['Schedule a class', 'Take attendance', 'Create an exam', 'Share material']);
  });

  it('gives students only their portal', () => {
    const items = labels(viewer('student', []));
    expect(items).toEqual(['Overview', 'Classes', 'Attendance', 'Exams & results', 'Study material', 'Fees & receipts', 'Certificates', 'Placement', 'Notifications', 'My profile']);
    expect(visibleQuickActions(viewer('student', ['*']))).toEqual([]);
  });

  it('gives a counsellor an enquiries-and-admissions menu that opens on Enquiries', () => {
    const counsellor = viewer('team', JOB_ROLE_PERMISSIONS.counsellor, 'counsellor');
    const sections = visibleSections(counsellor);
    expect(sections[0]!.label).toBe('Growth');
    expect(sections[0]!.items.map((i) => i.label)).toEqual(['Enquiries & leads', 'Students', 'Admissions', 'Courses']);
    const items = labels(counsellor);
    expect(items).not.toContain('Fees & payments');
    expect(items).not.toContain('Expenses');
    expect(items).not.toContain('Executive dashboard');
    expect(firstAllowedPath(counsellor)).toBe('/leads');
  });

  it('gives office staff a fees-first menu that opens on Fees & payments', () => {
    const office = viewer('team', JOB_ROLE_PERMISSIONS.office_staff, 'office_staff');
    const sections = visibleSections(office);
    expect(sections[0]!.label).toBe('Finance');
    expect(sections[0]!.items.map((i) => i.label)).toEqual(['Fees & payments', 'Instalment plans', 'Loans & financing', 'Expenses']);
    const items = labels(office);
    expect(items).not.toContain('Enquiries & leads');
    expect(items).toEqual(expect.arrayContaining(['Students', 'Batches & trainers', 'Class schedule', 'Certificates', 'Inventory & assets']));
    expect(firstAllowedPath(office)).toBe('/payments');
  });

  it('keeps the dashboard on top for an admin, and names every role', () => {
    const admin = viewer('team', ['*']);
    expect(visibleSections(admin)[0]!.label).toBe('Overview');
    expect(firstAllowedPath(admin)).toBe('/');
    // A job role never hides the dashboard from someone allowed to see it.
    expect(visibleSections(viewer('team', ['reports:read', 'payments:read'], 'office_staff')).map((s) => s.label).slice(0, 2)).toEqual(['Overview', 'Finance']);
    expect(roleLabel({ role: 'owner', accountType: 'team' })).toBe('Owner / Admin');
    expect(roleLabel({ role: 'staff', accountType: 'team', jobRole: 'counsellor' })).toBe('Counsellor');
    expect(roleLabel({ role: 'staff', accountType: 'team', jobRole: 'office_staff' })).toBe('Office staff');
    expect(roleLabel({ role: 'staff', accountType: 'team', jobRole: null })).toBe('Staff');
    expect(roleLabel({ role: 'staff', accountType: 'faculty' })).toBe('Faculty');
    expect(roleLabel({ role: 'staff', accountType: 'student' })).toBe('Student');
  });

  it('lands each kind of account on its home', () => {
    expect(firstAllowedPath(viewer('team', ['payments:read']))).toBe('/payments');
    expect(firstAllowedPath(viewer('team', ['reports:read']))).toBe('/');
    expect(firstAllowedPath(viewer('team', []))).toBe('/notifications');
    expect(firstAllowedPath(viewer('faculty', []))).toBe('/');
    expect(firstAllowedPath(viewer('student', []))).toBe('/portal');
  });
});
