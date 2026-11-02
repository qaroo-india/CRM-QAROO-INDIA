/**
 * The database dialect boundary.
 *
 * Drizzle uses different column builders per database (sqlite-core vs
 * pg-core), so a schema written directly against `sqliteTable` and `integer`
 * would need every table file rewritten to move to Postgres. To contain that,
 * table files import ONLY from this module and describe columns semantically:
 * `money()`, `dateOnly()`, `instant()` -- never `integer()` or `text()`.
 *
 * Moving to Postgres therefore means rewriting this one file (plus the driver in
 * ./index.ts) and regenerating migrations. Moving to Turso / libSQL needs no
 * change here at all, because it speaks the SQLite dialect.
 *
 * Representation choices, with their Postgres equivalents:
 *   id        TEXT uuidv7       -> uuid
 *   money     INTEGER minor     -> bigint (mode: number)
 *   dateOnly  TEXT YYYY-MM-DD   -> date (mode: string)
 *   instant   INTEGER epoch ms  -> timestamptz (mode: date)
 *   bool      INTEGER 0/1       -> boolean
 *   json      TEXT              -> jsonb
 */

import { newId } from '@ims/shared';
import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

export { check, index, primaryKey, sql, uniqueIndex };
export type { SQL };

/** Column type for self- and forward-references in `.references(() => x.id)`. */
export type AnyColumn = AnySQLiteColumn;

/** Table constructor for the active dialect. */
export const table = sqliteTable;

/* ------------------------------------------------------------------ *
 * Column helpers
 * ------------------------------------------------------------------ */

/** UUIDv7 primary key, generated in the application so it is known before insert. */
export const id = () => text('id').primaryKey().$defaultFn(newId);

/** A foreign-key column holding another row's UUID. Chain `.references()`. */
export const ref = (name: string) => text(name);

/** Exact money in integer minor units. See shared/src/money.ts. */
export const money = (name: string) => integer(name, { mode: 'number' });

/** A plain integer count or ordinal. */
export const int = (name: string) => integer(name, { mode: 'number' });

/**
 * A business calendar day stored as 'YYYY-MM-DD'. Used for admission, receipt
 * and due dates so a report boundary depends only on the date the staff member
 * chose -- never on the server clock's time zone. ISO day strings sort and
 * compare correctly as text, so range filters stay indexable.
 */
export const dateOnly = (name: string) => text(name);

/** An exact instant, exposed to TypeScript as a Date. For audit and system times. */
export const instant = (name: string) => integer(name, { mode: 'timestamp_ms' });

export const bool = (name: string) => integer(name, { mode: 'boolean' });

export const str = (name: string) => text(name);

/** Text restricted to a fixed vocabulary. Pair with `inList()` for a DB CHECK. */
export const enumStr = <const T extends readonly [string, ...string[]]>(name: string, values: T) =>
  text(name, { enum: values });

/** Structured data stored as JSON. Keep it small and never query inside it in reports. */
export const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

/** createdAt / updatedAt, as fresh builders for each table. */
export const timestamps = () => ({
  createdAt: instant('created_at')
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: instant('updated_at')
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
});

/* ------------------------------------------------------------------ *
 * Constraint helpers
 * ------------------------------------------------------------------ */

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * `column IN ('a', 'b', ...)` for a CHECK constraint.
 *
 * CHECK constraints cannot take bound parameters, so values are inlined as
 * literals. That is safe here only because the values come from the
 * compile-time constants in @ims/shared, never from user input.
 */
export function inList(column: AnyColumn, values: readonly string[]): SQL {
  return sql`${column} in (${sql.raw(values.map(quoteLiteral).join(', '))})`;
}

/**
 * An explicitly table-qualified column reference for CORRELATED SUBQUERIES.
 *
 * Drizzle renders columns unqualified ("id") when the outer query has no
 * joins. Inside a subquery an unqualified "id" binds to the INNER table, so a
 * correlation like `admissions.student_id = students.id` would silently
 * compare against the wrong table. Every correlated reference goes through
 * this helper instead. Names come from this codebase, never user input.
 */
export function qualified(table: string, column: string): SQL {
  if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column)) {
    throw new Error(`invalid identifier ${table}.${column}`);
  }
  return sql.raw(`"${table}"."${column}"`);
}

/** Enforce the YYYY-MM-DD shape at the database level for a dateOnly column. */
export function isDateOnly(column: AnyColumn): SQL {
  return sql`${column} glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'`;
}
