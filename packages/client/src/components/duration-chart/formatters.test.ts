import { describe, expect, it } from 'vitest';
import { formatDuration, formatXAxisTick } from './formatters';

describe('formatDuration', () => {
  it('formats durations below one second in milliseconds', () => {
    expect(formatDuration(42)).toBe('42ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('formats durations at or above one second in seconds', () => {
    expect(formatDuration(1000)).toBe('1.00s');
    expect(formatDuration(1234)).toBe('1.23s');
  });
});

describe('formatXAxisTick', () => {
  const timestamp = new Date('2026-02-28T14:05:00Z').getTime();
  const timeLabelPattern = /\d{1,2}:\d{2}(\s?[AP]M)?/i;
  const dateLabelPattern =
    /(\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?|[A-Za-z]{3,}\s+\d{1,2})/;

  it.each([
    'hour',
    'day'
  ] as const)('uses time formatting for %s filter', (filter) => {
    const label = formatXAxisTick(timestamp, filter);
    expect(label).toMatch(timeLabelPattern);
  });

  it.each([
    'week',
    'all'
  ] as const)('uses date formatting for %s filter', (filter) => {
    const label = formatXAxisTick(timestamp, filter);
    expect(label).toMatch(dateLabelPattern);
  });
});
