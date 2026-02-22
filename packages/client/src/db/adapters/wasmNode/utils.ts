/**
 * Utility functions for WASM SQLite adapter.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isRecord } from '@tearleads/shared';
import type { JsonBackupData } from './types';

// Store original fetch to restore later
const originalFetch = globalThis.fetch;

/**
 * Polyfill fetch for file:// URLs in Node.js.
 * The SQLite WASM module uses fetch to load the .wasm file, which doesn't work
 * with file:// URLs in Node.js. This polyfill handles that case.
 */
export function patchFetchForFileUrls(): void {
  globalThis.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();

    // Handle file:// URLs by reading from filesystem
    if (url.startsWith('file://')) {
      const filePath = fileURLToPath(url);
      const buffer = fs.readFileSync(filePath);
      return new Response(buffer, {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/wasm' }
      });
    }

    // Fall back to original fetch for other URLs
    return originalFetch(input, init);
  };
}

/**
 * Restore the original fetch function.
 */
export function restoreFetch(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
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
