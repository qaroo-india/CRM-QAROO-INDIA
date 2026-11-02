/**
 * Primary-key generation.
 *
 * UUIDv7 rather than UUIDv4: the first 48 bits are a millisecond timestamp, so
 * keys sort chronologically. That gives locality on the SQLite B-tree (inserts
 * land at the right edge instead of scattering across pages) and lets
 * `ORDER BY id` stand in for `ORDER BY created_at` when timestamps tie.
 *
 * It is also a plain RFC-9562 UUID string, so the Postgres migration maps it
 * straight onto a native `uuid` column with no transformation.
 */

/**
 * Web Crypto exists in every supported runtime (browsers and Node 19+). It is
 * typed locally because this package compiles without DOM or Node typings;
 * being module-scoped, it cannot clash with either consumer's global type.
 */
declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

let lastTimestamp = -1;
let sequence = 0;

/**
 * Generate a UUIDv7.
 *
 * Within a single millisecond a 12-bit counter keeps IDs strictly increasing,
 * so a bulk import that writes thousands of rows per millisecond still produces
 * ordered, collision-free keys.
 */
export function newId(): string {
  const now = Date.now();

  if (now === lastTimestamp) {
    sequence += 1;
    // Counter exhausted: spin to the next millisecond rather than risk a repeat.
    if (sequence > 0xfff) {
      let next = Date.now();
      while (next <= lastTimestamp) next = Date.now();
      lastTimestamp = next;
      sequence = 0;
    }
  } else if (now > lastTimestamp) {
    lastTimestamp = now;
    sequence = 0;
  } else {
    // Clock moved backwards (NTP correction). Keep monotonicity by reusing the
    // last timestamp and advancing the counter instead of emitting a lower ID.
    sequence += 1;
  }

  const bytes = new Uint8Array(16);

  // 48-bit big-endian millisecond timestamp.
  const ts = lastTimestamp;
  bytes[0] = Math.floor(ts / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ts / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ts / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ts / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ts / 2 ** 8) & 0xff;
  bytes[5] = ts & 0xff;

  const random = new Uint8Array(10);
  crypto.getRandomValues(random);

  // Version 7 in the high nibble, then the 12-bit intra-millisecond counter.
  bytes[6] = 0x70 | ((sequence >> 8) & 0x0f);
  bytes[7] = sequence & 0xff;

  // RFC 9562 variant bits (10xxxxxx), remaining bits random.
  bytes[8] = 0x80 | (random[0]! & 0x3f);
  for (let i = 9; i < 16; i += 1) {
    bytes[i] = random[i - 8]!;
  }

  const h = (i: number) => HEX[bytes[i]!]!;
  return (
    h(0) + h(1) + h(2) + h(3) + '-' +
    h(4) + h(5) + '-' +
    h(6) + h(7) + '-' +
    h(8) + h(9) + '-' +
    h(10) + h(11) + h(12) + h(13) + h(14) + h(15)
  );
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Recover the creation time embedded in a v7 key. Handy for audit tooling. */
export function timestampFromId(id: string): Date | null {
  if (!isId(id)) return null;
  const hex = id.replace(/-/g, '').slice(0, 12);
  return new Date(Number.parseInt(hex, 16));
}

/**
 * Build a human-facing business code, e.g. formatCode('STU', 2026, 42)
 * -> "STU-2026-00042". These appear on receipts and ID cards, so they stay
 * short and readable; uniqueness is still enforced by a DB unique index.
 */
export function formatCode(prefix: string, year: number, sequenceNumber: number): string {
  return `${prefix.toUpperCase()}-${year}-${String(sequenceNumber).padStart(5, '0')}`;
}
