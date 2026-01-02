/**
 * Unit tests for database adapter types and platform detection.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlatformInfo } from './types';

describe('getPlatformInfo', () => {
  const originalWindow = global.window;

  beforeEach(() => {
    // Reset window to a clean state
    global.window = {} as typeof window;
  });

  afterEach(() => {
    global.window = originalWindow;
    vi.restoreAllMocks();
  });

  describe('electron detection', () => {
    it('detects electron platform when window.electron is defined', () => {
      global.window = {
        electron: {
          sqlite: {}
        }
      } as typeof window;

      const info = getPlatformInfo();

      expect(info.platform).toBe('electron');
      expect(info.supportsNativeEncryption).toBe(true);
      expect(info.requiresWebWorker).toBe(false);
    });
  });

  describe('capacitor iOS detection', () => {
    it('detects iOS platform when Capacitor reports ios', () => {
      global.window = {
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => 'ios'
        }
      } as typeof window;

      const info = getPlatformInfo();

      expect(info.platform).toBe('ios');
      expect(info.supportsNativeEncryption).toBe(true);
      expect(info.requiresWebWorker).toBe(false);
    });
  });

  describe('capacitor android detection', () => {
    it('detects Android platform when Capacitor reports android', () => {
      global.window = {
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => 'android'
        }
      } as typeof window;

      const info = getPlatformInfo();

      expect(info.platform).toBe('android');
      expect(info.supportsNativeEncryption).toBe(true);
      expect(info.requiresWebWorker).toBe(false);
    });
  });

  describe('capacitor non-native', () => {
    it('falls back to web when Capacitor is not native', () => {
      global.window = {
        Capacitor: {
          isNativePlatform: () => false,
          getPlatform: () => 'web'
        }
      } as typeof window;

      const info = getPlatformInfo();

      expect(info.platform).toBe('web');
      expect(info.supportsNativeEncryption).toBe(false);
      expect(info.requiresWebWorker).toBe(true);
    });
  });

  describe('capacitor unknown platform', () => {
    it('falls back to web for unknown Capacitor platforms', () => {
      global.window = {
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => 'unknown'
        }
      } as typeof window;

      const info = getPlatformInfo();

      expect(info.platform).toBe('web');
      expect(info.supportsNativeEncryption).toBe(false);
      expect(info.requiresWebWorker).toBe(true);
    });
  });

  describe('capacitor throws error', () => {
    it('falls back to web when Capacitor throws', () => {
      global.window = {
        Capacitor: {
          isNativePlatform: () => {
            throw new Error('Capacitor not available');
          },
          getPlatform: () => 'web'
        }
      } as unknown as typeof window;

      const info = getPlatformInfo();

      expect(info.platform).toBe('web');
      expect(info.supportsNativeEncryption).toBe(false);
      expect(info.requiresWebWorker).toBe(true);
    });
  });

  describe('web fallback', () => {
    it('defaults to web platform when no native environment is detected', () => {
      global.window = {} as typeof window;

      const info = getPlatformInfo();

      expect(info.platform).toBe('web');
      expect(info.supportsNativeEncryption).toBe(false);
      expect(info.requiresWebWorker).toBe(true);
    });
  });

  describe('priority order', () => {
    it('prioritizes electron over capacitor', () => {
      global.window = {
        electron: { sqlite: {} },
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => 'ios'
        }
      } as typeof window;

      const info = getPlatformInfo();

      expect(info.platform).toBe('electron');
    });
  });
});
