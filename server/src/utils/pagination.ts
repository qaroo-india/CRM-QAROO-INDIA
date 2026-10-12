import type { Paginated } from '@ims/shared';
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

export function pageWindow(page: number, limit: number): { limit: number; offset: number } {
  return { limit, offset: (page - 1) * limit };
}

export function paginated<T>(items: T[], total: number, page: number, limit: number): Paginated<T> {
  return { items, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

/** Escape LIKE wildcards in user input so "50%" searches for a literal percent. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Case-insensitive "contains" match. SQLite's LIKE has no default escape
 * character, so the ESCAPE clause is what makes likePattern's escaping work.
 */
export function containsText(column: SQLWrapper, term: string): SQL {
  return sql`${column} like ${likePattern(term)} escape '\\'`;
}
