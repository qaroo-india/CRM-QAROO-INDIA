import { DEFAULT_FACULTY_PERMISSIONS, hasPermission, type AccountType, type Permission } from '@ims/shared';
import { describe, expect, it } from 'vitest';
import { firstAllowedPath, visibleItems, visibleQuickActions, visibleSections } from './navigation';

const viewer = (accountType: AccountType, granted: readonly string[]) => ({ accountType, can: (permission: Permission) => hasPermission(granted, permission) });
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

  it('lands each kind of account on its home', () => {
    expect(firstAllowedPath(viewer('team', ['payments:read']))).toBe('/payments');
    expect(firstAllowedPath(viewer('team', ['reports:read']))).toBe('/');
    expect(firstAllowedPath(viewer('team', []))).toBe('/notifications');
    expect(firstAllowedPath(viewer('faculty', []))).toBe('/');
    expect(firstAllowedPath(viewer('student', []))).toBe('/portal');
  });
});
