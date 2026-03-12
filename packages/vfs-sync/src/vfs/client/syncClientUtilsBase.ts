import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtSyncItem
} from '@tearleads/shared';
import type { VfsCrdtOpType } from '../protocol/sync-crdt.js';
import type { VfsSyncCursor } from '../protocol/sync-cursor.js';
import {
  DEFAULT_PULL_LIMIT,
  DEFAULT_REMATERIALIZATION_ATTEMPTS,
  MAX_CLIENT_ID_LENGTH,
  MAX_PULL_LIMIT,
  VALID_ACCESS_LEVELS,
  VALID_OP_TYPES,
  VALID_PRINCIPAL_TYPES
} from './syncClientUtilsTypes.js';

export function isAccessLevel(value: unknown): value is VfsAclAccessLevel {
  return (
    typeof value === 'string' &&
    VALID_ACCESS_LEVELS.some((candidate) => candidate === value)
  );
}

export function isPrincipalType(value: unknown): value is VfsAclPrincipalType {
  return (
    typeof value === 'string' &&
    VALID_PRINCIPAL_TYPES.some((candidate) => candidate === value)
  );
}

export function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeOccurredAt(value: unknown): string | null {
  const normalized = normalizeRequiredString(value);
  if (!normalized) {
    return null;
  }

  const parsedMs = Date.parse(normalized);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(parsedMs).toISOString();
}

export function parsePullLimit(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_PULL_LIMIT;
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(
      `pullLimit must be an integer between 1 and ${MAX_PULL_LIMIT}`
    );
  }

  if (value < 1 || value > MAX_PULL_LIMIT) {
    throw new Error(
      `pullLimit must be an integer between 1 and ${MAX_PULL_LIMIT}`
    );
  }

  return value;
}

export function validateClientId(value: string): void {
  if (value.length === 0 || value.length > MAX_CLIENT_ID_LENGTH) {
    throw new Error('clientId must be non-empty and at most 128 characters');
  }

  if (value.includes(':')) {
    throw new Error('clientId must not include ":"');
  }
}

export function parsePositiveSafeInteger(
  value: unknown,
  fieldName: string
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error(`${fieldName} must be a positive safe integer`);
  }

  return value;
}

export function cloneCursor(cursor: VfsSyncCursor): VfsSyncCursor {
  return {
    changedAt: cursor.changedAt,
    changeId: cursor.changeId
  };
}

export function toCursorFromItem(item: VfsCrdtSyncItem): VfsSyncCursor {
  const occurredAtMs = Date.parse(item.occurredAt);
  if (!Number.isFinite(occurredAtMs)) {
    throw new Error('transport returned item with invalid occurredAt');
  }

  const changeId = normalizeRequiredString(item.opId);
  if (!changeId) {
    throw new Error('transport returned item with missing opId');
  }

  return {
    changedAt: new Date(occurredAtMs).toISOString(),
    changeId
  };
}

export function lastItemCursor(items: VfsCrdtSyncItem[]): VfsSyncCursor | null {
  if (items.length === 0) {
    return null;
  }

  const lastItem = items[items.length - 1];
  if (!lastItem) {
    return null;
  }

  return toCursorFromItem(lastItem);
}

export function isCrdtOpType(value: unknown): value is VfsCrdtOpType {
  return (
    typeof value === 'string' &&
    VALID_OP_TYPES.some((candidate) => candidate === value)
  );
}

export function parseRematerializationAttempts(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_REMATERIALIZATION_ATTEMPTS;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(
      'maxRematerializationAttempts must be a non-negative integer'
    );
  }

  return value;
}

export interface InMemoryVfsCrdtSyncTransportDelayConfig {
  pushDelayMs?: number;
  pullDelayMs?: number;
}

export async function delayVfsCrdtSyncTransport(
  delays: InMemoryVfsCrdtSyncTransportDelayConfig,
  type: 'push' | 'pull'
): Promise<void> {
  const delayMs = type === 'push' ? delays.pushDelayMs : delays.pullDelayMs;
  if (typeof delayMs !== 'number' || !Number.isFinite(delayMs)) {
    return;
  }

  await sleep(delayMs);
}

function sleep(ms: number): Promise<void> {
  if (ms < 1) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
