import { isRecord } from '@tearleads/shared';
import type { VfsSyncCursor } from './sync-cursor.js';
import {
  compareVfsSyncCursorOrder,
  parseVfsSyncReconcilePayload
} from './sync-reconcile.js';

const MAX_REPLICA_ID_LENGTH = 128;
const MAX_LAST_WRITE_ID_ENTRIES = 512;

export type VfsCrdtLastReconciledWriteIds = Record<string, number>;

export interface ParsedVfsCrdtReconcilePayload {
  clientId: string;
  cursor: VfsSyncCursor;
  lastReconciledWriteIds: VfsCrdtLastReconciledWriteIds;
}

export type ParseVfsCrdtReconcilePayloadResult =
  | {
      ok: true;
      value: ParsedVfsCrdtReconcilePayload;
    }
  | {
      ok: false;
      error: string;
    };

export type ParseVfsCrdtLastReconciledWriteIdsResult =
  | {
      ok: true;
      value: VfsCrdtLastReconciledWriteIds;
    }
  | {
      ok: false;
      error: string;
    };

export interface VfsCrdtClientReconcileState {
  cursor: VfsSyncCursor;
  lastReconciledWriteIds: VfsCrdtLastReconciledWriteIds;
}

export interface ReconcileVfsCrdtClientStateResult {
  state: VfsCrdtClientReconcileState;
  advancedCursor: boolean;
  advancedLastReconciledWriteIds: boolean;
}

function normalizeReplicaId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_REPLICA_ID_LENGTH) {
    return null;
  }

  if (trimmed.includes(':')) {
    return null;
  }

  return trimmed;
}

function normalizeWriteId(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  if (!Number.isInteger(value) || value < 1) {
    return null;
  }

  if (value > Number.MAX_SAFE_INTEGER) {
    return null;
  }

  return value;
}

function cloneCursor(cursor: VfsSyncCursor): VfsSyncCursor {
  return {
    changedAt: cursor.changedAt,
    changeId: cursor.changeId
  };
}

function toSortedLastWriteIds(
  values: Map<string, number>
): VfsCrdtLastReconciledWriteIds {
  const sortedEntries = Array.from(values.entries()).sort((left, right) =>
    left[0].localeCompare(right[0])
  );

  const result: VfsCrdtLastReconciledWriteIds = {};
  for (const [replicaId, writeId] of sortedEntries) {
    result[replicaId] = writeId;
  }

  return result;
}

function areLastWriteIdsEqual(
  left: VfsCrdtLastReconciledWriteIds,
  right: VfsCrdtLastReconciledWriteIds
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }

  return true;
}

function cloneState(
  state: VfsCrdtClientReconcileState
): VfsCrdtClientReconcileState {
  return {
    cursor: cloneCursor(state.cursor),
    lastReconciledWriteIds: { ...state.lastReconciledWriteIds }
  };
}

/**
 * Parse and validate per-replica last write IDs from CRDT reconcile payloads.
 * Guardrails:
 * - replica IDs must be non-empty, <=128 chars, and cannot include ':'
 * - write IDs must be positive safe integers
 * - map size is bounded to protect reconcile path determinism under abuse
 */
export function parseVfsCrdtLastReconciledWriteIds(
  value: unknown
): ParseVfsCrdtLastReconciledWriteIdsResult {
  if (value === undefined || value === null) {
    return {
      ok: true,
      value: {}
    };
  }

  if (!isRecord(value)) {
    return {
      ok: false,
      error:
        'lastReconciledWriteIds must be an object map of replicaId -> writeId'
    };
  }

  const entries = Object.entries(value);
  if (entries.length > MAX_LAST_WRITE_ID_ENTRIES) {
    return {
      ok: false,
      error: `lastReconciledWriteIds exceeds max entries (${MAX_LAST_WRITE_ID_ENTRIES})`
    };
  }

  const normalizedEntries = new Map<string, number>();
  for (const [rawReplicaId, rawWriteId] of entries) {
    const replicaId = normalizeReplicaId(rawReplicaId);
    if (!replicaId) {
      return {
        ok: false,
        error:
          'lastReconciledWriteIds contains invalid replicaId (must be non-empty, <=128 chars, and must not include ":")'
      };
    }

    const writeId = normalizeWriteId(rawWriteId);
    if (writeId === null) {
      return {
        ok: false,
        error:
          'lastReconciledWriteIds contains invalid writeId (must be a positive integer)'
      };
    }

    const existingWriteId = normalizedEntries.get(replicaId) ?? 0;
    if (writeId > existingWriteId) {
      normalizedEntries.set(replicaId, writeId);
    }
  }

  return {
    ok: true,
    value: toSortedLastWriteIds(normalizedEntries)
  };
}

