/**
 * Shared types and utilities
 */

// Types
export interface PingData {
  version: string;
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
