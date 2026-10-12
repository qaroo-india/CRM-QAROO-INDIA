import { describe, expect, it } from 'vitest';
import { formatCode, isId, newId, timestampFromId } from './id';

describe('newId (UUIDv7)', () => {
  it('produces RFC 9562 version-7 UUIDs', () => {
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(isId(id)).toBe(true);
  });

  it('never repeats across a burst within the same milliseconds', () => {
    const ids = Array.from({ length: 20_000 }, () => newId());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is strictly increasing in generation order', () => {
    // Bulk imports rely on this: keys inserted in order land at the B-tree edge.
    const ids = Array.from({ length: 5_000 }, () => newId());
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it('embeds its creation time', () => {
    const before = Date.now();
    const id = newId();
    const after = Date.now();
    const embedded = timestampFromId(id)!.getTime();
    expect(embedded).toBeGreaterThanOrEqual(before);
    expect(embedded).toBeLessThanOrEqual(after);
  });
});

describe('isId', () => {
  it('rejects non-UUID input', () => {
    for (const bad of ['', 'abc', '123', null, undefined, 42, '00000000-0000-0000-0000-000000000000']) {
      expect(isId(bad), String(bad)).toBe(false);
    }
  });
});

describe('formatCode', () => {
  it('builds zero-padded business codes', () => {
    expect(formatCode('stu', 2026, 42)).toBe('STU-2026-00042');
    expect(formatCode('RCT', 2026, 123456)).toBe('RCT-2026-123456');
  });
});
