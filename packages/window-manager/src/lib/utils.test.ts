import { cn } from '@tearleads/ui';
import { describe, expect, it, vi } from 'vitest';
import { detectPlatform, generateUniqueId } from './utils.js';

describe('utils', () => {
  it('merges class names', () => {
    expect(cn('p-2', 'p-4', 'text-sm')).toBe('p-4 text-sm');
  });

  it('uses crypto.randomUUID when available', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'crypto'
    );
    const randomUUID = vi.fn(() => 'uuid-123');

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { randomUUID }
    });

    expect(generateUniqueId('window')).toBe('window-uuid-123');
    expect(randomUUID).toHaveBeenCalledTimes(1);

    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalDescriptor);
    }
  });

  it('falls back when crypto is unavailable', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'crypto'
    );

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: undefined
    });

    const id = generateUniqueId('window');
    expect(id.startsWith('window-')).toBe(true);

    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalDescriptor);
    }
  });

  it('detects ios from user agent', () => {
    const originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'
    });

    expect(detectPlatform()).toBe('ios');

    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: originalUserAgent
    });
  });

  it('detects android from user agent', () => {
    const originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)'
    });

    expect(detectPlatform()).toBe('android');

    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: originalUserAgent
    });
  });

  it('falls back to web for desktop user agent', () => {
    const originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)'
    });

    expect(detectPlatform()).toBe('web');

    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: originalUserAgent
    });
  });
});