export function parseVfsCrdtReconcilePayload(
  body: unknown
): ParseVfsCrdtReconcilePayloadResult {
  const basePayload = parseVfsSyncReconcilePayload(body);
  if (!basePayload.ok) {
    return basePayload;
  }

  if (!isRecord(body)) {
    return {
      ok: false,
      error: 'clientId and cursor are required'
    };
  }

  const parsedLastWriteIds = parseVfsCrdtLastReconciledWriteIds(
    body['lastReconciledWriteIds']
  );
  if (!parsedLastWriteIds.ok) {
    return parsedLastWriteIds;
  }

  return {
    ok: true,
    value: {
      clientId: basePayload.value.clientId,
      cursor: basePayload.value.cursor,
      lastReconciledWriteIds: parsedLastWriteIds.value
    }
  };
}

/**
 * Merge replica clocks monotonically: each replica keeps max(writeId).
 */
export function mergeVfsCrdtLastReconciledWriteIds(
  current: VfsCrdtLastReconciledWriteIds,
  incoming: VfsCrdtLastReconciledWriteIds
): VfsCrdtLastReconciledWriteIds {
  const merged = new Map<string, number>();

  for (const [replicaId, writeId] of Object.entries(current)) {
    merged.set(replicaId, writeId);
  }

  for (const [replicaId, writeId] of Object.entries(incoming)) {
    const existingWriteId = merged.get(replicaId) ?? 0;
    if (writeId > existingWriteId) {
      merged.set(replicaId, writeId);
    }
  }

  return toSortedLastWriteIds(merged);
}

export function reconcileVfsCrdtClientState(
  currentState: VfsCrdtClientReconcileState | null,
  incomingCursor: VfsSyncCursor,
  incomingLastWriteIds: VfsCrdtLastReconciledWriteIds
): ReconcileVfsCrdtClientStateResult {
  if (!currentState) {
    const state: VfsCrdtClientReconcileState = {
      cursor: cloneCursor(incomingCursor),
      lastReconciledWriteIds: { ...incomingLastWriteIds }
    };
    return {
      state,
      advancedCursor: true,
      advancedLastReconciledWriteIds:
        Object.keys(state.lastReconciledWriteIds).length > 0
    };
  }

  const cursorComparison = compareVfsSyncCursorOrder(
    currentState.cursor,
    incomingCursor
  );
  const nextCursor =
    cursorComparison < 0
      ? cloneCursor(incomingCursor)
      : cloneCursor(currentState.cursor);
  const mergedLastWriteIds = mergeVfsCrdtLastReconciledWriteIds(
    currentState.lastReconciledWriteIds,
    incomingLastWriteIds
  );

  return {
    state: {
      cursor: nextCursor,
      lastReconciledWriteIds: mergedLastWriteIds
    },
    advancedCursor: cursorComparison < 0,
    advancedLastReconciledWriteIds: !areLastWriteIdsEqual(
      currentState.lastReconciledWriteIds,
      mergedLastWriteIds
    )
  };
}

export class InMemoryVfsCrdtClientStateStore {
  private readonly state: Map<string, VfsCrdtClientReconcileState> = new Map();

  private getKey(userId: string, clientId: string): string {
    return `${userId}:${clientId}`;
  }

  get(userId: string, clientId: string): VfsCrdtClientReconcileState | null {
    const currentState = this.state.get(this.getKey(userId, clientId));
    return currentState ? cloneState(currentState) : null;
  }

  reconcile(
    userId: string,
    clientId: string,
    incomingCursor: VfsSyncCursor,
    incomingLastWriteIds: VfsCrdtLastReconciledWriteIds
  ): ReconcileVfsCrdtClientStateResult {
    const key = this.getKey(userId, clientId);
    const currentState = this.state.get(key) ?? null;
    const result = reconcileVfsCrdtClientState(
      currentState,
      incomingCursor,
      incomingLastWriteIds
    );

    this.state.set(key, cloneState(result.state));
    return {
      state: cloneState(result.state),
      advancedCursor: result.advancedCursor,
      advancedLastReconciledWriteIds: result.advancedLastReconciledWriteIds
    };
  }
}
