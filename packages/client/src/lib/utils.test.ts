/**
 * Unit tests for utility functions.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectPlatform, formatDate, formatFileSize } from './utils';

describe('formatFileSize', () => {
  it('formats 0 bytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('formats bytes (< 1KB)', () => {
    expect(formatFileSize(1)).toBe('1 B');
    expect(formatFileSize(100)).toBe('100 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(10240)).toBe('10 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1 MB');
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatFileSize(100 * 1024 * 1024)).toBe('100 MB');
  });

  it('formats gigabytes', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
    expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
  });

  it('rounds to 1 decimal place', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(1740)).toBe('1.7 KB');
    expect(formatFileSize(1843)).toBe('1.8 KB');
  });

  it('removes unnecessary decimal places', () => {
    // 1024 bytes = exactly 1 KB, should show "1 KB" not "1.0 KB"
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(2048)).toBe('2 KB');
  });

  it('handles negative values', () => {
    expect(formatFileSize(-1)).toBe('Invalid size');
    expect(formatFileSize(-1024)).toBe('Invalid size');
  });

  it('formats terabytes', () => {
    expect(formatFileSize(1024 * 1024 * 1024 * 1024)).toBe('1 TB');
  });
});

describe('detectPlatform', () => {
  beforeEach(() => {
    // Reset mocks between tests
    vi.restoreAllMocks();

    // Clear window.electron if it exists
    if (typeof window !== 'undefined' && 'electron' in window) {
      delete (window as unknown as Record<string, unknown>)['electron'];
    }
  });

  describe('Electron detection', () => {
    it('detects electron platform when window.electron exists', () => {
      // @ts-expect-error - electron is added dynamically
      window.electron = {};
      expect(detectPlatform()).toBe('electron');
    });

    it('returns web when window.electron is undefined', () => {
      // Default case - Capacitor returns 'web' by default in jsdom
      expect(detectPlatform()).toBe('web');
    });
  });

  // Note: Full Capacitor platform detection tests require mocking
  // the @capacitor/core module, which is complex. The basic detection
  // is tested in integration tests where Capacitor is properly initialized.
});

describe('formatDate', () => {
  it('formats a date with year, month, day, hour and minute', () => {
    // Using Date.UTC makes the test independent of the local timezone.
    // Note: month is 0-indexed, so 2 is March.
    const date = new Date(Date.UTC(2025, 2, 15, 14, 30, 0));
    const formatted = formatDate(date);
    // Using a snapshot ensures consistent output across environments.
    expect(formatted).toMatchSnapshot();
  });

  it('formats midnight correctly', () => {
    const date = new Date(Date.UTC(2025, 0, 1, 0, 0, 0));
    const formatted = formatDate(date);
    expect(formatted).toMatchSnapshot();
  });

  it('formats end of day correctly', () => {
    const date = new Date(Date.UTC(2025, 11, 31, 23, 59, 0));
    const formatted = formatDate(date);
    expect(formatted).toMatchSnapshot();
  });

  it('returns a non-empty string', () => {
    const date = new Date(Date.UTC(2025, 5, 15, 12, 0, 0));
    const formatted = formatDate(date);
    expect(formatted.length).toBeGreaterThan(0);
  });
});
