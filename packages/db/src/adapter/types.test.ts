/**
 * Unit tests for database adapter types and platform detection.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlatformInfo } from './index.js';

/**
 * Set global.window to a plain object for platform detection tests.
 * getPlatformInfo accesses window via Record<string, unknown>, so we
 * only need the properties under test — no full Window interface required.
 */
function setWindow(value: Record<string, unknown>): void {
  (globalThis as Record<string, unknown>)['window'] = value;
}

function restoreWindow(original: typeof globalThis.window): void {
  (globalThis as Record<string, unknown>)['window'] = original;
}

describe('getPlatformInfo', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    setWindow({});
  });

  afterEach(() => {
    restoreWindow(originalWindow);
    vi.restoreAllMocks();
  });

  describe('electron detection', () => {
    it('detects electron platform when window.electron is defined', () => {
      setWindow({ electron: { sqlite: {} } });

      const info = getPlatformInfo();

      expect(info.platform).toBe('electron');
      expect(info.supportsNativeEncryption).toBe(true);
      expect(info.requiresWebWorker).toBe(false);
    });
  });

  describe('capacitor iOS detection', () => {
    it('detects iOS platform when Capacitor reports ios', () => {
      setWindow({
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => 'ios'
        }
      });

      const info = getPlatformInfo();

      expect(info.platform).toBe('ios');
      expect(info.supportsNativeEncryption).toBe(true);
      expect(info.requiresWebWorker).toBe(false);
    });
  });

  describe('capacitor android detection', () => {
    it('detects Android platform when Capacitor reports android', () => {
      setWindow({
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => 'android'
        }
      });

      const info = getPlatformInfo();

      expect(info.platform).toBe('android');
      expect(info.supportsNativeEncryption).toBe(true);
      expect(info.requiresWebWorker).toBe(false);
    });
  });

  describe('capacitor non-native', () => {
    it('falls back to web when Capacitor is not native', () => {
      setWindow({
        Capacitor: {
          isNativePlatform: () => false,
          getPlatform: () => 'web'
        }
      });

      const info = getPlatformInfo();

      expect(info.platform).toBe('web');
      expect(info.supportsNativeEncryption).toBe(false);
      expect(info.requiresWebWorker).toBe(true);
    });
  });

  describe('capacitor unknown platform', () => {
    it('falls back to web for unknown Capacitor platforms', () => {
      setWindow({
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => 'unknown'
        }
      });

      const info = getPlatformInfo();

      expect(info.platform).toBe('web');
      expect(info.supportsNativeEncryption).toBe(false);
      expect(info.requiresWebWorker).toBe(true);
    });
  });

  describe('capacitor throws error', () => {
    it('falls back to web when Capacitor throws', () => {
      setWindow({
        Capacitor: {
          isNativePlatform: () => {
            throw new Error('Capacitor not available');
          },
          getPlatform: () => 'web'
        }
      });

      const info = getPlatformInfo();

      expect(info.platform).toBe('web');
      expect(info.supportsNativeEncryption).toBe(false);
      expect(info.requiresWebWorker).toBe(true);
    });
  });

  describe('web fallback', () => {
    it('defaults to web platform when no native environment is detected', () => {
      setWindow({});

      const info = getPlatformInfo();

      expect(info.platform).toBe('web');
      expect(info.supportsNativeEncryption).toBe(false);
      expect(info.requiresWebWorker).toBe(true);
    });
  });

  describe('priority order', () => {
    it('prioritizes electron over capacitor', () => {
      setWindow({
        electron: { sqlite: {} },
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => 'ios'
        }
      });

      const info = getPlatformInfo();

      expect(info.platform).toBe('electron');
    });
  });
});
