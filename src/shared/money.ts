/**
 * Money handling for the whole platform.
 *
 * RULE: every monetary value is stored and transported as an INTEGER number of
 * minor currency units (paise for INR, cents for USD). 1,25,000.50 -> 12500050.
 *
 * Why: floating point cannot represent 0.1 exactly, so repeated addition of
 * decimal rupees drifts. SUM(amount_minor) over integers is always exact, so a
 * ledger total is reproducible no matter how many rows it spans.
 *
 * Decimal strings are only ever produced at the edges (UI, PDF, Excel) by the
 * formatters below. Never do arithmetic on a formatted string.
 */

/** Minor units in one major unit. 100 paise = 1 rupee. */
export const MINOR_PER_MAJOR = 100;

/**
 * Hard ceiling on any single stored amount: 10 trillion major units.
 * Keeps every intermediate product inside Number.MAX_SAFE_INTEGER and makes a
 * fat-fingered extra digit fail validation instead of silently persisting.
 */
export const MAX_MONEY_MINOR = 1_000_000_000_000_000;

export class MoneyError extends Error {
  override readonly name = 'MoneyError';
}

/** Accepts only a safe, in-range integer. This is the sole gate into the type. */
export function assertMinor(value: unknown, label = 'amount'): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MoneyError(`${label} must be a finite number, received ${String(value)}`);
  }
  if (!Number.isInteger(value)) {
    throw new MoneyError(
      `${label} must be an integer in minor units (got ${value}). ` +
        'Use toMinor() to convert a decimal amount first.',
    );
  }
  if (Math.abs(value) > MAX_MONEY_MINOR) {
    throw new MoneyError(`${label} exceeds the maximum supported amount`);
  }
  // Normalise -0 to 0 (-0 === 0 is true, so this returns +0). Every money value
  // passes through here, so no amount anywhere can render as "-Rs 0.00".
  return value === 0 ? 0 : value;
}

export function isValidMinor(value: unknown): value is number {
  try {
    assertMinor(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Strict decimal -> minor units.
 *
 * Deliberately rejects anything ambiguous rather than guessing, because a
 * misread fee corrupts every downstream report. Group separators are allowed
 * (both Indian "1,25,000" and Western "125,000" grouping) but at most two
 * decimal places are accepted -- more digits than the currency can hold is a
 * data-entry error, not something to round away quietly.
 */
export function toMinor(input: string | number, label = 'amount'): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new MoneyError(`${label} must be a finite number`);
    }
    const scaled = input * MINOR_PER_MAJOR;
    // Guard against 1250.505 -> 125050.49999 style representation error.
    const rounded = Math.round(scaled);
    if (Math.abs(scaled - rounded) > 1e-6) {
      throw new MoneyError(`${label} has more than 2 decimal places: ${input}`);
    }
    return assertMinor(rounded, label);
  }

  const raw = input.trim();
  if (raw === '') throw new MoneyError(`${label} is required`);

  const cleaned = raw.replace(/,/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new MoneyError(
      `${label} is not a valid amount: "${input}". ` +
        'Expected digits with up to 2 decimal places, e.g. 125000.50',
    );
  }

  const negative = cleaned.startsWith('-');
  const [whole = '0', fraction = ''] = cleaned.replace(/^-/, '').split('.');
  const paise = Number(whole) * MINOR_PER_MAJOR + Number(fraction.padEnd(2, '0'));
  return assertMinor(negative ? -paise : paise, label);
}

/** Minor units -> plain decimal string, e.g. 12500050 -> "125000.50". No grouping. */
export function toDecimalString(minor: number): string {
  assertMinor(minor);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.trunc(abs / MINOR_PER_MAJOR);
  const paise = abs % MINOR_PER_MAJOR;
  return `${negative ? '-' : ''}${whole}.${String(paise).padStart(2, '0')}`;
}

/** Minor units -> float. Display and charting only; never feed this back into arithmetic. */
export function toMajorNumber(minor: number): number {
  assertMinor(minor);
  return minor / MINOR_PER_MAJOR;
}

export interface FormatMoneyOptions {
  currency?: string;
  locale?: string;
  /** Drop the ".00" on whole amounts -- useful in dense tables. */
  compactDecimals?: boolean;
  /** Render without the currency symbol (for Excel numeric columns). */
  withoutSymbol?: boolean;
}

