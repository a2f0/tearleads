import { describe, expect, it } from 'vitest';
import { formatDate } from './index.js';

describe('formatDate', () => {
  it('should return an ISO string for a valid date', () => {
    const date = new Date('2024-01-15T10:30:00.000Z');
    const result = formatDate(date);
    expect(result).toBe('2024-01-15T10:30:00.000Z');
  });

  it('should handle different valid dates', () => {
    const date = new Date('1999-12-31T23:59:59.999Z');
    const result = formatDate(date);
    expect(result).toBe('1999-12-31T23:59:59.999Z');
  });

  it('should throw for an invalid date', () => {
    const invalidDate = new Date('not a date');
    expect(() => formatDate(invalidDate)).toThrow(RangeError);
  });
});
