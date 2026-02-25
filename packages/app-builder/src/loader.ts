import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateAppConfig } from './schema.js';
import type { LoadedAppConfig } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * The default app ID used when no APP env var is set.
 * This is the full-featured tearleads app.
 */
export const DEFAULT_APP_ID = 'tearleads';

/**
 * Get the default app ID.
 */
export function getDefaultAppId(): string {
  return DEFAULT_APP_ID;
}

/**
 * Get the path to the apps directory.
 */
export function getAppsDir(): string {
  return join(__dirname, '..', 'apps');
}

/**
 * List all available app IDs.
 */
export function listApps(): string[] {
  const appsDir = getAppsDir();
  if (!existsSync(appsDir)) {
    return [];
  }

  return readdirSync(appsDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .sort();
}

/**
 * Load and validate an app configuration by ID.
 * @throws Error if app not found or config invalid
 */
export async function loadAppConfig(appId: string): Promise<LoadedAppConfig> {
  const appsDir = getAppsDir();
  const configDir = join(appsDir, appId);
  const configPath = join(configDir, 'config.ts');

  if (!existsSync(configDir)) {
    throw new Error(
      `App "${appId}" not found. Available apps: ${listApps().join(', ')}`
    );
  }

  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  // Dynamic import of the config file.
  // pathToFileURL is required because on Windows, absolute paths like D:\...
  // are misinterpreted by the ESM loader as having a "D:" URL scheme.
  // Converting to a file:// URL works correctly on all platforms.
  const configModule = await import(pathToFileURL(configPath).href);
  const rawConfig = configModule.default as unknown;

  // Validate the config
  const config = validateAppConfig(rawConfig);

  // Verify the config ID matches the directory name
  if (config.id !== appId) {
    throw new Error(
      `Config ID mismatch: config.id="${config.id}" but directory is "${appId}". ` +
        'These must match.'
    );
  }

  return {
    config,
    configDir,
    assetsDir: join(configDir, 'assets')
  };
}
