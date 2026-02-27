/**
 * Utility functions for WASM SQLite adapter.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isRecord } from '@tearleads/shared';
import type { JsonBackupData } from './types';

// Store original fetch to restore later
let originalFetch: typeof fetch | null = null;

function getStringProperty(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const property = Reflect.get(value, key);
  return typeof property === 'string' ? property : null;
}

function resolveFetchInputUrl(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  const url = getStringProperty(input, 'url');
  if (url) {
    return url;
  }
  const href = getStringProperty(input, 'href');
  if (href) {
    return href;
  }
  const fallback = String(input);
  return fallback.includes('://') ? fallback : null;
}

/**
 * Polyfill fetch for file:// URLs in Node.js.
 * The SQLite WASM module uses fetch to load the .wasm file, which doesn't work
 * with file:// URLs in Node.js. This polyfill handles that case.
 */
export function patchFetchForFileUrls(): void {
  if (!originalFetch) {
    originalFetch = globalThis.fetch;
  }
  const fallbackFetch = originalFetch;

  globalThis.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url = resolveFetchInputUrl(input);

    // Handle file:// URLs by reading from filesystem
    if (typeof url === 'string' && url.startsWith('file://')) {
      const filePath = fileURLToPath(url);
      const buffer = fs.readFileSync(filePath);
      if (!fallbackFetch) {
        throw new Error('Fetch is not available in this environment');
      }
      const dataUrl = `data:application/wasm;base64,${buffer.toString('base64')}`;
      return fallbackFetch(dataUrl, init);
    }

    // Fall back to original fetch for other URLs
    if (!fallbackFetch) {
      throw new Error('Fetch is not available in this environment');
    }
    return fallbackFetch(input, init);
  };
}

/**
 * Restore the original fetch function.
 */
export function restoreFetch(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
  }
}

export function getStringField(
  record: Record<string, unknown>,
  key: string
): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function isNameSqlEntry(
  value: unknown
): value is { name: string; sql: string } {
  return (
    isRecord(value) &&
    typeof value['name'] === 'string' &&
    typeof value['sql'] === 'string'
  );
}

export function isJsonBackupData(value: unknown): value is JsonBackupData {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value['version'] !== 'number') {
    return false;
  }

  if (
    !Array.isArray(value['tables']) ||
    !value['tables'].every(isNameSqlEntry) ||
    !Array.isArray(value['indexes']) ||
    !value['indexes'].every(isNameSqlEntry)
  ) {
    return false;
  }

  if (!isRecord(value['data'])) {
    return false;
  }

  for (const tableRows of Object.values(value['data'])) {
    if (!Array.isArray(tableRows)) {
      return false;
    }
    for (const row of tableRows) {
      if (!isRecord(row)) {
        return false;
      }
    }
  }

  return true;
}

export function parseJsonBackupData(jsonData: string): JsonBackupData {
  const parsed = JSON.parse(jsonData);
  if (!isJsonBackupData(parsed)) {
    throw new Error('Invalid backup data format');
  }
  return parsed;
}

/**
 * Convert a Uint8Array encryption key to a hex string for SQLite.
 */
export function keyToHex(key: Uint8Array): string {
  return Array.from(key)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
