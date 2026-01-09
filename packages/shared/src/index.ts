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
