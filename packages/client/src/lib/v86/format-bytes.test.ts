import { describe, expect, it } from 'vitest';
import { formatBytes } from './format-bytes';

describe('formatBytes', () => {
  it('formats bytes correctly', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  it('formats kilobytes correctly', () => {
    expect(formatBytes(51200)).toBe('50.0 KB');
  });

  it('formats megabytes correctly', () => {
    expect(formatBytes(104857600)).toBe('100.0 MB');
  });

  it('formats gigabytes correctly', () => {
    expect(formatBytes(1073741824)).toBe('1.0 GB');
  });

  it('handles edge case at KB boundary', () => {
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
  });

  it('handles edge case at MB boundary', () => {
    expect(formatBytes(1048575)).toBe('1024.0 KB');
    expect(formatBytes(1048576)).toBe('1.0 MB');
  });

  it('handles edge case at GB boundary', () => {
    expect(formatBytes(1073741823)).toBe('1024.0 MB');
    expect(formatBytes(1073741824)).toBe('1.0 GB');
  });
});
