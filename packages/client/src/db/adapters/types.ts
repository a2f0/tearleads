/**
 * Database adapter types — re-exported from @tearleads/db/adapter.
 * Platform-specific runtime helpers (getPlatformInfo) remain here.
 */

import type { PlatformInfo } from '@tearleads/db/adapter';

export type {
  DatabaseAdapter,
  DatabaseConfig,
  DrizzleConnection,
  DrizzleConnectionMethod,
  Platform,
  PlatformInfo,
  QueryResult
} from '@tearleads/db/adapter';

/**
 * Get platform info for adapter selection.
 */
export function getPlatformInfo(): PlatformInfo {
  // Check for Electron first
  if (typeof window !== 'undefined' && window.electron) {
    return {
      platform: 'electron',
      supportsNativeEncryption: true,
      requiresWebWorker: false
    };
  }

  // Check for Capacitor native
  try {
    if (window.Capacitor?.isNativePlatform()) {
      const platform = window.Capacitor.getPlatform();
      if (platform === 'ios') {
        return {
          platform: 'ios',
          supportsNativeEncryption: true,
          requiresWebWorker: false
        };
      }
      if (platform === 'android') {
        return {
          platform: 'android',
          supportsNativeEncryption: true,
          requiresWebWorker: false
        };
      }
    }
  } catch {
    // Capacitor not available
  }

  // Default to web
  return {
    platform: 'web',
    supportsNativeEncryption: false,
    requiresWebWorker: true
  };
}
