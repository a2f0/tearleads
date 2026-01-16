/**
 * Database adapter factory.
 * Creates the appropriate adapter based on the current platform.
 *
 * Note: We use static imports instead of dynamic imports because Android WebView
 * has issues loading dynamically chunked modules. The platform-specific code is
 * still only executed on the appropriate platform.
 */

import { CapacitorAdapter } from './capacitor.adapter';
import { ElectronAdapter } from './electron.adapter';
import {
  type DatabaseAdapter,
  getPlatformInfo,
  type PlatformInfo
} from './types';
import { WebAdapter } from './web.adapter';

// Note: NodeAdapter is intentionally NOT exported here.
// It uses Node.js-only modules (fs, os, path, better-sqlite3-multiple-ciphers)
// and is only meant for Vitest integration tests.
// Import directly from './node.adapter' in test files.

export type {
  DatabaseAdapter,
  DatabaseConfig,
  Platform,
  PlatformInfo,
  QueryResult
} from './types';
export { getPlatformInfo } from './types';

/**
 * Create a database adapter for the current platform.
 */
export async function createAdapter(
  platformInfo?: PlatformInfo
): Promise<DatabaseAdapter> {
  const info = platformInfo ?? getPlatformInfo();

  switch (info.platform) {
    case 'electron':
      return new ElectronAdapter();

    case 'ios':
    case 'android':
      // Use CapacitorAdapter (native SQLCipher) on mobile.
      // OPFS/WebAdapter requires SharedArrayBuffer which isn't available in
      // iOS WebView due to missing COOP/COEP header support.
      // See: https://github.com/a2f0/rapid/issues/772
      return new CapacitorAdapter();

    case 'web':
      return new WebAdapter();

    default:
      // The 'node' platform should use direct import of NodeAdapter, not this factory.
      // Throw for any other unexpected platform to avoid silent failures.
      throw new Error(
        `Unsupported platform in createAdapter: ${info.platform}`
      );
  }
}
