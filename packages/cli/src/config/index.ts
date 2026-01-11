/**
 * Configuration directory management for ~/.tearleads
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface ConfigPaths {
  root: string;
  database: string;
  keyData: string;
  session: string;
}

let configRoot: string | null = null;

/**
 * Set a custom config root (for testing).
 */
export function setConfigRoot(root: string | null): void {
  configRoot = root;
}

/**
 * Get the configuration directory paths.
 */
export function getConfigPaths(): ConfigPaths {
  const root = configRoot ?? path.join(os.homedir(), '.tearleads');
  return {
    root,
    database: path.join(root, 'tearleads.db'),
    keyData: path.join(root, 'keydata.json'),
    session: path.join(root, '.session')
  };
}

/**
 * Ensure the config directory exists with proper permissions.
 */
export async function ensureConfigDir(): Promise<void> {
  const paths = getConfigPaths();
  await fs.mkdir(paths.root, { recursive: true, mode: 0o700 });
}

/**
 * Check if the config directory exists.
 */
export async function configExists(): Promise<boolean> {
  const paths = getConfigPaths();
  try {
    await fs.access(paths.root);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the database is set up (keydata.json exists).
 */
export async function isDatabaseSetUp(): Promise<boolean> {
  const paths = getConfigPaths();
  try {
    await fs.access(paths.keyData);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a session file exists.
 */
export async function hasSession(): Promise<boolean> {
  const paths = getConfigPaths();
  try {
    await fs.access(paths.session);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear the session file.
 */
export async function clearSession(): Promise<void> {
  const paths = getConfigPaths();
  try {
    await fs.unlink(paths.session);
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Remove all config files (for reset).
 */
export async function clearConfig(): Promise<void> {
  const paths = getConfigPaths();
  try {
    await fs.rm(paths.root, { recursive: true, force: true });
  } catch {
    // Ignore errors
  }
}
