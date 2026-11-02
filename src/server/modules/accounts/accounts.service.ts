/**
 * Account self-service and portal logins.
 *
 *   Forgot password    -- emailed single-use link, 30 minutes.
 *   Student activation -- a student whose email the institute already holds
 *                         can claim a portal login; the link goes to that
 *                         address, so only its owner can complete it (24 h).
 *   Portal access      -- staff give a student or trainer a login with a
 *                         one-time password that must be changed at first
 *                         sign-in, and can switch it off again.
 *
 * Requests never reveal whether an email exists: the answer is the same
 * either way, and the work happens only when it should.
 */

import { createHash, randomBytes } from 'node:crypto';
import {
  activationRequestSchema,
  DEFAULT_FACULTY_PERMISSIONS,
  forgotPasswordSchema,
  portalAccessSchema,
  tokenPasswordSchema,
} from '@ims/shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { env, isProduction } from '../../config/env';
import { logger } from '../../config/logger';
import { db } from '../../db';
import { admissions, passwordTokens, students, trainers, users, type User } from '../../db/schema';
import { recordAudit } from '../../services/audit';
import { mailTransportName, sendMail } from '../../services/mailer';
import { getSettings } from '../../services/settings';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { hashPassword } from '../auth/password';
import { revokeAllForUser } from '../auth/tokens';
import { PORTAL_BLOCKED_STUDENT_STATUSES } from '../users/serialize';

const RESET_TTL_MS = 30 * 60_000;
const ACTIVATE_TTL_MS = 24 * 60 * 60_000;
/** At most this many emailed links per account per hour. */
const LINKS_PER_HOUR = 3;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

interface ClientMeta {
  ip?: string;
}

function linkFor(purpose: 'reset' | 'activate', token: string): string {
  const base = env.APP_URL.replace(/\/+$/, '');
  return `${base}/reset-password?token=${encodeURIComponent(token)}${purpose === 'activate' ? '&activate=1' : ''}`;
}

async function recentLinks(userId: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60_000);
  return (await db.select({ n: sql<number>`count(*)` }).from(passwordTokens).where(and(eq(passwordTokens.userId, userId), gt(passwordTokens.createdAt, since))).get())?.n ?? 0;
}

/** Create a token (retiring older unused ones of the same purpose) and email the link. */
async function issueLink(user: Pick<User, 'id' | 'email' | 'name'>, purpose: 'reset' | 'activate', meta: ClientMeta): Promise<void> {
  if (Number(await recentLinks(user.id)) >= LINKS_PER_HOUR) {
    logger.warn({ userId: user.id, purpose }, 'Password link not sent: hourly limit reached');
    return;
  }
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(passwordTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordTokens.userId, user.id), eq(passwordTokens.purpose, purpose), isNull(passwordTokens.usedAt)))
      .run();
    await tx.insert(passwordTokens)
      .values({ userId: user.id, purpose, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + (purpose === 'reset' ? RESET_TTL_MS : ACTIVATE_TTL_MS)), requestedIp: meta.ip ?? null })
      .run();
  });

  const institute = getSettings().name;
  const link = linkFor(purpose, token);
  const subject = purpose === 'reset' ? `Reset your ${institute} password` : `Activate your ${institute} student portal`;
  const lines =
    purpose === 'reset'
      ? [`Hello ${user.name},`, '', 'We received a request to reset your password. Open this link to choose a new one (valid for 30 minutes):', link, '', 'If you did not ask for this, ignore this email; your password stays the same.']
      : [`Hello ${user.name},`, '', 'Open this link to set a password for your student portal (valid for 24 hours):', link, '', 'If you did not ask for this, ignore this email.'];
  try {
    await sendMail({ to: [user.email], subject, text: lines.join('\n') });
    // EMAIL_TRANSPORT=log sends nothing; in development, show the link so the
    // flow can still be tested. Production refuses to start with "log".
    if (!isProduction && mailTransportName() === 'log') {
      logger.info({ to: user.email, link }, `DEVELOPMENT ONLY: ${purpose === 'reset' ? 'password reset' : 'activation'} link (email not sent)`);
    }
  } catch (error) {
    logger.warn({ err: error, userId: user.id, purpose }, 'Could not send the password email');
  }
}

