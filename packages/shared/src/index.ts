/**
 * Shared types and utilities
 */

// Crypto utilities
export * from './crypto/web-crypto.js';

// Note: Redis client is exported separately via '@rapid/shared/redis'
// to avoid bundling Node.js-only code into browser bundles

// License types
export interface LicenseInfo {
  name: string;
  version: string;
  license: string;
  repository?: string;
}

// OpenRouter model options
export * from './openrouter.js';

// Types
export interface PingData {
  version: string;
  dbVersion: string;
}

// Admin types
export interface RedisKeyInfo {
  key: string;
  type: string;
  ttl: number;
}

export interface RedisKeysResponse {
  keys: RedisKeyInfo[];
  cursor: string;
  hasMore: boolean;
}

export interface RedisKeyValueResponse {
  key: string;
  type: string;
  ttl: number;
  value: string | string[] | Record<string, string> | null;
}

// SSE types
export type SSEConnectionState = 'connected' | 'connecting' | 'disconnected';

export interface BroadcastMessage {
  type: string;
  payload: unknown;
  timestamp: string;
}

export interface SSEMessage {
  channel: string;
  message: BroadcastMessage;
}

// Utilities
export function formatDate(date: Date): string {
  return date.toISOString();
}

// Type Guards

/**
 * Type guard to check if a value is a non-null object (record).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Assertion function to narrow Uint8Array<ArrayBufferLike> to Uint8Array<ArrayBuffer>.
 *
 * With @tsconfig/strictest, Uint8Array is typed as Uint8Array<ArrayBufferLike>
 * where ArrayBufferLike = ArrayBuffer | SharedArrayBuffer. Web Crypto API and
 * Blob constructor expect plain ArrayBuffer, not ArrayBufferLike.
 *
 * In practice, Uint8Arrays always use plain ArrayBuffer - SharedArrayBuffer
 * requires explicit opt-in and specific headers. This assertion narrows the type
 * by checking for SharedArrayBuffer rather than ArrayBuffer (since instanceof
 * ArrayBuffer can fail across realms in test environments).
 */
export function assertPlainArrayBuffer(
  arr: Uint8Array<ArrayBufferLike>
): asserts arr is Uint8Array<ArrayBuffer> {
  if (
    typeof SharedArrayBuffer !== 'undefined' &&
    arr.buffer instanceof SharedArrayBuffer
  ) {
    throw new Error(
      'Unexpected SharedArrayBuffer backing Uint8Array. This should never occur in normal operation.'
    );
  }
}

/**
 * Safely extract an error code from an unknown error value.
 * Returns undefined if the error doesn't have a string code property.
 */
export function getErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  const code = error['code'];
  return typeof code === 'string' ? code : undefined;
}

/**
 * Safely convert a value to a finite number, returning null if not possible.
 * Handles both numbers and numeric strings (useful for SQLite query results).
 */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}
