/**
 * Unit tests for utility functions.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectPlatform,
  formatDate,
  formatFileSize,
  getWebGPUErrorInfo
} from './utils';

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

// Mock Capacitor before importing detectPlatform
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(),
    isNativePlatform: vi.fn()
  }
}));

import { Capacitor } from '@capacitor/core';

describe('detectPlatform', () => {
  const mockGetPlatform = vi.mocked(Capacitor.getPlatform);
  const mockIsNativePlatform = vi.mocked(Capacitor.isNativePlatform);

  beforeEach(() => {
    vi.restoreAllMocks();

    // Clear window.electron if it exists
    if (typeof window !== 'undefined' && 'electron' in window) {
      Reflect.deleteProperty(window, 'electron');
    }

    // Reset Capacitor mocks to defaults
    mockGetPlatform.mockReturnValue('web');
    mockIsNativePlatform.mockReturnValue(false);
  });

  describe('Electron detection', () => {
    it('detects electron platform when window.electron exists', () => {
      // @ts-expect-error - electron is added dynamically
      window.electron = {};
      expect(detectPlatform()).toBe('electron');
    });

    it('returns web when window.electron is undefined', () => {
      expect(detectPlatform()).toBe('web');
    });
  });

  describe('Capacitor native platform detection', () => {
    it('detects iOS when Capacitor returns ios', () => {
      mockGetPlatform.mockReturnValue('ios');
      expect(detectPlatform()).toBe('ios');
    });

    it('detects Android when Capacitor returns android', () => {
      mockGetPlatform.mockReturnValue('android');
      expect(detectPlatform()).toBe('android');
    });
  });

  describe('isNativePlatform fallback detection', () => {
    beforeEach(() => {
      mockGetPlatform.mockReturnValue('web');
      mockIsNativePlatform.mockReturnValue(true);
    });

    it('detects iOS from user agent when isNativePlatform is true', () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)'
      );
      expect(detectPlatform()).toBe('ios');
    });

    it('detects iPad from user agent when isNativePlatform is true', () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
        'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X)'
      );
      expect(detectPlatform()).toBe('ios');
    });

    it('detects Android from user agent when isNativePlatform is true', () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
        'Mozilla/5.0 (Linux; Android 11; Pixel 5)'
      );
      expect(detectPlatform()).toBe('android');
    });

    it('defaults to android when isNativePlatform is true but UA is unknown', () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
        'Mozilla/5.0 (Unknown Platform)'
      );
      expect(detectPlatform()).toBe('android');
    });
  });

  describe('WebView detection fallback', () => {
    beforeEach(() => {
      mockGetPlatform.mockReturnValue('web');
      mockIsNativePlatform.mockReturnValue(false);
    });

    it('detects Android WebView from user agent', () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
        'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.120 Mobile wv'
      );
      expect(detectPlatform()).toBe('android');
    });

    it('detects Android WebView with version/ indicator', () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
        'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Version/4.0 Chrome/91.0.4472.120'
      );
      expect(detectPlatform()).toBe('android');
    });

    it('detects iOS WebView (no Safari in UA)', () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
      );
      expect(detectPlatform()).toBe('ios');
    });

    it('returns web for regular iOS Safari', () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1'
      );
      expect(detectPlatform()).toBe('web');
    });

    it('returns web for desktop browser', () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      );
      expect(detectPlatform()).toBe('web');
    });
  });
});

describe('formatDate', () => {
  it('formats a date and returns a non-empty string', () => {
    const date = new Date(Date.UTC(2025, 2, 15, 14, 30, 0));
    const formatted = formatDate(date);
    // formatDate output is locale-dependent, so we just verify it returns
    // a non-empty string containing expected date components
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted).toContain('2025');
    expect(formatted).toContain('15');
  });

  it('handles different dates correctly', () => {
    const date1 = new Date(Date.UTC(2025, 0, 1, 0, 0, 0));
    const date2 = new Date(Date.UTC(2025, 11, 31, 23, 59, 0));
    const formatted1 = formatDate(date1);
    const formatted2 = formatDate(date2);
    expect(formatted1.length).toBeGreaterThan(0);
    expect(formatted2.length).toBeGreaterThan(0);
    // Different dates should produce different output
    expect(formatted1).not.toBe(formatted2);
  });
});

describe('getWebGPUErrorInfo', () => {
  const mockGetPlatform = vi.mocked(Capacitor.getPlatform);
  const mockIsNativePlatform = vi.mocked(Capacitor.isNativePlatform);

  beforeEach(() => {
    vi.restoreAllMocks();
    mockGetPlatform.mockReturnValue('web');
    mockIsNativePlatform.mockReturnValue(false);
  });

  it('returns iOS-specific error info on iOS', () => {
    mockGetPlatform.mockReturnValue('ios');
    const info = getWebGPUErrorInfo();
    expect(info.title).toBe('WebGPU Not Supported on iOS');
    expect(info.message).toContain('iOS device');
    expect(info.requirement).toContain('iOS 18+');
  });

  it('returns Android-specific error info on Android', () => {
    mockGetPlatform.mockReturnValue('android');
    const info = getWebGPUErrorInfo();
    expect(info.title).toBe('WebGPU Not Supported on Android');
    expect(info.message).toContain('Android device');
    expect(info.requirement).toContain('Android 12+');
    expect(info.requirement).toContain('Chrome 121+');
  });

  it('returns generic error info on web/desktop', () => {
    mockGetPlatform.mockReturnValue('web');
    const info = getWebGPUErrorInfo();
    expect(info.title).toBe('WebGPU Not Supported');
    expect(info.message).toContain('browser');
    expect(info.requirement).toContain('Chrome 113+');
    expect(info.requirement).toContain('Edge 113+');
    expect(info.requirement).toContain('Firefox 121+');
    expect(info.requirement).toContain('Safari 18+');
  });

  it('returns generic error info on electron', () => {
    // Electron is treated like desktop/web for WebGPU purposes
    // @ts-expect-error - electron is added dynamically
    window.electron = {};
    const info = getWebGPUErrorInfo();
    expect(info.title).toBe('WebGPU Not Supported');
    expect(info.message).toContain('browser');
    // Clean up
    Reflect.deleteProperty(window, 'electron');
  });
});
