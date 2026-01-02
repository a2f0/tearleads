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
  const baseArgs = [mainPath];

  if (isHeaded) {
    // Headed mode: just launch with the main path
    return baseArgs;
  }

  // Headless mode: disable GPU and sandbox for stability
  return [...baseArgs, '--no-sandbox', '--disable-gpu'];
}

/**
 * Launch Electron app for testing.
 * Uses headless mode by default. Set HEADED=true env var for visible windows.
 */
export async function launchElectronApp(): Promise<ElectronApplication> {
  return electron.launch({
    args: getElectronArgs(),
  });
}
