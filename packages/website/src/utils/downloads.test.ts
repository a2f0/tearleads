import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformInfo } from '../types/releases';
import {
  detectPlatform,
  getDownloadUrl,
  PLATFORM_ICONS,
  PLATFORM_LABELS
} from './downloads';

describe('getDownloadUrl', () => {
  const _mockPlatformInfo: PlatformInfo = { arch: 'arm64', ext: 'dmg' };

  beforeEach(() => {
    vi.stubEnv('PUBLIC_DOWNLOAD_DOMAIN', 'download.example.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds correct URL for macOS', () => {
    const url = getDownloadUrl('1.2.3', 'macos', { arch: 'arm64', ext: 'dmg' });
    expect(url).toBe(
      'https://download.example.com/desktop/1.2.3/Rapid-1.2.3-arm64.dmg'
    );
  });

  it('builds correct URL for Windows', () => {
    const url = getDownloadUrl('1.2.3', 'windows', { arch: 'x64', ext: 'exe' });
    expect(url).toBe(
      'https://download.example.com/desktop/1.2.3/Rapid-Setup-1.2.3.exe'
    );
  });

  it('builds correct URL for Linux', () => {
    const url = getDownloadUrl('1.2.3', 'linux', {
      arch: 'x64',
      ext: 'AppImage'
    });
    expect(url).toBe(
      'https://download.example.com/desktop/1.2.3/Rapid-1.2.3-x86_64.AppImage'
    );
  });
});

describe('detectPlatform', () => {
  const originalNavigator = global.navigator;

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true
    });
  });

  it('returns null when navigator is undefined', () => {
    Object.defineProperty(global, 'navigator', {
      value: undefined,
      writable: true
    });
    expect(detectPlatform()).toBeNull();
  });

  it('detects macOS from platform', () => {
    Object.defineProperty(global, 'navigator', {
      value: { platform: 'MacIntel', userAgent: '' },
      writable: true
    });
    expect(detectPlatform()).toBe('macos');
  });

  it('detects macOS from userAgent', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        platform: '',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
      },
      writable: true
    });
    expect(detectPlatform()).toBe('macos');
  });

  it('detects Windows from platform', () => {
    Object.defineProperty(global, 'navigator', {
      value: { platform: 'Win32', userAgent: '' },
      writable: true
    });
    expect(detectPlatform()).toBe('windows');
  });

  it('detects Windows from userAgent', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        platform: '',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      writable: true
    });
    expect(detectPlatform()).toBe('windows');
  });

  it('detects Linux from platform', () => {
    Object.defineProperty(global, 'navigator', {
      value: { platform: 'Linux x86_64', userAgent: '' },
      writable: true
    });
    expect(detectPlatform()).toBe('linux');
  });

  it('detects Linux from userAgent', () => {
    Object.defineProperty(global, 'navigator', {
      value: { platform: '', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' },
      writable: true
    });
    expect(detectPlatform()).toBe('linux');
  });

  it('returns null for unknown platform', () => {
    Object.defineProperty(global, 'navigator', {
      value: { platform: 'Unknown', userAgent: 'Unknown' },
      writable: true
    });
    expect(detectPlatform()).toBeNull();
  });
});

describe('PLATFORM_LABELS', () => {
  it('has labels for all platforms', () => {
    expect(PLATFORM_LABELS.macos).toBe('macOS');
    expect(PLATFORM_LABELS.windows).toBe('Windows');
    expect(PLATFORM_LABELS.linux).toBe('Linux');
  });
});

describe('PLATFORM_ICONS', () => {
  it('has icons for all platforms', () => {
    expect(PLATFORM_ICONS.macos).toBe('apple');
    expect(PLATFORM_ICONS.windows).toBe('windows');
    expect(PLATFORM_ICONS.linux).toBe('linux');
  });
});
