/**
 * VFS (Virtual File System) utilities for SQLite WASM.
 */

import type { SQLite3Module, SQLiteOO1, SQLiteOO1WithOpfs } from './types';

/**
 * Debug logging for SQLite worker.
 * Only enabled in development to reduce production log noise.
 */
const DEBUG_SQLITE = import.meta.env?.DEV === true;

function debugLog(...args: unknown[]): void {
  if (DEBUG_SQLITE) {
    console.log(...args);
  }
}

function hasOpfsDb(oo1: SQLiteOO1): oo1 is SQLiteOO1WithOpfs {
  return 'OpfsDb' in oo1;
}

export function getVfsList(sqlite3: SQLite3Module | null): string[] {
  if (!sqlite3) return [];
  const listFn = sqlite3.capi.sqlite3_js_vfs_list;
  if (!listFn) return [];
  const vfsList = listFn();
  return Array.isArray(vfsList) ? vfsList : [];
}

export function getOpfsVfsName(sqlite3: SQLite3Module | null): string | null {
  const vfsList = getVfsList(sqlite3);
  if (vfsList.length === 0) return null;
  if (vfsList.includes('multipleciphers-opfs')) return 'multipleciphers-opfs';
  if (vfsList.includes('opfs')) return 'opfs';
  return null;
}

export function ensureMultipleciphersVfs(
  sqlite3: SQLite3Module | null,
  baseVfsName: string
): boolean {
  if (!sqlite3) return false;
  const createFn = sqlite3.capi.sqlite3mc_vfs_create;
  if (!createFn) {
    console.warn('sqlite3mc_vfs_create not available');
    return false;
  }

  const targetName = `multipleciphers-${baseVfsName}`;
  const vfsList = getVfsList(sqlite3);
  if (vfsList.includes(targetName)) return true;

  const rc = createFn(baseVfsName, 0);
  if (rc === sqlite3.capi.SQLITE_OK || rc === 0) {
    debugLog(`Registered ${targetName} VFS`);
    return true;
  }

  console.warn(`Failed to register ${targetName} VFS, rc=${rc}`);
  return false;
}

/**
 * Check if OPFS VFS is available and install it.
 */
export async function installOpfsVfs(
  sqlite3: SQLite3Module | null,
  sqliteBaseUrl: string | null
): Promise<boolean> {
  if (!sqlite3) return false;

  // Check if OPFS is already available
  if (sqlite3.opfs) {
    debugLog('OPFS VFS already installed');
    return true;
  }

  // Check browser support for OPFS
  if (typeof navigator?.storage?.getDirectory !== 'function') {
    console.warn('OPFS not supported in this browser');
    return false;
  }

  // Try to install OPFS VFS
  try {
    debugLog('OPFS installOpfsVfs type:', typeof sqlite3.installOpfsVfs);
    if (typeof sqlite3.installOpfsVfs === 'function') {
      const proxyUri = sqliteBaseUrl
        ? new URL('sqlite3-opfs-async-proxy.js', sqliteBaseUrl).href
        : undefined;
      debugLog('OPFS proxy URI:', proxyUri ?? 'default');
      await sqlite3.installOpfsVfs(proxyUri ? { proxyUri } : undefined);
      debugLog('OPFS VFS installed successfully');
      return true;
    }

    // Alternative: check for OpfsDb class
    if (hasOpfsDb(sqlite3.oo1) && sqlite3.oo1.OpfsDb) {
      debugLog('OpfsDb class available');
      return true;
    }

    console.warn('OPFS VFS installation not available');
    return false;
  } catch (error) {
    console.warn('Failed to install OPFS VFS:', error);
    return false;
  }
}
