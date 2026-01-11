import { describe, expect, it } from 'vitest';
import { formatDuration, formatXAxisTick } from './formatters';

describe('formatDuration', () => {
  it('formats sub-second durations in milliseconds', () => {
    expect(formatDuration(50)).toBe('50ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('formats durations at exactly 1 second', () => {
    expect(formatDuration(1000)).toBe('1.00s');
  });

  it('formats multi-second durations in seconds', () => {
    expect(formatDuration(2500)).toBe('2.50s');
    expect(formatDuration(12345)).toBe('12.35s');
  });
});

describe('formatXAxisTick', () => {
  // Use a fixed date for consistent testing
  const timestamp = new Date('2024-01-15T14:30:00Z').getTime();

  it.each(['hour', 'day'])('formats %s filter as time', (filter) => {
    const result = formatXAxisTick(timestamp, filter);
    // Should contain time format (e.g., 02:30 PM or 14:30)
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it.each(['week', 'all'])('formats %s filter as date', (filter) => {
    const result = formatXAxisTick(timestamp, filter);
    // Should contain month and day (e.g., Jan 15)
    expect(result).toContain('Jan');
    expect(result).toMatch(/\d{1,2}/);
  });
});
