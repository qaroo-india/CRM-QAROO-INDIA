/**
 * People operations for team and faculty accounts.
 *
 * Leave     -- anyone requests; holders of leave:approve decide (never their
 *              own). Overlapping requests are refused.
 * Tasks     -- anyone keeps their own list; tasks:assign hands work to others.
 * Inventory -- an asset register. Lending an asset takes it out of the
 *              available stock until it is returned; a consumable is used
 *              up instead. Stock can never go negative (the schema refuses).
 */

import {
  diffDays,
  hasPermission,
  inventoryDecisionSchema,
  inventoryItemSchema,
  inventoryRequestSchema,
  leaveDecisionSchema,
  leaveRequestSchema,
  taskSchema,
  taskStatusSchema,
  type InventoryItemDto,
  type InventoryRequestDto,
  type LeaveDto,
  type TaskDto,
  type inventoryListQuerySchema,
  type inventoryRequestListQuerySchema,
  type leaveListQuerySchema,
  type taskListQuerySchema,
} from '@ims/shared';
import { and, asc, count, desc, eq, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';
import { db } from '../../db';
import { qualified } from '../../db/dialect';
import { batches, inventoryItems, inventoryRequests, leaveRequests, tasks, users, type InventoryItem, type Task } from '../../db/schema';
import { recordAudit } from '../../services/audit';
import { instituteToday } from '../../services/clock';
import { newKey, readStoredFile, saveFile } from '../../services/storage';
import { ApiError } from '../../utils/ApiError';
import type { RequestContext } from '../../utils/context';
import { containsText, pageWindow, paginated } from '../../utils/pagination';
import { assertBatchInScope } from '../../utils/scope';
import { checkFile, type UploadedFile } from '../documents/documents.service';
import { notifyPermission, notifyUsers, safely } from '../notifications/notifications.service';

const reviewer = alias(users, 'reviewer');
const requester = alias(users, 'requester');
const assignee = alias(users, 'assignee');
const creator = alias(users, 'creator');

/* ================================================================== *
 * Leave
 * ================================================================== */

function leaveQuery() {
  return db
    .select({ l: leaveRequests, userName: requester.name, accountType: requester.accountType, reviewedByName: reviewer.name })
    .from(leaveRequests)
    .innerJoin(requester, eq(requester.id, leaveRequests.userId))
    .leftJoin(reviewer, eq(reviewer.id, leaveRequests.reviewedById));
}

function toLeaveDto(r: Awaited<ReturnType<ReturnType<typeof leaveQuery>['all']>>[number]): LeaveDto {
  const l = r.l;
  return {
    id: l.id,
    userId: l.userId,
    userName: r.userName,
    accountType: r.accountType,
    type: l.type,
    startDate: l.startDate,
    endDate: l.endDate,
    dayCount: l.dayCount,
    reason: l.reason,
    status: l.status,
    reviewedByName: r.reviewedByName,
    reviewedAt: l.reviewedAt?.toISOString() ?? null,
    reviewNote: l.reviewNote,
    createdAt: l.createdAt.toISOString(),
  };
}

function getLeave(id: string): LeaveDto {
  const row = leaveQuery().where(eq(leaveRequests.id, id)).get();
  if (!row) throw ApiError.notFound('Leave request');
  return toLeaveDto(row);
}

export function requestLeave(ctx: RequestContext, raw: unknown): LeaveDto {
  const input = leaveRequestSchema.parse(raw);
  const clash = db
    .select({ id: leaveRequests.id, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate })
    .from(leaveRequests)
    .where(and(eq(leaveRequests.userId, ctx.actorId), inArray(leaveRequests.status, ['pending', 'approved']), sql`${leaveRequests.startDate} <= ${input.endDate} and ${leaveRequests.endDate} >= ${input.startDate}`))
    .get();
  if (clash) throw ApiError.conflict(`You already have leave from ${clash.startDate} to ${clash.endDate}.`, 'LEAVE_OVERLAP');
  const id = db.transaction((tx) => {
    const row = tx
      .insert(leaveRequests)
      .values({ userId: ctx.actorId, type: input.type, startDate: input.startDate, endDate: input.endDate, dayCount: diffDays(input.startDate, input.endDate) + 1, reason: input.reason ?? null })
      .returning()
      .get();
    recordAudit(tx, ctx, { action: 'create', entityType: 'leave_request', entityId: row.id, summary: `Requested ${input.type} leave ${input.startDate} to ${input.endDate}` });
    return row.id;
  });
  safely('leave_request', () => {
    notifyPermission('leave:approve', { type: 'leave_request', title: `${ctx.actorName} requested ${input.type} leave`, body: `${input.startDate} to ${input.endDate}`, link: '/leave?scope=team&status=pending', entityType: 'leave_request', entityId: id, dedupeKey: `leave_request:${id}` }, { except: ctx.actorId });
  });
  return getLeave(id);
}

export function listLeave(ctx: RequestContext, q: z.output<typeof leaveListQuerySchema>) {
  if (q.scope === 'team' && !hasPermission(ctx.permissions, 'leave:approve')) throw ApiError.forbidden('Viewing team leave needs the leave approval permission.');
  const conditions: (SQL | undefined)[] = [q.scope === 'mine' ? eq(leaveRequests.userId, ctx.actorId) : undefined];
  if (q.status?.length) conditions.push(inArray(leaveRequests.status, q.status));
  if (q.userId && q.scope === 'team') conditions.push(eq(leaveRequests.userId, q.userId));
  if (q.from) conditions.push(sql`${leaveRequests.endDate} >= ${q.from}`);
  if (q.to) conditions.push(sql`${leaveRequests.startDate} <= ${q.to}`);
  const where = and(...conditions);
  const total = db.select({ n: count() }).from(leaveRequests).where(where).get()?.n ?? 0;
  const { limit, offset } = pageWindow(q.page, q.limit);
  return paginated(leaveQuery().where(where).orderBy(desc(leaveRequests.startDate)).limit(limit).offset(offset).all().map(toLeaveDto), total, q.page, q.limit);
}

export function decideLeave(ctx: RequestContext, id: string, raw: unknown): LeaveDto {
  const leave = db.select().from(leaveRequests).where(eq(leaveRequests.id, id)).get();
  if (!leave) throw ApiError.notFound('Leave request');
  if (leave.userId === ctx.actorId && !ctx.isOwner) throw ApiError.forbidden('You cannot decide your own leave.');
  if (leave.status !== 'pending') throw ApiError.conflict(`This request is already ${leave.status}.`, 'ALREADY_DECIDED');
  const input = leaveDecisionSchema.parse(raw);
  const status = input.decision === 'approve' ? 'approved' : 'rejected';
  db.transaction((tx) => {
    tx.update(leaveRequests).set({ status, reviewedById: ctx.actorId, reviewedAt: new Date(), reviewNote: input.reviewNote ?? null }).where(eq(leaveRequests.id, id)).run();
    recordAudit(tx, ctx, { action: input.decision, entityType: 'leave_request', entityId: id, summary: `${status === 'approved' ? 'Approved' : 'Rejected'} leave ${leave.startDate} to ${leave.endDate}${input.reviewNote ? ` (${input.reviewNote})` : ''}` });
  });
  safely('leave_decision', () => {
    notifyUsers([leave.userId], { type: 'leave_decision', severity: status === 'approved' ? 'success' : 'warning', title: `Your leave ${leave.startDate} to ${leave.endDate} was ${status}`, body: input.reviewNote ?? null, link: '/leave', entityType: 'leave_request', entityId: id, dedupeKey: `leave_decision:${id}` });
  });
  return getLeave(id);
}

export function cancelLeave(ctx: RequestContext, id: string): LeaveDto {
  const leave = db.select().from(leaveRequests).where(eq(leaveRequests.id, id)).get();
  if (!leave || leave.userId !== ctx.actorId) throw ApiError.notFound('Leave request');
  if (leave.status === 'cancelled' || leave.status === 'rejected') throw ApiError.conflict(`This request is already ${leave.status}.`, 'ALREADY_DECIDED');
  if (leave.status === 'approved' && leave.startDate <= instituteToday()) throw ApiError.conflict('Leave that has started cannot be cancelled here; ask your manager.', 'ALREADY_STARTED');
  db.transaction((tx) => {
    tx.update(leaveRequests).set({ status: 'cancelled' }).where(eq(leaveRequests.id, id)).run();
    recordAudit(tx, ctx, { action: 'status_change', entityType: 'leave_request', entityId: id, summary: `Cancelled leave ${leave.startDate} to ${leave.endDate}` });
  });
  return getLeave(id);
}

/** Approved leave covering a day (for the team view and dashboards). */
export function onLeave(day = instituteToday()): LeaveDto[] {
  return leaveQuery()
    .where(and(eq(leaveRequests.status, 'approved'), sql`${leaveRequests.startDate} <= ${day} and ${leaveRequests.endDate} >= ${day}`))
    .orderBy(asc(requester.name))
    .all()
    .map(toLeaveDto);
}

/* ================================================================== *
 * Tasks
 * ================================================================== */

function taskQuery() {
  return db
    .select({ t: tasks, assignedToName: assignee.name, createdByName: creator.name, batchCode: batches.batchCode })
    .from(tasks)
    .leftJoin(assignee, eq(assignee.id, tasks.assignedToId))
    .leftJoin(creator, eq(creator.id, tasks.createdById))
    .leftJoin(batches, eq(batches.id, tasks.batchId));
}

function toTaskDto(r: Awaited<ReturnType<ReturnType<typeof taskQuery>['all']>>[number], today = instituteToday()): TaskDto {
  const t = r.t;
  return {
    id: t.id,
    title: t.title,
    details: t.details,
    batchId: t.batchId,
    batchCode: r.batchCode,
    assignedToId: t.assignedToId,
    assignedToName: r.assignedToName,
    createdById: t.createdById,
    createdByName: r.createdByName,
    priority: t.priority,
    status: t.status,
    dueDate: t.dueDate,
    completedAt: t.completedAt?.toISOString() ?? null,
    isOverdue: Boolean(t.dueDate && t.dueDate < today && t.status !== 'done' && t.status !== 'cancelled'),
    attachmentName: t.attachmentName,
    createdAt: t.createdAt.toISOString(),
  };
}

function getTask(id: string): TaskDto {
  const row = taskQuery().where(eq(tasks.id, id)).get();
  if (!row) throw ApiError.notFound('Task');
  return toTaskDto(row);
}

function canManage(ctx: RequestContext, t: Task): boolean {
  return t.createdById === ctx.actorId || hasPermission(ctx.permissions, 'tasks:assign');
}

function taskFor(ctx: RequestContext, id: string): Task {
  const t = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!t || !(t.assignedToId === ctx.actorId || canManage(ctx, t))) throw ApiError.notFound('Task');
  return t;
}

