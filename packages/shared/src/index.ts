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
}

// Utilities
export function formatDate(date: Date): string {
  return date.toISOString();
}
