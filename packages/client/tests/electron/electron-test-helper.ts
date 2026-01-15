import {_electron as electron, ElectronApplication} from '@playwright/test';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const mainPath = join(__dirname, '../../out/main/main.js');

/**
 * Determines if tests should run in headed (visible window) mode.
 * Set HEADED=true to run tests with visible windows.
 * Default: headless mode (no visible windows).
 */
const isHeaded = process.env['HEADED'] === 'true';

/**
 * Build Electron launch arguments based on the current environment.
 * - Default: headless mode with GPU disabled
 * - HEADED=true: visible window mode
 */
export function getElectronArgs(): string[] {
  const args = [mainPath];

  if (!isHeaded) {
    // Headless mode: disable GPU and sandbox for stability
    args.push('--no-sandbox', '--disable-gpu');
  }

  return args;
}

export interface LaunchOptions {
  /**
   * Clear all storage (IndexedDB, localStorage, etc.) before the app loads.
   * Default: true for test isolation.
   * Set to false for tests that verify data persistence across app restarts.
   */
  clearStorage?: boolean;
}

/**
 * Launch Electron app for testing.
 * Uses headless mode by default. Set HEADED=true env var for visible windows.
 * Clears all storage data by default to ensure test isolation.
 *
 * @param options.clearStorage - Whether to clear storage before app loads (default: true)
 */
export async function launchElectronApp(
  options: LaunchOptions = {}
): Promise<ElectronApplication> {
  const {clearStorage = true} = options;

  const app = await electron.launch({
    args: getElectronArgs(),
  });

  if (clearStorage) {
    // Clear all storage to ensure clean state for each test.
    // This is more robust than UI-based reset as it works even if app UI is broken.
    // Omitting the storages option clears all storage types by default.
    await app.evaluate(async ({session}) => {
      await session.defaultSession.clearStorageData();
    });
  }

  return app;
}
