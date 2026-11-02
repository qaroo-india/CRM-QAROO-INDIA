import { PERMISSIONS, type Permission } from '@ims/shared';

const GROUP_LABELS: Record<string, string> = {
  leads: 'Enquiries & leads',
  students: 'Students',
  courses: 'Courses',
  admissions: 'Admissions',
  payments: 'Payments',
  feePlans: 'Instalment plans',
  discounts: 'Discounts',
  loans: 'Loans & financing',
  batches: 'Batches',
  placements: 'Placement',
  expenses: 'Expenses',
  reports: 'Reports',
  documents: 'Documents',
  data: 'Data import',
  users: 'Staff accounts',
  settings: 'Settings',
  audit: 'Audit history',
};

const ACTION_LABELS: Record<string, string> = {
  read: 'View',
  write: 'Create & edit',
  assign: 'Assign',
  export: 'Export',
  cancel: 'Cancel',
  reverse: 'Reverse receipts',
  refund: 'Issue refunds',
  approve: 'Approve',
  disburse: 'Record disbursements',
  offer: 'Record offers',
  financial: 'Financial figures',
  email: 'Email reports',
  restricted: 'Restricted files',
  import: 'Bulk import',
};

export interface PermissionGroup {
  key: string;
  label: string;
  permissions: { value: Permission; label: string }[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = Object.entries(
  PERMISSIONS.reduce<Record<string, Permission[]>>((groups, permission) => {
    const [resource] = permission.split(':') as [string];
    (groups[resource] ??= []).push(permission);
    return groups;
  }, {}),
).map(([key, permissions]) => ({
  key,
  label: GROUP_LABELS[key] ?? key,
  permissions: permissions.map((value) => ({ value, label: ACTION_LABELS[value.split(':')[1]!] ?? value })),
}));

/** A readable random password that satisfies the policy (letters + digits, 14 chars). */
export function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]!);
  // Guarantee at least one digit and one letter.
  chars[3] = String(2 + (bytes[3]! % 8));
  chars[9] = 'K';
  return `${chars.slice(0, 7).join('')}-${chars.slice(7).join('')}`;
}
