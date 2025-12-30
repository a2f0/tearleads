/**
 * Database adapter factory.
 * Creates the appropriate adapter based on the current platform.
 */

import type { DatabaseAdapter, PlatformInfo } from './types';
import { getPlatformInfo } from './types';

export type { NodeAdapterOptions } from './node.adapter';
export { NodeAdapter } from './node.adapter';
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
    case 'electron': {
      const { ElectronAdapter } = await import('./electron.adapter');
      return new ElectronAdapter();
    }

    case 'ios':
    case 'android': {
      const { CapacitorAdapter } = await import('./capacitor.adapter');
      return new CapacitorAdapter();
    }

    default: {
      const { WebAdapter } = await import('./web.adapter');
      return new WebAdapter();
    }
  }
}
