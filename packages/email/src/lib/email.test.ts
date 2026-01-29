import { describe, expect, it } from 'vitest';
import { formatEmailDate, formatEmailSize } from './email';

describe('email utilities', () => {
  describe('formatEmailDate', () => {
    it('formats date with month, day, hour, and minute', () => {
      const result = formatEmailDate('2024-01-15T10:30:00Z');
      expect(result).toMatch(/Jan/);
      expect(result).toMatch(/15/);
    });
  });

  describe('formatEmailSize', () => {
    it('formats bytes for small files', () => {
      expect(formatEmailSize(500)).toBe('500 B');
    });

    it('formats kilobytes', () => {
      expect(formatEmailSize(1024)).toBe('1.0 KB');
      expect(formatEmailSize(2048)).toBe('2.0 KB');
    });

    it('formats megabytes', () => {
      expect(formatEmailSize(1024 * 1024)).toBe('1.0 MB');
      expect(formatEmailSize(2 * 1024 * 1024)).toBe('2.0 MB');
    });

    it('handles edge cases at boundaries', () => {
      expect(formatEmailSize(1023)).toBe('1023 B');
      expect(formatEmailSize(1024 * 1024 - 1)).toBe('1024.0 KB');
    });
  });
});
