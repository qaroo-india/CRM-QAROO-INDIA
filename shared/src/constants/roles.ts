/**
 * Roles and permissions.
 *
 * Permissions are plain `resource:action` strings so they can be stored on a
 * user row, sent in a token, and checked by one middleware without a lookup
 * table. The owner role is deliberately NOT "every permission listed" -- it is
 * a wildcard, so adding a new permission never silently locks the owner out.
 */

export const ROLES = ['owner', 'staff'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner / Admin',
  staff: 'Staff',
};

/**
 * Who an account is for. It decides which application the person sees:
 *   team    -- owner and office staff: the full back office, by permission;
 *   faculty -- a trainer: only their own batches (enforced on the server);
 *   student -- the student portal only, scoped to their own records.
 * Kept separate from `role` (owner/staff), which governs administration.
 */
export const ACCOUNT_TYPES = ['team', 'faculty', 'student'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  team: 'Team member',
  faculty: 'Faculty',
  student: 'Student',
};

export const PERMISSIONS = [
  // Leads and CRM
  'leads:read',
  'leads:write',
  'leads:assign',
  'leads:export',

  // Students
  'students:read',
  'students:write',

  // Courses
  'courses:read',
  'courses:write',

  // Admissions
  'admissions:read',
  'admissions:write',
  'admissions:cancel',

  // Money -- recording a payment and reversing one are separate powers on
  // purpose, so a counsellor can take a fee but not undo one.
  'payments:read',
  'payments:write',
  'payments:reverse',
  'payments:refund',
  'feePlans:read',
  'feePlans:write',
  'discounts:approve',

  // Financing
  'loans:read',
  'loans:write',
  'loans:approve',
  'loans:disburse',

  // Delivery
  'batches:read',
  'batches:write',
  'batches:assign',

  // Placement
  'placements:read',
  'placements:write',
  'placements:offer',

  // Teaching: class schedule, attendance, exams, study material, certificates
  'schedule:read',
  'schedule:write',
  'attendance:read',
  'attendance:write',
  'exams:read',
  'exams:write',
  'materials:read',
  'materials:write',
  'certificates:read',
  'certificates:issue',

  // People operations. Every team member and faculty can request leave and
  // assets and work on their own tasks; these grant the management side.
  'leave:approve',
  'tasks:assign',
  'inventory:read',
  'inventory:write',
  'inventory:approve',

  // Give or remove student / faculty portal logins
  'portal:manage',

  // Expenses
  'expenses:read',
  'expenses:write',
  'expenses:approve',

  // Intelligence
  'reports:read',
  'reports:financial',
  'reports:export',
  'reports:email',

  // Documents -- 'restricted' guards loan paperwork and identity documents.
  'documents:read',
  'documents:write',
  'documents:restricted',

  // Bulk import of leads and students from CSV/Excel
  'data:import',

  // Administration
  'users:read',
  'users:write',
  'settings:read',
  'settings:write',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Wildcard held only by the owner role. */
export const ALL_PERMISSIONS = '*' as const;

/**
 * Default grants when a user is created. An owner gets the wildcard; staff get
 * a conservative read-mostly set that the owner widens per user. Nothing here
 * is authoritative at request time -- the server always re-reads the stored
 * grants, never trusts a client claim.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, readonly (Permission | typeof ALL_PERMISSIONS)[]> =
  {
    owner: [ALL_PERMISSIONS],
    staff: [
      'leads:read',
      'leads:write',
      'students:read',
      'students:write',
      'courses:read',
      'admissions:read',
      'admissions:write',
      'payments:read',
      'payments:write',
      'feePlans:read',
      'loans:read',
      'batches:read',
      'placements:read',
      'placements:write',
      'expenses:read',
      'reports:read',
      'documents:read',
      'documents:write',
    ],
  };

/**
 * Starting grants for a faculty login. The server additionally limits every
 * faculty request to the batches they teach, whatever is granted here.
 */
export const DEFAULT_FACULTY_PERMISSIONS: readonly Permission[] = [
  'batches:read',
  'schedule:read',
  'schedule:write',
  'attendance:read',
  'attendance:write',
  'exams:read',
  'exams:write',
  'materials:read',
  'materials:write',
];

/** True when `granted` satisfies `required`, honouring the owner wildcard. */
export function hasPermission(
  granted: readonly string[] | undefined,
  required: Permission,
): boolean {
  if (!granted || granted.length === 0) return false;
  return granted.includes(ALL_PERMISSIONS) || granted.includes(required);
}

/** True only when every required permission is satisfied. */
export function hasAllPermissions(
  granted: readonly string[] | undefined,
  required: readonly Permission[],
): boolean {
  return required.every((p) => hasPermission(granted, p));
}

/** True when at least one of the required permissions is satisfied. */
export function hasAnyPermission(
  granted: readonly string[] | undefined,
  required: readonly Permission[],
): boolean {
  return required.some((p) => hasPermission(granted, p));
}
