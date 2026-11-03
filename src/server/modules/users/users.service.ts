/**
 * Staff accounts and their permissions.
 *
 * Two guard rails beyond the route permission checks:
 *   - No privilege escalation: a non-owner may only grant permissions they
 *     hold themselves, and only an owner may create or promote owners.
 *   - The institute can never lose its last active owner.
 */

import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  JOB_ROLE_PERMISSIONS,
  type CreateUserInput,
  type UpdateUserInput,
  type UserOption,
  type UserSummary,
  createUserSchema,
  updateUserSchema,
  userListQuerySchema,
} from '@ims/shared';
import { and, asc, count, eq, ne, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { db } from '../../db';
import { users, type User } from '../../db/schema';
import { diff, recordAudit } from '../../services/audit';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { containsText } from '../../utils/pagination';
import { hashPassword } from '../auth/password';
import { revokeAllForUser } from '../auth/tokens';
import { accountLinks, toUserSummary } from './serialize';

async function findUser(id: string): Promise<User> {
  const user = await db.select().from(users).where(eq(users.id, id)).get();
  if (!user) throw ApiError.notFound('User');
  return user;
}

async function activeOwnerCount(excludingId?: string): Promise<number> {
  const conditions = [eq(users.role, 'owner'), eq(users.isActive, true)];
  if (excludingId) conditions.push(ne(users.id, excludingId));
  return (await db.select({ n: count() }).from(users).where(and(...conditions)).get())?.n ?? 0;
}

function assertCanGrant(ctx: RequestContext, role: User['role'], permissions: readonly string[]): void {
  if (ctx.isOwner) return;
  if (role === 'owner') throw ApiError.forbidden('Only an owner can create or promote owners.');
  const missing = permissions.filter((p) => p !== ALL_PERMISSIONS && !ctx.permissions.includes(p));
  if (permissions.includes(ALL_PERMISSIONS) || missing.length > 0) {
    throw ApiError.forbidden(`You cannot grant permissions you do not hold: ${missing.join(', ') || '*'}`);
  }
}

/** Only the profile fields the caller actually sent (undefined = leave as is). */
function profileColumns(input: Partial<Record<'staffCode' | 'designation' | 'department' | 'employmentType' | 'joinedOn' | 'specialisation' | 'bio', string | null | undefined>>) {
  const out: Record<string, string | null> = {};
  for (const key of ['staffCode', 'designation', 'department', 'employmentType', 'joinedOn', 'specialisation', 'bio'] as const) {
    if (input[key] !== undefined) out[key] = input[key] ?? null;
  }
  return out as Partial<Pick<User, 'staffCode' | 'designation' | 'department' | 'employmentType' | 'joinedOn' | 'specialisation' | 'bio'>>;
}

export async function listUsers(query: z.output<typeof userListQuerySchema>): Promise<UserSummary[]> {
  const conditions: SQL[] = [];
  if (query.q) {
    conditions.push(or(containsText(users.name, query.q), containsText(users.email, query.q))!);
  }
  if (query.role) conditions.push(eq(users.role, query.role));
  if (query.active) conditions.push(eq(users.isActive, query.active === 'true'));
  // Student logins are managed from the student's profile, not the staff list.
  conditions.push(query.accountType ? eq(users.accountType, query.accountType) : sql`${users.accountType} <> 'student'`);

  return (await Promise.all((await db
    .select()
    .from(users)
    .where(and(...conditions))
    .orderBy(sql`${users.isActive} desc`, asc(users.name))
    .all())
    .map(async (u) => await toUserSummary(u))));
}

/** Active users for assignee dropdowns (counsellor, coordinator, recorded by). */
export async function userOptions(): Promise<UserOption[]> {
  return await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.isActive, true), sql`${users.accountType} <> 'student'`))
    .orderBy(asc(users.name))
    .all();
}

export async function getUser(id: string): Promise<UserSummary> {
  return await toUserSummary(await findUser(id));
}

