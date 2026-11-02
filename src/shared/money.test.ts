import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  addMinor,
  allocateMinor,
  buildInstalmentAmounts,
  clampedDifference,
  formatMoney,
  percentOfMinor,
  subtractMinor,
  sumMinor,
  toDecimalString,
  toMajorNumber,
  toMinor,
} from './money';

describe('toMinor', () => {
  it('converts plain decimals', () => {
    expect(toMinor('125000.50')).toBe(12500050);
    expect(toMinor('0.01')).toBe(1);
    expect(toMinor('0')).toBe(0);
    expect(toMinor('45000')).toBe(4500000);
  });

  it('accepts Indian and Western group separators', () => {
    expect(toMinor('1,25,000.50')).toBe(12500050);
    expect(toMinor('125,000.50')).toBe(12500050);
  });

  it('pads a single decimal place', () => {
    expect(toMinor('99.5')).toBe(9950);
  });

  it('accepts numbers', () => {
    expect(toMinor(125000.5)).toBe(12500050);
    expect(toMinor(0.07)).toBe(7);
  });

  it('handles negatives for reversal rows', () => {
    expect(toMinor('-500.25')).toBe(-50025);
  });

  it('normalises negative zero', () => {
    expect(toMinor('-0.00')).toBe(0);
    expect(toMinor(-0)).toBe(0);
  });

  it('rejects more precision than the currency holds', () => {
    expect(() => toMinor('100.005')).toThrow(MoneyError);
    expect(() => toMinor(100.005)).toThrow(MoneyError);
  });

  it('rejects junk instead of guessing', () => {
    for (const bad of ['', '  ', 'abc', '1.2.3', 'Rs 500', '500/-', '1e5', '--5']) {
      expect(() => toMinor(bad), `should reject ${JSON.stringify(bad)}`).toThrow(MoneyError);
    }
  });

  it('rejects non-finite numbers', () => {
    expect(() => toMinor(Number.NaN)).toThrow(MoneyError);
    expect(() => toMinor(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });
});

describe('formatting', () => {
  it('round-trips through a decimal string', () => {
    expect(toDecimalString(12500050)).toBe('125000.50');
    expect(toDecimalString(1)).toBe('0.01');
    expect(toDecimalString(-50025)).toBe('-500.25');
    expect(toMinor(toDecimalString(12500050))).toBe(12500050);
  });

  it('formats with Indian digit grouping', () => {
    // en-IN groups as 1,25,000 rather than 125,000.
    expect(formatMoney(12500050, { withoutSymbol: true })).toBe('1,25,000.50');
  });

  it('can drop decimals on whole amounts only', () => {
    expect(formatMoney(4500000, { withoutSymbol: true, compactDecimals: true })).toBe('45,000');
    expect(formatMoney(4500050, { withoutSymbol: true, compactDecimals: true })).toBe('45,000.50');
  });

  it('exposes a float for charts only', () => {
    expect(toMajorNumber(12500050)).toBe(125000.5);
  });
});

describe('exact arithmetic', () => {
  it('avoids the float drift that decimal rupees would suffer', () => {
    // The canonical failure: 0.1 + 0.2 !== 0.3 in binary floating point.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(addMinor(toMinor('0.10'), toMinor('0.20'))).toBe(toMinor('0.30'));
  });

  it('stays exact across many additions', () => {
    const instalment = toMinor('8333.33');
    const rows = Array.from({ length: 1000 }, () => instalment);
    expect(sumMinor(rows)).toBe(833333000);
    // The same loop in floats accumulates error.
    const floatTotal = rows.reduce((s, v) => s + v / 100, 0);
    expect(floatTotal).not.toBe(8333330);
  });

  it('subtracts', () => {
    expect(subtractMinor(toMinor('50000'), toMinor('12500.50'))).toBe(toMinor('37499.50'));
  });

  it('never reports a negative outstanding balance', () => {
    expect(clampedDifference(toMinor('1000'), toMinor('1500'))).toBe(0);
    expect(clampedDifference(toMinor('1500'), toMinor('1000'))).toBe(toMinor('500'));
  });

  it('rejects a non-integer amount reaching arithmetic', () => {
    expect(() => addMinor(100.5, 200)).toThrow(MoneyError);
  });
});

describe('percentOfMinor', () => {
  // Basis points: 1 bp = 0.01%, so 10% = 1,000 bp and 100% = 10,000 bp.

  it('computes whole percentages', () => {
    // 10% of Rs 50,000 = Rs 5,000
    expect(percentOfMinor(toMinor('50000'), 1000)).toBe(toMinor('5000'));
  });

  it('supports fractional percentages', () => {
    // 12.5% of Rs 50,000 = Rs 6,250
    expect(percentOfMinor(toMinor('50000'), 1250)).toBe(toMinor('6250'));
  });

  it('returns the full amount at 100% and nothing at 0%', () => {
    expect(percentOfMinor(toMinor('87500.75'), 10_000)).toBe(toMinor('87500.75'));
    expect(percentOfMinor(toMinor('87500.75'), 0)).toBe(0);
  });

  it('rounds an exact half paisa away from zero', () => {
    // 0.5% of 100 paise = 0.5 paise -> 1 paisa
    expect(percentOfMinor(100, 50)).toBe(1);
    // 0.5% of -100 paise = -0.5 paise -> -1 paisa (away from zero, not toward +inf)
    expect(percentOfMinor(-100, 50)).toBe(-1);
  });

  it('rounds below half down', () => {
    // 0.5% of 98 paise = 0.49 paise -> 0
    expect(percentOfMinor(98, 50)).toBe(0);
  });

  it('never produces negative zero', () => {
    // toBe uses Object.is, which distinguishes -0 from 0.
    expect(percentOfMinor(-98, 50)).toBe(0);
  });

  it('handles a realistic tax-style rate', () => {
    // 18% of Rs 8,333.33 = Rs 1,499.9994 -> Rs 1,500.00
    expect(percentOfMinor(toMinor('8333.33'), 1800)).toBe(toMinor('1500'));
  });

  it('rejects a negative or fractional percentage', () => {
    expect(() => percentOfMinor(1000, -1)).toThrow(MoneyError);
    expect(() => percentOfMinor(1000, 12.5)).toThrow(MoneyError);
  });
});

describe('allocateMinor', () => {
  it('splits exactly, losing no paise', () => {
    const parts = allocateMinor(toMinor('10000'), [1, 1, 1]);
    expect(sumMinor(parts)).toBe(toMinor('10000'));
    // 1,000,000 paise / 3 -> two shares absorb the remainder.
    expect(parts).toEqual([333334, 333333, 333333]);
  });

  it('respects weights', () => {
    const parts = allocateMinor(toMinor('1000'), [3, 1]);
    expect(parts).toEqual([toMinor('750'), toMinor('250')]);
    expect(sumMinor(parts)).toBe(toMinor('1000'));
  });

  it('always sums to the total across awkward splits', () => {
    for (const total of [1, 7, 99, 100, 10001, 12500050]) {
      for (const count of [1, 2, 3, 6, 7, 11, 13]) {
        const parts = allocateMinor(total, Array.from({ length: count }, () => 1));
        expect(sumMinor(parts), `total=${total} count=${count}`).toBe(total);
        expect(parts).toHaveLength(count);
      }
    }
  });

  it('handles a one-paisa total', () => {
    expect(allocateMinor(1, [1, 1, 1])).toEqual([1, 0, 0]);
  });

  it('supports fractional weights', () => {
    const parts = allocateMinor(toMinor('1000'), [0.5, 0.25, 0.25]);
    expect(parts).toEqual([toMinor('500'), toMinor('250'), toMinor('250')]);
  });

  it('allocates a negative total for reversals', () => {
    const parts = allocateMinor(toMinor('-1000'), [1, 1, 1]);
    expect(sumMinor(parts)).toBe(toMinor('-1000'));
  });

  it('is a no-op for an empty schedule', () => {
    expect(allocateMinor(0, [])).toEqual([]);
    expect(() => allocateMinor(100, [])).toThrow(MoneyError);
  });

  it('rejects negative weights', () => {
    expect(() => allocateMinor(100, [1, -1])).toThrow(MoneyError);
  });

  it('rejects allocating real money across zero weight', () => {
    expect(() => allocateMinor(100, [0, 0])).toThrow(MoneyError);
    expect(allocateMinor(0, [0, 0])).toEqual([0, 0]);
  });
});

describe('buildInstalmentAmounts', () => {
  it('spreads the balance after the admission fee', () => {
    const parts = buildInstalmentAmounts(toMinor('50000'), toMinor('10000'), 4);
    expect(parts).toEqual([toMinor('10000'), toMinor('10000'), toMinor('10000'), toMinor('10000')]);
  });

  it('puts the remainder on the earliest instalment', () => {
    const parts = buildInstalmentAmounts(toMinor('50000'), toMinor('10000'), 3);
    expect(sumMinor(parts)).toBe(toMinor('40000'));
    expect(parts[0]).toBe(1333334);
    expect(parts[1]).toBe(1333333);
    expect(parts[2]).toBe(1333333);
  });

  it('reconstructs the full agreed fee', () => {
    const total = toMinor('87500.75');
    const admission = toMinor('15000');
    const parts = buildInstalmentAmounts(total, admission, 7);
    expect(addMinor(admission, sumMinor(parts))).toBe(total);
  });

  it('allows a fully paid plan with no instalments', () => {
    expect(buildInstalmentAmounts(toMinor('50000'), toMinor('50000'), 0)).toEqual([]);
  });

  it('rejects a zero-instalment plan that still owes money', () => {
    expect(() => buildInstalmentAmounts(toMinor('50000'), toMinor('10000'), 0)).toThrow(MoneyError);
  });

  it('rejects an admission fee above the agreed fee', () => {
    expect(() => buildInstalmentAmounts(toMinor('10000'), toMinor('50000'), 3)).toThrow(MoneyError);
  });
});