/** Human-facing currency string, e.g. 12500050 -> "Rs.1,25,000.50" in en-IN. */
export function formatMoney(minor: number, options: FormatMoneyOptions = {}): string {
  assertMinor(minor);
  const {
    currency = 'INR',
    locale = 'en-IN',
    compactDecimals = false,
    withoutSymbol = false,
  } = options;

  const showDecimals = !compactDecimals || minor % MINOR_PER_MAJOR !== 0;
  const fractionDigits = showDecimals ? 2 : 0;

  return new Intl.NumberFormat(locale, {
    style: withoutSymbol ? 'decimal' : 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(toMajorNumber(minor));
}

/* ------------------------------------------------------------------ *
 * Exact arithmetic
 * ------------------------------------------------------------------ */

export function addMinor(...amounts: number[]): number {
  return assertMinor(
    amounts.reduce((sum, a) => sum + assertMinor(a), 0),
    'sum',
  );
}

export function subtractMinor(a: number, b: number): number {
  return assertMinor(assertMinor(a) - assertMinor(b), 'difference');
}

export function sumMinor(amounts: readonly number[]): number {
  return addMinor(...amounts);
}

/** Never-negative difference. An outstanding balance must never read below zero. */
export function clampedDifference(a: number, b: number): number {
  return Math.max(0, subtractMinor(a, b));
}

/** 100% expressed in basis points. */
export const BASIS_POINTS_PER_WHOLE = 10_000;

/**
 * Percentage expressed in basis points (1 bp = 0.01%, so 100% = 10,000 and
 * 12.5% = 1,250), so no fractional percent is ever lost. Rounds half away from
 * zero, matching how a receipt would be written by hand.
 */
export function percentOfMinor(minor: number, basisPoints: number): number {
  assertMinor(minor);
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new MoneyError(`basis points must be a non-negative integer, got ${basisPoints}`);
  }
  const divisor = BigInt(BASIS_POINTS_PER_WHOLE);
  const product = BigInt(Math.abs(minor)) * BigInt(basisPoints);
  const quotient = product / divisor;
  const remainder = product % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  // Avoid -0: a negative amount whose share rounds to nothing is plain 0, so a
  // receipt can never print "-Rs 0.00".
  const result = minor < 0 && rounded !== 0n ? -Number(rounded) : Number(rounded);
  return assertMinor(result, 'percentage');
}

/**
 * Split `total` across `weights` so the parts sum to EXACTLY `total`.
 *
 * Used to spread one receipt over several instalments and to build an
 * instalment schedule from a course fee. Naive rounding of each share loses or
 * invents paise; this uses the largest-remainder method, handing each leftover
 * minor unit to the share with the biggest truncated fraction. Arithmetic runs
 * in BigInt so a large fee times a large weight cannot overflow.
 */
export function allocateMinor(total: number, weights: readonly number[]): number[] {
  assertMinor(total, 'total');
  if (weights.length === 0) {
    if (total !== 0) throw new MoneyError('cannot allocate a non-zero total across zero parts');
    return [];
  }
  for (const w of weights) {
    if (!Number.isFinite(w) || w < 0) {
      throw new MoneyError(`allocation weights must be non-negative, got ${w}`);
    }
  }

  // Scale weights to integers so fractional weights are supported exactly.
  const scaledWeights = weights.map((w) => BigInt(Math.round(w * 1e6)));
  const totalWeight = scaledWeights.reduce((s, w) => s + w, 0n);

  if (totalWeight === 0n) {
    if (total !== 0) {
      throw new MoneyError('cannot allocate a non-zero total across zero total weight');
    }
    return weights.map(() => 0);
  }

  const bigTotal = BigInt(total);
  const parts = scaledWeights.map((w) => {
    const product = bigTotal * w;
    // Truncate toward zero, then hand out the leftover deterministically below.
    const base = product / totalWeight;
    const remainder = product % totalWeight;
    return { base, remainder: remainder < 0n ? -remainder : remainder };
  });

  const distributed = parts.reduce((s, p) => s + p.base, 0n);
  let leftover = bigTotal - distributed;
  const step = leftover >= 0n ? 1n : -1n;

  // Largest remainder first; ties broken by position so results are stable.
  const order = parts
    .map((p, index) => ({ index, remainder: p.remainder }))
    .sort((a, b) =>
      b.remainder === a.remainder ? a.index - b.index : b.remainder > a.remainder ? 1 : -1,
    );

  let cursor = 0;
  while (leftover !== 0n) {
    const target = order[cursor % order.length]!;
    parts[target.index]!.base += step;
    leftover -= step;
    cursor += 1;
  }

  return parts.map((p) => assertMinor(Number(p.base), 'allocation'));
}

/**
 * Build an instalment schedule: an admission fee up front, then `count` equal
 * instalments for the balance. Any remainder lands on the EARLIEST instalments,
 * so the institute is never left chasing a trailing 1-paise row.
 */
export function buildInstalmentAmounts(
  totalMinor: number,
  admissionFeeMinor: number,
  count: number,
): number[] {
  assertMinor(totalMinor, 'total fee');
  assertMinor(admissionFeeMinor, 'admission fee');
  if (!Number.isInteger(count) || count < 0) {
    throw new MoneyError(`instalment count must be a non-negative integer, got ${count}`);
  }
  if (admissionFeeMinor > totalMinor) {
    throw new MoneyError('admission fee cannot exceed the total agreed fee');
  }
  const balance = subtractMinor(totalMinor, admissionFeeMinor);
  if (count === 0) {
    if (balance !== 0) {
      throw new MoneyError('a zero-instalment plan must have no outstanding balance');
    }
    return [];
  }
  return allocateMinor(
    balance,
    Array.from({ length: count }, () => 1),
  );
}
