import { describe, expect, it } from 'vitest';
import { coerceNumber } from './shared.js';

describe('admin postgres shared', () => {
  it('returns finite numbers as-is', () => {
    expect(coerceNumber(42)).toBe(42);
  });

  it('parses numeric strings', () => {
    expect(coerceNumber('7')).toBe(7);
  });

  it('returns 0 for invalid values', () => {
    expect(coerceNumber('not-a-number')).toBe(0);
    expect(coerceNumber(null)).toBe(0);
  });
});
