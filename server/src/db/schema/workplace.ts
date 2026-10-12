/**
 * People operations: staff leave, tasks, and the asset register.
 */

import {
  INVENTORY_CATEGORIES,
  INVENTORY_ITEM_STATUSES,
  INVENTORY_REQUEST_STATUSES,
  LEAVE_STATUSES,
  LEAVE_TYPES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type InventoryCategory,
  type InventoryItemStatus,
  type InventoryRequestStatus,
  type LeaveStatus,
  type LeaveType,
  type TaskPriority,
  type TaskStatus,
} from '@ims/shared';
import {
  bool,
  check,
  dateOnly,
  enumStr,
  id,
  index,
  inList,
  instant,
  int,
  isDateOnly,
  money,
  ref,
  sql,
  str,
  table,
  timestamps,
  uniqueIndex,
} from '../dialect';
import { batches } from './enrolment';
import { users } from './users';

export const leaveRequests = table(
  'leave_requests',
  {
    id: id(),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id),
    type: enumStr('type', LEAVE_TYPES).$type<LeaveType>().notNull(),
    startDate: dateOnly('start_date').notNull(),
    endDate: dateOnly('end_date').notNull(),
    /** Calendar days, inclusive. */
    dayCount: int('day_count').notNull(),
    reason: str('reason'),
    status: enumStr('status', LEAVE_STATUSES).$type<LeaveStatus>().notNull().default('pending'),
    reviewedById: ref('reviewed_by_id').references(() => users.id),
    reviewedAt: instant('reviewed_at'),
    reviewNote: str('review_note'),
    ...timestamps(),
  },
  (t) => [
    index('leave_requests_user_idx').on(t.userId, t.status),
    index('leave_requests_dates_idx').on(t.startDate, t.endDate),
    check('leave_requests_type_check', inList(t.type, LEAVE_TYPES)),
    check('leave_requests_status_check', inList(t.status, LEAVE_STATUSES)),
    check('leave_requests_dates_ordered', sql`${t.endDate} >= ${t.startDate}`),
    check('leave_requests_start_format', isDateOnly(t.startDate)),
    check('leave_requests_days_positive', sql`${t.dayCount} >= 1`),
  ],
);

export const tasks = table(
  'tasks',
  {
    id: id(),
    title: str('title').notNull(),
    details: str('details'),
    batchId: ref('batch_id').references(() => batches.id),
    assignedToId: ref('assigned_to_id').references(() => users.id),
    createdById: ref('created_by_id').references(() => users.id),
    priority: enumStr('priority', TASK_PRIORITIES).$type<TaskPriority>().notNull().default('medium'),
    status: enumStr('status', TASK_STATUSES).$type<TaskStatus>().notNull().default('todo'),
    dueDate: dateOnly('due_date'),
    completedAt: instant('completed_at'),
    attachmentKey: str('attachment_key'),
    attachmentName: str('attachment_name'),
    attachmentMime: str('attachment_mime'),
    attachmentSize: int('attachment_size'),
    ...timestamps(),
  },
  (t) => [
    index('tasks_assignee_idx').on(t.assignedToId, t.status),
    index('tasks_due_idx').on(t.dueDate),
    check('tasks_priority_check', inList(t.priority, TASK_PRIORITIES)),
    check('tasks_status_check', inList(t.status, TASK_STATUSES)),
    check('tasks_done_dated', sql`(${t.status} = 'done') = (${t.completedAt} is not null)`),
  ],
);

export const inventoryItems = table(
  'inventory_items',
  {
    id: id(),
    assetTag: str('asset_tag').notNull(),
    name: str('name').notNull(),
    category: enumStr('category', INVENTORY_CATEGORIES).$type<InventoryCategory>().notNull().default('other'),
    description: str('description'),
    quantityTotal: int('quantity_total').notNull().default(1),
    quantityAvailable: int('quantity_available').notNull().default(1),
    unitValueMinor: money('unit_value_minor').notNull().default(0),
    /** Consumables (paper, cables) are handed out and never come back. */
    isConsumable: bool('is_consumable').notNull().default(false),
    status: enumStr('status', INVENTORY_ITEM_STATUSES).$type<InventoryItemStatus>().notNull().default('in_service'),
    condition: str('condition'),
    location: str('location'),
    purchasedOn: dateOnly('purchased_on'),
    notes: str('notes'),
    createdById: ref('created_by_id').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('inventory_items_tag_unique').on(sql`upper(${t.assetTag})`),
    index('inventory_items_category_idx').on(t.category, t.status),
    check('inventory_items_category_check', inList(t.category, INVENTORY_CATEGORIES)),
    check('inventory_items_status_check', inList(t.status, INVENTORY_ITEM_STATUSES)),
    check('inventory_items_quantity_range', sql`${t.quantityTotal} >= 0 and ${t.quantityAvailable} >= 0 and ${t.quantityAvailable} <= ${t.quantityTotal}`),
    check('inventory_items_value_nonneg', sql`${t.unitValueMinor} >= 0`),
  ],
);

export const inventoryRequests = table(
  'inventory_requests',
  {
    id: id(),
    itemId: ref('item_id')
      .notNull()
      .references(() => inventoryItems.id),
    requestedById: ref('requested_by_id')
      .notNull()
      .references(() => users.id),
    quantity: int('quantity').notNull().default(1),
    status: enumStr('status', INVENTORY_REQUEST_STATUSES).$type<InventoryRequestStatus>().notNull().default('pending'),
    reason: str('reason'),
    neededBy: dateOnly('needed_by'),
    reviewedById: ref('reviewed_by_id').references(() => users.id),
    reviewedAt: instant('reviewed_at'),
    reviewNote: str('review_note'),
    issuedAt: instant('issued_at'),
    returnedAt: instant('returned_at'),
    ...timestamps(),
  },
  (t) => [
    index('inventory_requests_item_idx').on(t.itemId, t.status),
    index('inventory_requests_requester_idx').on(t.requestedById, t.status),
    check('inventory_requests_status_check', inList(t.status, INVENTORY_REQUEST_STATUSES)),
    check('inventory_requests_quantity_positive', sql`${t.quantity} >= 1`),
  ],
);

export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type InventoryItem = typeof inventoryItems.$inferSelect;
export type InventoryRequest = typeof inventoryRequests.$inferSelect;
