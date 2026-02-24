/**
 * Shared types and utilities
 */

import { assertPlainArrayBuffer, isRecord } from './typeGuards.js';

export * from './crypto/asymmetric.js';
export * from './crypto/vfsKeyBundles.js';
// Crypto utilities
export * from './crypto/webCrypto.js';

// Note: Redis client is exported separately via '@tearleads/shared/redis'
// to avoid bundling Node.js-only code into browser bundles

// License types
export interface LicenseInfo {
  name: string;
  version: string;
  license: string;
  repository?: string;
}

// Sub-modules
export * from './admin.js';
// AI conversations
export * from './aiConversations.js';
export * from './auth.js';
// Chat validation helpers
export * from './chat.js';
// Media drag-and-drop helpers
export * from './mediaDragData.js';
export * from './mlsTypes.js';
// OpenRouter model options
export * from './openrouter.js';
// Postgres dev-mode defaults
export * from './postgresDefaults.js';
// Tree utilities
export * from './tree/index.js';
// Type guards
export * from './typeGuards/vfs.js';
// Domain type bundles
export * from './vfsTypes.js';

// Types
export interface PingData {
  version: string;
  dbVersion: string;
  emailDomain?: string;
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

export { assertPlainArrayBuffer, isRecord };

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
 * Safely extract an error message from an unknown error value.
 * Falls back to String(error) if no message property is found.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (isRecord(error) && typeof error['message'] === 'string') {
    return error['message'];
  }
  return String(error);
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
