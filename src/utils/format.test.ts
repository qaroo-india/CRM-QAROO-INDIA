import { describe, expect, it } from 'vitest';
import { formatDuration, formatElapsed, formatInZoneLong, formatLatency } from './format';

describe('formatDuration', () => {
  it('uses the two most significant units', () => {
    expect(formatDuration(9)).toBe('9s');
    expect(formatDuration(125)).toBe('2m 5s');
    expect(formatDuration(3725)).toBe('1h 2m');
    expect(formatDuration(93_784)).toBe('1d 2h');
  });

  it('never shows negative or fractional time', () => {
    expect(formatDuration(-5)).toBe('0s');
    expect(formatDuration(59.9)).toBe('59s');
  });
});

describe('formatElapsed', () => {
  it('reads naturally', () => {
    expect(formatElapsed(1_000)).toBe('just now');
    expect(formatElapsed(12_000)).toBe('12s ago');
    expect(formatElapsed(180_000)).toBe('3m ago');
    expect(formatElapsed(7_200_000)).toBe('2h ago');
  });
});

describe('formatLatency', () => {
  it('keeps precision only where it is meaningful', () => {
    expect(formatLatency(0.042)).toBe('0.04 ms');
    expect(formatLatency(12.6)).toBe('13 ms');
    expect(formatLatency(null)).toBe('—');
  });
});

describe('formatInZoneLong', () => {
  it('converts an instant into the institute zone', () => {
    // 7 pm UTC on 31 Dec is already 12:30 am on 1 Jan in India -- the classic
    // year-end report boundary bug this helper exists to avoid.
    const result = formatInZoneLong('2026-12-31T19:00:00.000Z', 'Asia/Kolkata');
    expect(result).toMatch(/1 Jan 2027/);
    expect(result).toMatch(/12:30:00\s?am/i);
  });

  it('degrades gracefully on bad input', () => {
    expect(formatInZoneLong('not-a-date', 'Asia/Kolkata')).toBe('—');
  });
});