export async function requestPasswordReset(raw: unknown, meta: ClientMeta): Promise<void> {
  const { email } = forgotPasswordSchema.parse(raw);
  const user = await db.select().from(users).where(eq(users.email, email)).get();
  if (!user || !user.isActive) return;
  await issueLink(user, 'reset', meta);
}

/** Student claims a portal login using the email on their student record. */
export async function requestStudentActivation(raw: unknown, meta: ClientMeta): Promise<void> {
  const { email } = activationRequestSchema.parse(raw);
  const student = await db.select().from(students).where(sql`lower(${students.email}) = ${email}`).get();
  if (!student || PORTAL_BLOCKED_STUDENT_STATUSES.includes(student.status)) return;

  if (student.userId) {
    const existing = await db.select().from(users).where(eq(users.id, student.userId)).get();
    if (!existing) return;
    // Already active: a reset link is what they need. Pending: send a fresh activation link.
    if (existing.isActive) return await issueLink(existing, 'reset', meta);
    const pending = !existing.lastLoginAt && !existing.passwordChangedAt;
    if (pending) await issueLink(existing, 'activate', meta);
    return; // switched off by staff: nothing to send
  }

  const admitted = await db.get<{ n: number }>(sql`select count(*) as n from admissions where student_id = ${student.id} and status <> 'cancelled'`);
  if (!admitted || Number(admitted.n) === 0) return;
  if (await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) return;

  const placeholder = await hashPassword(randomBytes(24).toString('base64url'));
  const user = await db.transaction(async (tx) => {
    const created = await tx
      .insert(users)
      .values({ name: student.fullName, email, phone: student.phone, passwordHash: placeholder, role: 'staff', accountType: 'student', permissions: [], isActive: false })
      .returning()
      .get();
    await tx.update(students).set({ userId: created.id }).where(eq(students.id, student.id)).run();
    await recordAudit(tx, { actorId: '', actorName: 'Student self-service', permissions: [], isOwner: false, ip: meta.ip }, {
      action: 'create',
      entityType: 'user',
      entityId: created.id,
      summary: `${student.fullName} (${student.studentCode}) requested a student portal login`,
    });
    return created;
  });
  await issueLink(user, 'activate', meta);
}

/** Complete a reset or an activation with the emailed token. */
export async function setPasswordWithToken(raw: unknown, meta: ClientMeta): Promise<{ email: string }> {
  const input = tokenPasswordSchema.parse(raw);
  const row = await db.select().from(passwordTokens).where(eq(passwordTokens.tokenHash, hashToken(input.token))).get();
  const invalid = () => ApiError.unprocessable('This link is invalid or has expired. Request a new one.', 'INVALID_TOKEN');
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) throw invalid();
  const user = await db.select().from(users).where(eq(users.id, row.userId)).get();
  if (!user) throw invalid();
  // A deactivated account cannot be brought back by a reset link.
  if (row.purpose === 'reset' && !user.isActive) throw invalid();

  const passwordHash = await hashPassword(input.newPassword);
  await db.transaction(async (tx) => {
    await tx.update(users)
      .set({
        passwordHash,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
        tokenVersion: sql`${users.tokenVersion} + 1`,
        ...(row.purpose === 'activate' && { isActive: true }),
      })
      .where(eq(users.id, user.id))
      .run();
    await tx.update(passwordTokens).set({ usedAt: new Date() }).where(eq(passwordTokens.id, row.id)).run();
    await revokeAllForUser(tx, user.id);
    await recordAudit(tx, { actorId: user.id, actorName: user.name, permissions: [], isOwner: false, ip: meta.ip }, {
      action: 'password_change',
      entityType: 'user',
      entityId: user.id,
      summary: row.purpose === 'activate' ? `${user.name} activated their portal login` : `${user.name} reset their password by email`,
    });
  });
  return { email: user.email };
}

/* ------------------------------------------------------------------ *
 * Staff-managed portal logins
 * ------------------------------------------------------------------ */

