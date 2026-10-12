/**
 * Post-admission fee adjustments: approved discounts, waivers and write-offs.
 * Each reduces what is owed from its effective date (so as-of reports stay
 * true) and can be voided -- never deleted -- with a reason.
 */

import { adjustmentSchema, formatMoney, reversalSchema, type FeeAdjustmentDto } from '@ims/shared';
import { desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '../../db';
import { feeAdjustments, users } from '../../db/schema';
import { recordAudit } from '../../services/audit';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { getAdmission, getAdmissionRow } from '../admissions/admissions.service';

const approver = alias(users, 'approver');

export function adjustmentsForAdmission(admissionId: string): FeeAdjustmentDto[] {
  return db
    .select({ adjustment: feeAdjustments, approvedByName: approver.name })
    .from(feeAdjustments)
    .leftJoin(approver, eq(approver.id, feeAdjustments.approvedById))
    .where(eq(feeAdjustments.admissionId, admissionId))
    .orderBy(desc(feeAdjustments.effectiveDate), desc(feeAdjustments.createdAt))
    .all()
    .map(({ adjustment: a, approvedByName }) => ({
      id: a.id,
      admissionId: a.admissionId,
      type: a.type,
      amountMinor: a.amountMinor,
      effectiveDate: a.effectiveDate,
      reason: a.reason,
      approvedByName,
      voidedAt: a.voidedAt?.toISOString() ?? null,
      voidReason: a.voidReason,
      createdAt: a.createdAt.toISOString(),
    }));
}

export function addAdjustment(ctx: RequestContext, admissionId: string, raw: unknown): FeeAdjustmentDto[] {
  const input = adjustmentSchema.parse(raw);
  db.transaction((tx) => {
    const admission = getAdmissionRow(admissionId, tx);
    if (admission.status === 'cancelled') throw ApiError.unprocessable('This admission is cancelled.', 'ADMISSION_CANCELLED');
    if (input.effectiveDate < admission.admissionDate) {
      throw ApiError.validation([{ path: 'effectiveDate', message: 'Cannot take effect before the admission date' }]);
    }
    const outstanding = getAdmission(admissionId, tx).outstandingMinor;
    if (input.amountMinor > outstanding) {
      throw ApiError.unprocessable(
        `An adjustment of ${formatMoney(input.amountMinor)} is more than the outstanding ${formatMoney(outstanding)}.`,
        'ADJUSTMENT_EXCEEDS_OUTSTANDING',
      );
    }
    const created = tx
      .insert(feeAdjustments)
      .values({ admissionId, ...input, approvedById: ctx.actorId || null, createdById: ctx.actorId || null })
      .returning()
      .get();
    recordAudit(tx, ctx, {
      action: 'approve',
      entityType: 'fee_adjustment',
      entityId: created.id,
      summary: `Approved ${input.type.replace(/_/g, ' ')} of ${formatMoney(input.amountMinor)} on ${admission.admissionNumber}: ${input.reason}`,
      after: created,
    });
  });
  return adjustmentsForAdmission(admissionId);
}

export function voidAdjustment(ctx: RequestContext, id: string, raw: unknown): FeeAdjustmentDto[] {
  const { reason } = reversalSchema.parse(raw);
  const adjustment = db.select().from(feeAdjustments).where(eq(feeAdjustments.id, id)).get();
  if (!adjustment) throw ApiError.notFound('Adjustment');
  if (adjustment.voidedAt) throw ApiError.conflict('This adjustment is already void.');
  db.transaction((tx) => {
    tx.update(feeAdjustments).set({ voidedAt: new Date(), voidReason: reason }).where(eq(feeAdjustments.id, id)).run();
    recordAudit(tx, ctx, {
      action: 'void',
      entityType: 'fee_adjustment',
      entityId: id,
      summary: `Voided ${adjustment.type.replace(/_/g, ' ')} of ${formatMoney(adjustment.amountMinor)}: ${reason}`,
      before: { voidedAt: null },
      after: { voidReason: reason },
    });
  });
  return adjustmentsForAdmission(adjustment.admissionId);
}
