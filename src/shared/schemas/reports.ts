/**
 * Report, dashboard, export and schedule inputs.
 *
 * The dashboard and every report, PDF, Excel file and scheduled email are
 * built from ONE query shape, so a number on screen and the same number in an
 * export cannot disagree because they were filtered differently.
 */

import { z } from 'zod';
import { REPORT_FORMATS, REPORT_PERIODS, SCHEDULE_CADENCES } from '../constants/domain';
import { REPORT_TYPES } from '../dates';
import { dateOnlySchema, emailSchema, idSchema, nonEmptyString, optionalString } from './common';

/** Dimension filters shared by the dashboard, reports and schedules. */
export const reportDimensionsSchema = z.object({
  courseId: idSchema.optional(),
  leadSourceId: idSchema.optional(),
  counsellorId: idSchema.optional(),
});

/**
 * Either a dashboard-style rolling `period` ("this month so far") or a
 * report-style `type` around a `reference` day ("the full month containing
 * 12 Oct"). `from`/`to` are required only for the custom variants; the
 * service raises a 422 when they are missing or reversed.
 */
export const reportQuerySchema = reportDimensionsSchema.extend({
  period: z.enum(REPORT_PERIODS).optional(),
  type: z.enum(REPORT_TYPES).optional(),
  reference: dateOnlySchema.optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const reportExportQuerySchema = reportQuerySchema.extend({
  format: z.enum(REPORT_FORMATS),
});

const recipientsSchema = z
  .array(emailSchema)
  .min(1, 'add at least one recipient')
  .max(20, 'at most 20 recipients')
  .transform((list) => [...new Set(list)]);

export const reportEmailSchema = reportQuerySchema.extend({
  format: z.enum(REPORT_FORMATS),
  recipients: recipientsSchema,
  subject: optionalString(200),
  message: optionalString(2000),
});
export type ReportEmailInput = z.input<typeof reportEmailSchema>;

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a time like 08:30');

/**
 * A recurring emailed report. A daily schedule sends the previous day; a
 * weekly one the previous week; a monthly one the previous month -- always a
 * complete period, never a partial one.
 */
export const reportScheduleSchema = z
  .object({
    name: nonEmptyString(120, 'Name'),
    format: z.enum(REPORT_FORMATS),
    cadence: z.enum(SCHEDULE_CADENCES),
    timeOfDay: timeOfDaySchema,
    dayOfWeek: z.coerce.number().int().min(0).max(6).nullable().optional(),
    dayOfMonth: z.coerce.number().int().min(1).max(28).nullable().optional(),
    recipients: recipientsSchema,
    filters: reportDimensionsSchema.default({}),
    isActive: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.cadence === 'weekly' && (value.dayOfWeek === null || value.dayOfWeek === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['dayOfWeek'], message: 'choose the day of the week' });
    }
    if (value.cadence === 'monthly' && (value.dayOfMonth === null || value.dayOfMonth === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'choose the day of the month (1-28)' });
    }
  });
export type ReportScheduleInput = z.input<typeof reportScheduleSchema>;