function assertAssignee(ctx: RequestContext, assignedToId: string | undefined): void {
  if (!assignedToId || assignedToId === ctx.actorId) return;
  if (!hasPermission(ctx.permissions, 'tasks:assign')) throw ApiError.forbidden('Assigning tasks to others needs the task assignment permission.');
  const target = db.select({ isActive: users.isActive, accountType: users.accountType }).from(users).where(eq(users.id, assignedToId)).get();
  if (!target || !target.isActive || target.accountType === 'student') throw ApiError.validation([{ path: 'assignedToId', message: 'Choose an active team or faculty member' }]);
}

function storeAttachment(file: UploadedFile | undefined) {
  if (!file) return null;
  const { ext, mime } = checkFile(file);
  const key = newKey('tasks', ext);
  saveFile(key, file.buffer);
  return { attachmentKey: key, attachmentName: file.originalname.replace(/[\\/\r\n\t"]/g, '_').slice(0, 200), attachmentMime: mime, attachmentSize: file.size };
}

export function createTask(ctx: RequestContext, file: UploadedFile | undefined, raw: unknown): TaskDto {
  const input = taskSchema.parse(raw);
  const assignedToId = input.assignedToId ?? ctx.actorId;
  assertAssignee(ctx, assignedToId);
  if (input.batchId) {
    if (!db.select({ id: batches.id }).from(batches).where(eq(batches.id, input.batchId)).get()) throw ApiError.validation([{ path: 'batchId', message: 'Choose a valid batch' }]);
    assertBatchInScope(ctx, input.batchId);
  }
  const attachment = storeAttachment(file);
  const id = db.transaction((tx) => {
    const row = tx
      .insert(tasks)
      .values({ title: input.title, details: input.details ?? null, batchId: input.batchId ?? null, assignedToId, createdById: ctx.actorId || null, priority: input.priority, dueDate: input.dueDate ?? null, ...(attachment ?? {}) })
      .returning()
      .get();
    recordAudit(tx, ctx, { action: 'create', entityType: 'task', entityId: row.id, summary: `Created task "${input.title}"` });
    return row.id;
  });
  if (assignedToId !== ctx.actorId) {
    safely('task_assigned', () => {
      notifyUsers([assignedToId], { type: 'task_assigned', severity: input.priority === 'urgent' ? 'warning' : 'info', title: `New task from ${ctx.actorName}: ${input.title}`, body: input.dueDate ? `Due ${input.dueDate}` : null, link: '/tasks', entityType: 'task', entityId: id, dedupeKey: `task_assigned:${id}:${assignedToId}` });
    });
  }
  return getTask(id);
}

export function listTasks(ctx: RequestContext, q: z.output<typeof taskListQuerySchema>) {
  if (q.scope === 'all' && !hasPermission(ctx.permissions, 'tasks:assign')) throw ApiError.forbidden('Seeing everyone\'s tasks needs the task assignment permission.');
  const today = instituteToday();
  const conditions: (SQL | undefined)[] = [q.scope === 'mine' ? eq(tasks.assignedToId, ctx.actorId) : q.scope === 'created' ? eq(tasks.createdById, ctx.actorId) : undefined];
  if (q.q) conditions.push(or(containsText(tasks.title, q.q), containsText(tasks.details, q.q)));
  if (q.status?.length) conditions.push(inArray(tasks.status, q.status));
  if (q.priority) conditions.push(eq(tasks.priority, q.priority));
  if (q.assignedToId && q.scope !== 'mine') conditions.push(eq(tasks.assignedToId, q.assignedToId));
  if (q.overdue) conditions.push(and(sql`${tasks.dueDate} < ${today}`, inArray(tasks.status, ['todo', 'in_progress', 'blocked'])));
  const where = and(...conditions);
  const total = db.select({ n: count() }).from(tasks).where(where).get()?.n ?? 0;
  const { limit, offset } = pageWindow(q.page, q.limit);
  const order = [sql`case ${tasks.status} when 'done' then 1 when 'cancelled' then 2 else 0 end`, sql`${tasks.dueDate} is null`, asc(tasks.dueDate), sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`];
  return paginated(taskQuery().where(where).orderBy(...order).limit(limit).offset(offset).all().map((r) => toTaskDto(r, today)), total, q.page, q.limit);
}

export function updateTask(ctx: RequestContext, id: string, raw: unknown): TaskDto {
  const t = taskFor(ctx, id);
  if (!canManage(ctx, t)) throw ApiError.forbidden('Only the person who created the task can change it.');
  const input = taskSchema.parse(raw);
  const assignedToId = input.assignedToId ?? t.assignedToId ?? ctx.actorId;
  if (assignedToId !== t.assignedToId) assertAssignee(ctx, assignedToId);
  if (input.batchId && input.batchId !== t.batchId) assertBatchInScope(ctx, input.batchId);
  db.transaction((tx) => {
    tx.update(tasks).set({ title: input.title, details: input.details ?? null, batchId: input.batchId ?? null, assignedToId, priority: input.priority, dueDate: input.dueDate ?? null }).where(eq(tasks.id, id)).run();
    recordAudit(tx, ctx, { action: 'update', entityType: 'task', entityId: id, summary: `Updated task "${input.title}"` });
  });
  if (assignedToId && assignedToId !== t.assignedToId && assignedToId !== ctx.actorId) {
    safely('task_assigned', () => notifyUsers([assignedToId], { type: 'task_assigned', title: `Task assigned to you: ${input.title}`, link: '/tasks', entityType: 'task', entityId: id, dedupeKey: `task_assigned:${id}:${assignedToId}` }));
  }
  return getTask(id);
}

export function setTaskStatus(ctx: RequestContext, id: string, raw: unknown): TaskDto {
  const t = taskFor(ctx, id);
  const { status } = taskStatusSchema.parse(raw);
  if (status === 'cancelled' && !canManage(ctx, t)) throw ApiError.forbidden('Only the person who created the task can cancel it.');
  if (status === t.status) return getTask(id);
  db.transaction((tx) => {
    tx.update(tasks).set({ status, completedAt: status === 'done' ? new Date() : null }).where(eq(tasks.id, id)).run();
    recordAudit(tx, ctx, { action: 'status_change', entityType: 'task', entityId: id, summary: `Task "${t.title}": ${t.status.replace('_', ' ')} → ${status.replace('_', ' ')}` });
  });
  if (status === 'done' && t.createdById && t.createdById !== ctx.actorId) {
    safely('task_done', () => notifyUsers([t.createdById!], { type: 'task_assigned', severity: 'success', title: `Done: ${t.title}`, body: `Completed by ${ctx.actorName}`, link: '/tasks?scope=created', entityType: 'task', entityId: id, dedupeKey: `task_done:${id}` }));
  }
  return getTask(id);
}

export function taskAttachment(ctx: RequestContext, id: string) {
  const t = taskFor(ctx, id);
  const buffer = t.attachmentKey ? readStoredFile(t.attachmentKey) : null;
  if (!buffer) throw ApiError.notFound('Attachment');
  return { buffer, fileName: t.attachmentName ?? 'attachment', mimeType: t.attachmentMime ?? 'application/octet-stream' };
}

/* ================================================================== *
 * Inventory
 * ================================================================== */

const I_ID = qualified('inventory_items', 'id');
const issuedExpr = sql<number>`coalesce((select sum(r.quantity) from inventory_requests r where r.item_id = ${I_ID} and r.status = 'issued'), 0)`;
const pendingExpr = sql<number>`(select count(*) from inventory_requests r where r.item_id = ${I_ID} and r.status = 'pending')`;

function itemQuery() {
  return db.select({ i: inventoryItems, issued: issuedExpr.mapWith(Number), pending: pendingExpr.mapWith(Number) }).from(inventoryItems);
}

function toItemDto(r: { i: InventoryItem; issued: number; pending: number }): InventoryItemDto {
  const i = r.i;
  return {
    id: i.id,
    assetTag: i.assetTag,
    name: i.name,
    category: i.category,
    description: i.description,
    quantityTotal: i.quantityTotal,
    quantityAvailable: i.quantityAvailable,
    quantityIssued: i.isConsumable ? 0 : r.issued,
    unitValueMinor: i.unitValueMinor,
    isConsumable: i.isConsumable,
    status: i.status,
    condition: i.condition,
    location: i.location,
    purchasedOn: i.purchasedOn,
    notes: i.notes,
    pendingRequests: r.pending,
  };
}

export function getItem(id: string): InventoryItemDto {
  const row = itemQuery().where(eq(inventoryItems.id, id)).get();
  if (!row) throw ApiError.notFound('Item');
  return toItemDto(row);
}

export function listItems(q: z.output<typeof inventoryListQuerySchema>) {
  const conditions: (SQL | undefined)[] = [];
  if (q.q) conditions.push(or(containsText(inventoryItems.name, q.q), containsText(inventoryItems.assetTag, q.q), containsText(inventoryItems.location, q.q)));
  if (q.category) conditions.push(eq(inventoryItems.category, q.category));
  if (q.status) conditions.push(eq(inventoryItems.status, q.status));
  if (q.available) conditions.push(and(eq(inventoryItems.status, 'in_service'), sql`${inventoryItems.quantityAvailable} > 0`));
  const where = and(...conditions);
  const total = db.select({ n: count() }).from(inventoryItems).where(where).get()?.n ?? 0;
  const { limit, offset } = pageWindow(q.page, q.limit);
  const summary = db.get<{ value: number; items: number; lent: number }>(sql`select coalesce(sum(quantity_total * unit_value_minor), 0) as value, count(*) as items, coalesce((select sum(quantity) from inventory_requests where status = 'issued'), 0) as lent from inventory_items where status <> 'retired'`);
  return {
    ...paginated(itemQuery().where(where).orderBy(asc(inventoryItems.name)).limit(limit).offset(offset).all().map(toItemDto), total, q.page, q.limit),
    summary: { totalValueMinor: Number(summary?.value ?? 0), activeItems: Number(summary?.items ?? 0), unitsLent: Number(summary?.lent ?? 0) },
  };
}

export function saveItem(ctx: RequestContext, raw: unknown, id?: string): InventoryItemDto {
  const input = inventoryItemSchema.parse(raw);
  const dupe = db.select({ id: inventoryItems.id }).from(inventoryItems).where(and(sql`upper(${inventoryItems.assetTag}) = ${input.assetTag}`, id ? ne(inventoryItems.id, id) : undefined)).get();
  if (dupe) throw ApiError.conflict(`Asset tag ${input.assetTag} is already in use.`, 'TAG_IN_USE');
  const base = { assetTag: input.assetTag, name: input.name, category: input.category, description: input.description ?? null, unitValueMinor: input.unitValueMinor, isConsumable: input.isConsumable, status: input.status, condition: input.condition ?? null, location: input.location ?? null, purchasedOn: input.purchasedOn ?? null, notes: input.notes ?? null };
  const savedId = db.transaction((tx) => {
    if (!id) {
      const row = tx.insert(inventoryItems).values({ ...base, quantityTotal: input.quantityTotal, quantityAvailable: input.quantityTotal, createdById: ctx.actorId || null }).returning().get();
      recordAudit(tx, ctx, { action: 'create', entityType: 'inventory_item', entityId: row.id, summary: `Added ${input.quantityTotal} × ${input.name} (${input.assetTag})` });
      return row.id;
    }
    const existing = tx.select().from(inventoryItems).where(eq(inventoryItems.id, id)).get();
    if (!existing) throw ApiError.notFound('Item');
    const out = existing.isConsumable ? 0 : existing.quantityTotal - existing.quantityAvailable;
    if (input.quantityTotal < out) throw ApiError.unprocessable(`${out} are lent out at the moment, so the total cannot go below ${out}.`, 'STOCK_OUT');
    if (existing.isConsumable !== input.isConsumable && out > 0) throw ApiError.conflict('Items are lent out; take them back before changing whether this is a consumable.', 'STOCK_OUT');
    tx.update(inventoryItems).set({ ...base, quantityTotal: input.quantityTotal, quantityAvailable: input.quantityTotal - out }).where(eq(inventoryItems.id, id)).run();
    recordAudit(tx, ctx, { action: 'update', entityType: 'inventory_item', entityId: id, summary: `Updated ${input.name} (${input.assetTag})`, before: { quantityTotal: existing.quantityTotal, status: existing.status }, after: { quantityTotal: input.quantityTotal, status: input.status } });
    return id;
  });
  return getItem(savedId);
}

function requestQuery() {
  return db
    .select({ r: inventoryRequests, itemName: inventoryItems.name, assetTag: inventoryItems.assetTag, isConsumable: inventoryItems.isConsumable, requestedByName: requester.name, reviewedByName: reviewer.name })
    .from(inventoryRequests)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryRequests.itemId))
    .innerJoin(requester, eq(requester.id, inventoryRequests.requestedById))
    .leftJoin(reviewer, eq(reviewer.id, inventoryRequests.reviewedById));
}

function toRequestDto(row: Awaited<ReturnType<ReturnType<typeof requestQuery>['all']>>[number]): InventoryRequestDto {
  const r = row.r;
  return {
    id: r.id,
    itemId: r.itemId,
    itemName: row.itemName,
    assetTag: row.assetTag,
    isConsumable: row.isConsumable,
    requestedById: r.requestedById,
    requestedByName: row.requestedByName,
    quantity: r.quantity,
    status: r.status,
    reason: r.reason,
    neededBy: r.neededBy,
    reviewedByName: row.reviewedByName,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    reviewNote: r.reviewNote,
    issuedAt: r.issuedAt?.toISOString() ?? null,
    returnedAt: r.returnedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

function getRequest(id: string): InventoryRequestDto {
  const row = requestQuery().where(eq(inventoryRequests.id, id)).get();
  if (!row) throw ApiError.notFound('Request');
  return toRequestDto(row);
}

export function requestItem(ctx: RequestContext, raw: unknown): InventoryRequestDto {
  const input = inventoryRequestSchema.parse(raw);
  const item = db.select().from(inventoryItems).where(eq(inventoryItems.id, input.itemId)).get();
  if (!item || item.status === 'retired') throw ApiError.validation([{ path: 'itemId', message: 'Choose an item that is in service' }]);
  if (input.quantity > item.quantityTotal) throw ApiError.validation([{ path: 'quantity', message: `There are only ${item.quantityTotal} in total` }]);
  const id = db.transaction((tx) => {
    const row = tx.insert(inventoryRequests).values({ itemId: item.id, requestedById: ctx.actorId, quantity: input.quantity, reason: input.reason ?? null, neededBy: input.neededBy ?? null }).returning().get();
    recordAudit(tx, ctx, { action: 'create', entityType: 'inventory_request', entityId: row.id, summary: `Requested ${input.quantity} × ${item.name}` });
    return row.id;
  });
  safely('inventory_request', () => notifyPermission('inventory:approve', { type: 'inventory_request', title: `${ctx.actorName} requested ${input.quantity} × ${item.name}`, body: input.neededBy ? `Needed by ${input.neededBy}` : null, link: '/inventory?tab=requests', entityType: 'inventory_request', entityId: id, dedupeKey: `inventory_request:${id}` }, { except: ctx.actorId }));
  return getRequest(id);
}

export function listRequests(ctx: RequestContext, q: z.output<typeof inventoryRequestListQuerySchema>) {
  if (q.scope === 'all' && !hasPermission(ctx.permissions, 'inventory:approve') && !hasPermission(ctx.permissions, 'inventory:read')) throw ApiError.forbidden();
  const conditions: (SQL | undefined)[] = [q.scope === 'mine' ? eq(inventoryRequests.requestedById, ctx.actorId) : undefined];
  if (q.status?.length) conditions.push(inArray(inventoryRequests.status, q.status));
  if (q.itemId) conditions.push(eq(inventoryRequests.itemId, q.itemId));
  const where = and(...conditions);
  const total = db.select({ n: count() }).from(inventoryRequests).where(where).get()?.n ?? 0;
  const { limit, offset } = pageWindow(q.page, q.limit);
  const order = [sql`case ${inventoryRequests.status} when 'pending' then 0 when 'issued' then 1 else 2 end`, desc(inventoryRequests.createdAt)];
  return paginated(requestQuery().where(where).orderBy(...order).limit(limit).offset(offset).all().map(toRequestDto), total, q.page, q.limit);
}

export function decideRequest(ctx: RequestContext, id: string, raw: unknown): InventoryRequestDto {
  const input = inventoryDecisionSchema.parse(raw);
  const req = db.select().from(inventoryRequests).where(eq(inventoryRequests.id, id)).get();
  if (!req) throw ApiError.notFound('Request');
  const mayApprove = hasPermission(ctx.permissions, 'inventory:approve');
  if (input.action === 'cancel') {
    if (req.requestedById !== ctx.actorId && !mayApprove) throw ApiError.notFound('Request');
  } else if (!mayApprove) {
    throw ApiError.forbidden('Issuing and taking back items needs the inventory approval permission.');
  }
  const item = db.select().from(inventoryItems).where(eq(inventoryItems.id, req.itemId)).get()!;
  const now = new Date();

  db.transaction((tx) => {
    switch (input.action) {
      case 'issue': {
        if (req.status !== 'pending') throw ApiError.conflict(`This request is already ${req.status}.`, 'INVALID_TRANSITION');
        if (item.status !== 'in_service') throw ApiError.unprocessable(`${item.name} is ${item.status === 'repair' ? 'under repair' : 'retired'}.`, 'ITEM_UNAVAILABLE');
        // Guarded update: only succeeds while enough stock is still on hand.
        // A lent asset leaves the available stock; a consumable leaves the total too.
        const changed = tx
          .update(inventoryItems)
          .set({ quantityAvailable: sql`${inventoryItems.quantityAvailable} - ${req.quantity}`, ...(item.isConsumable && { quantityTotal: sql`${inventoryItems.quantityTotal} - ${req.quantity}` }) })
          .where(and(eq(inventoryItems.id, item.id), sql`${inventoryItems.quantityAvailable} >= ${req.quantity}`))
          .run();
        if (changed.changes === 0) throw ApiError.unprocessable(`Only ${item.quantityAvailable} ${item.name} available.`, 'NOT_ENOUGH_STOCK');
        tx.update(inventoryRequests).set({ status: item.isConsumable ? 'returned' : 'issued', reviewedById: ctx.actorId, reviewedAt: now, reviewNote: input.reviewNote ?? null, issuedAt: now, ...(item.isConsumable && { returnedAt: now }) }).where(eq(inventoryRequests.id, id)).run();
        break;
      }
      case 'return': {
        if (req.status !== 'issued') throw ApiError.conflict('Only issued items can be returned.', 'INVALID_TRANSITION');
        tx.update(inventoryItems).set({ quantityAvailable: sql`${inventoryItems.quantityAvailable} + ${req.quantity}` }).where(eq(inventoryItems.id, item.id)).run();
        tx.update(inventoryRequests).set({ status: 'returned', returnedAt: now, reviewNote: input.reviewNote ?? req.reviewNote }).where(eq(inventoryRequests.id, id)).run();
        break;
      }
      case 'reject':
      case 'cancel': {
        if (req.status !== 'pending') throw ApiError.conflict(`This request is already ${req.status}.`, 'INVALID_TRANSITION');
        tx.update(inventoryRequests).set({ status: input.action === 'reject' ? 'rejected' : 'cancelled', reviewedById: ctx.actorId, reviewedAt: now, reviewNote: input.reviewNote ?? null }).where(eq(inventoryRequests.id, id)).run();
        break;
      }
    }
    recordAudit(tx, ctx, { action: input.action === 'reject' ? 'reject' : 'status_change', entityType: 'inventory_request', entityId: id, summary: `${input.action === 'issue' ? 'Issued' : input.action === 'return' ? 'Took back' : input.action === 'reject' ? 'Rejected' : 'Cancelled'} ${req.quantity} × ${item.name}${input.reviewNote ? ` (${input.reviewNote})` : ''}` });
  });

  if ((input.action === 'issue' || input.action === 'reject') && req.requestedById !== ctx.actorId) {
    safely('inventory_decision', () =>
      notifyUsers([req.requestedById], { type: 'inventory_decision', severity: input.action === 'issue' ? 'success' : 'warning', title: input.action === 'issue' ? `${item.name} is ready for you to collect` : `Your request for ${item.name} was rejected`, body: input.reviewNote ?? null, link: '/inventory?tab=mine', entityType: 'inventory_request', entityId: id, dedupeKey: `inventory_decision:${id}:${input.action}` }),
    );
  }
  return getRequest(id);
}
