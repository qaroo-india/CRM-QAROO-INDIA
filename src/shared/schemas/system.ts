/**
 * Notifications, documents and bulk import inputs.
 */

import { z } from 'zod';
import { DOCUMENT_ACCESS_LEVELS, DOCUMENT_OWNER_TYPES, NOTIFICATION_TYPES } from '../constants/domain';
import { idSchema, nonEmptyString, paginationSchema } from './common';

export const notificationListQuerySchema = paginationSchema.extend({
  unread: z.enum(['true', 'false']).optional(),
  type: z.enum(NOTIFICATION_TYPES).optional(),
});

export const documentListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  ownerType: z.enum(DOCUMENT_OWNER_TYPES).optional(),
  ownerId: z.string().trim().max(64).optional(),
  kind: z.string().trim().max(60).optional(),
  accessLevel: z.enum(DOCUMENT_ACCESS_LEVELS).optional(),
});

/** Multipart text fields that accompany an uploaded file. */
export const documentUploadSchema = z.object({
  ownerType: z.enum(DOCUMENT_OWNER_TYPES),
  /** Required except for institute-wide documents. */
  ownerId: idSchema.optional(),
  kind: nonEmptyString(60, 'Document type'),
  title: nonEmptyString(160, 'Title'),
  accessLevel: z.enum(DOCUMENT_ACCESS_LEVELS).default('general'),
});
export type DocumentUploadInput = z.input<typeof documentUploadSchema>;

export const documentDeleteSchema = z.object({
  reason: nonEmptyString(500, 'Reason'),
});

export const IMPORT_ENTITIES = ['leads', 'students'] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export const importCommitSchema = z.object({
  token: z.string().min(10).max(100),
  /** Row numbers from the preview to import; invalid rows are always skipped. */
  rows: z.array(z.number().int().min(1)).min(1, 'choose at least one row').max(5000),
  /** Import rows that match an existing record by phone or email. */
  allowDuplicates: z.boolean().default(false),
});

/** Suggested document types; free text is allowed too. */
export const DOCUMENT_KINDS = [
  'Identity proof',
  'Address proof',
  'Photograph',
  'Educational certificate',
  'Admission form',
  'Fee agreement',
  'Loan application',
  'Loan sanction letter',
  'Disbursement proof',
  'Expense receipt',
  'Offer letter',
  'Joining letter',
  'Resume',
  'Other',
] as const;
