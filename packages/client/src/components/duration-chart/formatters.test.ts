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

  it('uses time formatting for hour filter', () => {
    const label = formatXAxisTick(timestamp, 'hour');
    expect(label).toMatch(/\d/);
  });

  it('uses time formatting for day filter', () => {
    const label = formatXAxisTick(timestamp, 'day');
    expect(label).toMatch(/\d/);
  });

  it('uses date formatting for non-hour/day filters', () => {
    const label = formatXAxisTick(timestamp, 'week');
    expect(label).toMatch(/[A-Za-z0-9]/);
  });
});