export async function createUser(ctx: RequestContext, raw: CreateUserInput): Promise<UserSummary> {
  const input = createUserSchema.parse(raw);
  const jobRole = input.role === 'owner' ? null : input.jobRole;
  const permissions =
    input.role === 'owner'
      ? [ALL_PERMISSIONS]
      : input.permissions.length > 0
        ? input.permissions
        : [...((jobRole ? JOB_ROLE_PERMISSIONS[jobRole] : DEFAULT_ROLE_PERMISSIONS.staff) as readonly string[])];
  assertCanGrant(ctx, input.role, permissions);

  if (await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).get()) {
    throw ApiError.conflict('A user with this email already exists.');
  }

  const passwordHash = await hashPassword(input.temporaryPassword);

  return await db.transaction(async (tx) => {
    const created = await tx
      .insert(users)
      .values({
        name: input.name,
        email: input.email,
        phone: input.phone ?? null,
        role: input.role,
        jobRole,
        permissions,
        passwordHash,
        mustChangePassword: false,
        createdById: ctx.actorId || null,
        ...profileColumns(input),
      })
      .returning()
      .get();
    await recordAudit(tx, ctx, {
      action: 'create',
      entityType: 'user',
      entityId: created.id,
      summary: `Created ${created.role} account for ${created.name}`,
      after: { name: created.name, email: created.email, role: created.role, permissions },
    });
    return await toUserSummary(created, await accountLinks(created, tx));
  });
}

export async function updateUser(ctx: RequestContext, id: string, raw: UpdateUserInput): Promise<UserSummary> {
  const input = updateUserSchema.parse(raw);
  const user = await findUser(id);

  const nextRole = input.role ?? user.role;
  if (nextRole === 'owner' && user.accountType !== 'team') {
    throw ApiError.forbidden('Faculty and student logins cannot be made owners.');
  }
  const nextPermissions = nextRole === 'owner' ? [ALL_PERMISSIONS] : (input.permissions ?? user.permissions);
  // Job roles belong to office staff only; the owner is the admin.
  const nextJobRole = nextRole === 'owner' || user.accountType !== 'team' ? null : input.jobRole !== undefined ? input.jobRole : user.jobRole;

  if (input.role !== undefined || input.permissions !== undefined) {
    if (id === ctx.actorId && input.role && input.role !== user.role) {
      throw ApiError.forbidden('You cannot change your own role.');
    }
    assertCanGrant(ctx, nextRole, nextPermissions);
    if (!ctx.isOwner && user.role === 'owner') {
      throw ApiError.forbidden("Only an owner can change another owner's access.");
    }
    if (user.role === 'owner' && nextRole !== 'owner' && user.isActive && await activeOwnerCount(id) === 0) {
      throw ApiError.conflict('The institute must keep at least one active owner.');
    }
  }

  return await db.transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.phone !== undefined && { phone: input.phone }),
        role: nextRole,
        jobRole: nextJobRole,
        permissions: nextPermissions,
        ...profileColumns(input),
      })
      .where(eq(users.id, id))
      .returning()
      .get();
    const changes = diff(user as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>);
    await recordAudit(tx, ctx, {
      action: 'update',
      entityType: 'user',
      entityId: id,
      summary: `Updated ${updated.name}'s account`,
      ...changes,
    });
    return await toUserSummary(updated, await accountLinks(updated, tx));
  });
}

export async function setUserActive(ctx: RequestContext, id: string, active: boolean): Promise<UserSummary> {
  const user = await findUser(id);
  if (id === ctx.actorId && !active) throw ApiError.forbidden('You cannot deactivate your own account.');
  if (!ctx.isOwner && user.role === 'owner') throw ApiError.forbidden('Only an owner can change an owner account.');
  if (!active && user.role === 'owner' && await activeOwnerCount(id) === 0) {
    throw ApiError.conflict('The institute must keep at least one active owner.');
  }

  return await db.transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({
        isActive: active,
        // Deactivation ends every session immediately.
        ...(!active && { tokenVersion: sql`${users.tokenVersion} + 1` }),
      })
      .where(eq(users.id, id))
      .returning()
      .get();
    if (!active) await revokeAllForUser(tx, id);
    await recordAudit(tx, ctx, {
      action: 'status_change',
      entityType: 'user',
      entityId: id,
      summary: `${active ? 'Reactivated' : 'Deactivated'} ${user.name}`,
      before: { isActive: user.isActive },
      after: { isActive: active },
    });
    return await toUserSummary(updated, await accountLinks(updated, tx));
  });
}

export async function resetPassword(ctx: RequestContext, id: string, temporaryPassword: string): Promise<UserSummary> {
  const user = await findUser(id);
  if (!ctx.isOwner && user.role === 'owner') throw ApiError.forbidden('Only an owner can reset an owner password.');
  const passwordHash = await hashPassword(temporaryPassword);

  return await db.transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
        tokenVersion: sql`${users.tokenVersion} + 1`,
      })
      .where(eq(users.id, id))
      .returning()
      .get();
    await revokeAllForUser(tx, id);
    await recordAudit(tx, ctx, {
      action: 'password_change',
      entityType: 'user',
      entityId: id,
      summary: `Issued a temporary password to ${user.name}`,
    });
    return await toUserSummary(updated, await accountLinks(updated, tx));
  });
}