async function grantLogin(
  ctx: RequestContext,
  kind: 'student' | 'faculty',
  record: { id: string; name: string; email: string | null; phone: string | null; userId: string | null; label: string },
  raw: unknown,
): Promise<{ userId: string }> {
  const { temporaryPassword } = portalAccessSchema.parse(raw);
  if (!record.email) throw ApiError.unprocessable(`Add an email address to ${record.name} first: it is their sign-in name.`, 'EMAIL_REQUIRED');
  const email = record.email.trim().toLowerCase();
  const passwordHash = await hashPassword(temporaryPassword);

  if (record.userId) {
    const existing = await db.select().from(users).where(eq(users.id, record.userId)).get();
    if (existing?.isActive) throw ApiError.conflict(`${record.name} already has a login. Use "reset password" to issue a new one.`, 'ALREADY_HAS_LOGIN');
    if (existing) {
      await db.transaction(async (tx) => {
        await tx.update(users)
          .set({ isActive: true, passwordHash, mustChangePassword: true, email, failedLoginCount: 0, lockedUntil: null, tokenVersion: sql`${users.tokenVersion} + 1` })
          .where(eq(users.id, existing.id))
          .run();
        await revokeAllForUser(tx, existing.id);
        await recordAudit(tx, ctx, { action: 'status_change', entityType: 'user', entityId: existing.id, summary: `Restored the ${kind} login of ${record.label}` });
      });
      return { userId: existing.id };
    }
  }

  const clash = await db.select({ id: users.id, accountType: users.accountType }).from(users).where(eq(users.email, email)).get();
  if (clash) throw ApiError.conflict(`Another account already uses ${email}. Each login needs its own email address.`, 'EMAIL_IN_USE');

  const userId = await db.transaction(async (tx) => {
    const created = await tx
      .insert(users)
      .values({
        name: record.name,
        email,
        phone: record.phone,
        passwordHash,
        role: 'staff',
        accountType: kind,
        permissions: kind === 'faculty' ? [...DEFAULT_FACULTY_PERMISSIONS] : [],
        mustChangePassword: true,
        createdById: ctx.actorId || null,
      })
      .returning()
      .get();
    if (kind === 'student') await tx.update(students).set({ userId: created.id }).where(eq(students.id, record.id)).run();
    else await tx.update(trainers).set({ userId: created.id }).where(eq(trainers.id, record.id)).run();
    await recordAudit(tx, ctx, { action: 'create', entityType: 'user', entityId: created.id, summary: `Gave ${record.label} a ${kind === 'student' ? 'student portal' : 'faculty'} login (${email})` });
    return created.id;
  });
  return { userId };
}

export async function grantStudentPortal(ctx: RequestContext, studentId: string, raw: unknown) {
  const s = await db.select().from(students).where(eq(students.id, studentId)).get();
  if (!s) throw ApiError.notFound('Student');
  if (PORTAL_BLOCKED_STUDENT_STATUSES.includes(s.status)) {
    throw ApiError.unprocessable(`This student is ${s.status}. Set them back to active before giving portal access.`, 'STUDENT_NOT_ACTIVE');
  }
  const admitted = await db.select({ id: admissions.id }).from(admissions).where(and(eq(admissions.studentId, s.id), sql`${admissions.status} <> 'cancelled'`)).get();
  if (!admitted) throw ApiError.unprocessable('Only students with an admission can have a portal login.', 'NO_ADMISSION');
  return await grantLogin(ctx, 'student', { id: s.id, name: s.fullName, email: s.email, phone: s.phone, userId: s.userId, label: `${s.fullName} (${s.studentCode})` }, raw);
}

export async function grantFacultyLogin(ctx: RequestContext, trainerId: string, raw: unknown) {
  const t = await db.select().from(trainers).where(eq(trainers.id, trainerId)).get();
  if (!t) throw ApiError.notFound('Trainer');
  if (!t.isActive) throw ApiError.unprocessable('Reactivate the trainer before giving them a login.', 'TRAINER_INACTIVE');
  return await grantLogin(ctx, 'faculty', { id: t.id, name: t.name, email: t.email, phone: t.phone, userId: t.userId, label: t.name }, raw);
}

/** Switch a student or faculty login off. The link to the record is kept, so it can be restored. */
export async function revokePortalLogin(ctx: RequestContext, userId: string): Promise<void> {
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user || user.accountType === 'team') throw ApiError.notFound('Portal login');
  await db.transaction(async (tx) => {
    await tx.update(users).set({ isActive: false, tokenVersion: sql`${users.tokenVersion} + 1` }).where(eq(users.id, userId)).run();
    await revokeAllForUser(tx, userId);
    await recordAudit(tx, ctx, { action: 'status_change', entityType: 'user', entityId: userId, summary: `Switched off the ${user.accountType} login of ${user.name}` });
  });
}
