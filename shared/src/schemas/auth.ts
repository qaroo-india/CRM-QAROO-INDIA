/**
 * Authentication, staff accounts and institute settings.
 */

import { z } from 'zod';
import { EMPLOYMENT_TYPES } from '../constants/domain';
import { ACCOUNT_TYPES, PERMISSIONS, ROLES } from '../constants/roles';
import { dateOnlySchema, emailSchema, nonEmptyString, optionalString, phoneSchema } from './common';

/**
 * Length beats complexity (NIST SP 800-63B), but requiring one letter and one
 * digit stops the most common all-digit and dictionary choices.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Za-z]/, 'Password must include a letter')
  .regex(/\d/, 'Password must include a number');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(256),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ['newPassword'],
    message: 'New password must be different from the current one',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

const permissionList = z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length);

/** HR profile of a team or faculty member. Every field is optional. */
const nullableText = (max: number) =>
  z
    .union([z.literal(''), z.null(), z.string().trim().max(max)])
    .optional()
    .transform((v) => (v ? v : null));

export const staffProfileFields = {
  staffCode: z
    .union([z.literal(''), z.null(), z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,23}$/, 'Use 2-24 letters, digits or dashes')])
    .optional()
    .transform((v) => (v ? v : null)),
  designation: nullableText(80),
  department: nullableText(80),
  employmentType: z
    .union([z.literal(''), z.null(), z.enum(EMPLOYMENT_TYPES)])
    .optional()
    .transform((v) => (v ? v : null)),
  joinedOn: z
    .union([z.literal(''), z.null(), dateOnlySchema])
    .optional()
    .transform((v) => (v ? v : null)),
  specialisation: nullableText(500),
  bio: nullableText(2000),
};

export const staffProfileSchema = z.object(staffProfileFields);
export type StaffProfileInput = z.input<typeof staffProfileSchema>;

export const createUserSchema = z.object({
  name: nonEmptyString(120, 'Name'),
  email: emailSchema,
  phone: phoneSchema.optional(),
  role: z.enum(ROLES),
  permissions: permissionList.default([]),
  temporaryPassword: passwordSchema,
  ...staffProfileFields,
});
export type CreateUserInput = z.input<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    name: nonEmptyString(120, 'Name'),
    phone: phoneSchema.nullable(),
    role: z.enum(ROLES),
    permissions: permissionList,
    ...staffProfileFields,
  })
  .partial();
export type UpdateUserInput = z.input<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({ temporaryPassword: passwordSchema });

export const userListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(ROLES).optional(),
  active: z.enum(['true', 'false']).optional(),
  accountType: z.enum(ACCOUNT_TYPES).optional(),
});

/* ------------------------------------------------------------------ *
 * Self-service: forgot password and portal activation
 * ------------------------------------------------------------------ */

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const tokenPasswordSchema = z.object({
  token: z.string().trim().min(20, 'This link is incomplete').max(200),
  newPassword: passwordSchema,
});
export type TokenPasswordInput = z.infer<typeof tokenPasswordSchema>;

/** A student claims their portal login with the email the institute holds. */
export const activationRequestSchema = z.object({ email: emailSchema });

/** Staff give a student or trainer a portal login with a one-time password. */
export const portalAccessSchema = z.object({ temporaryPassword: passwordSchema });

/* ------------------------------------------------------------------ *
 * Institute settings and lookups
 * ------------------------------------------------------------------ */

const prefix = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2,6}$/, 'Use 2-6 letters');

export const updateSettingsSchema = z
  .object({
    name: nonEmptyString(200, 'Institute name'),
    legalName: optionalString(200).nullable(),
    tagline: optionalString(200).nullable(),
    logoUrl: z.url().max(500).nullable().or(z.literal('').transform(() => null)),
    email: emailSchema.nullable().or(z.literal('').transform(() => null)),
    phone: optionalString(40).nullable(),
    website: optionalString(200).nullable(),
    address: optionalString(500).nullable(),
    taxId: optionalString(40).nullable(),
    fiscalYearStartMonth: z.number().int().min(1).max(12),
    weekStartsOn: z.number().int().min(0).max(6),
    studentCodePrefix: prefix,
    admissionNumberPrefix: prefix,
    receiptNumberPrefix: prefix,
    leadCodePrefix: prefix,
    expenseCodePrefix: prefix,
    expenseApprovalRequired: z.boolean(),
    dueReminderDays: z.number().int().min(0).max(30),
    unassignedAlertDays: z.number().int().min(1).max(90),
    reportRecipients: z.array(emailSchema).max(20),
  })
  .partial();
export type UpdateSettingsInput = z.input<typeof updateSettingsSchema>;

export const lookupCreateSchema = z.object({
  name: nonEmptyString(80, 'Name'),
  isActive: z.boolean().default(true),
});

export const lookupUpdateSchema = z
  .object({
    name: nonEmptyString(80, 'Name'),
    isActive: z.boolean(),
  })
  .partial();

export const reorderSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});
