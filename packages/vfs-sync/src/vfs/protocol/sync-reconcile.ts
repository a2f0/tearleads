import { isRecord } from '@tearleads/shared';
import { decodeVfsSyncCursor, type VfsSyncCursor } from './sync-cursor.js';

export interface ParsedVfsSyncReconcilePayload {
  clientId: string;
  cursor: VfsSyncCursor;
}

export type ParseVfsSyncReconcilePayloadResult =
  | {
      ok: true;
      value: ParsedVfsSyncReconcilePayload;
    }
  | {
      ok: false;
      error: string;
    };

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function parseVfsSyncReconcilePayload(
  body: unknown
): ParseVfsSyncReconcilePayloadResult {
  if (!isRecord(body)) {
    return {
      ok: false,
      error: 'clientId and cursor are required'
    };
  }

  const clientId = normalizeString(body['clientId']);
  const cursorValue = normalizeString(body['cursor']);

  if (!clientId || !cursorValue) {
    return {
      ok: false,
      error: 'clientId and cursor are required'
    };
  }

  const cursor = decodeVfsSyncCursor(cursorValue);
  if (!cursor) {
    return {
      ok: false,
      error: 'Invalid cursor'
    };
  }

  return {
    ok: true,
    value: {
      clientId,
      cursor
    }
  };
}

export function compareVfsSyncCursorOrder(
  left: VfsSyncCursor,
  right: VfsSyncCursor
): number {
  const leftTime = Date.parse(left.changedAt);
  const rightTime = Date.parse(right.changedAt);

  if (leftTime < rightTime) {
    return -1;
  }

  if (leftTime > rightTime) {
    return 1;
  }

  if (left.changeId < right.changeId) {
    return -1;
  }

  if (left.changeId > right.changeId) {
    return 1;
  }

  return 0;
}

export interface ReconcileVfsSyncCursorResult {
  cursor: VfsSyncCursor;
  advanced: boolean;
}

export function reconcileVfsSyncCursor(
  currentCursor: VfsSyncCursor | null,
  incomingCursor: VfsSyncCursor
): ReconcileVfsSyncCursorResult {
  if (!currentCursor) {
    return {
      cursor: incomingCursor,
      advanced: true
    };
  }

  const comparison = compareVfsSyncCursorOrder(currentCursor, incomingCursor);
  if (comparison >= 0) {
    return {
      cursor: currentCursor,
      advanced: false
    };
  }

  return {
    cursor: incomingCursor,
    advanced: true
  };
}

export class InMemoryVfsSyncClientStateStore {
  private readonly state: Map<string, VfsSyncCursor> = new Map();

  private getKey(userId: string, clientId: string): string {
    return `${userId}:${clientId}`;
  }

  get(userId: string, clientId: string): VfsSyncCursor | null {
    return this.state.get(this.getKey(userId, clientId)) ?? null;
  }

  reconcile(
    userId: string,
    clientId: string,
    incomingCursor: VfsSyncCursor
  ): ReconcileVfsSyncCursorResult {
    const key = this.getKey(userId, clientId);
    const currentCursor = this.state.get(key) ?? null;
    const result = reconcileVfsSyncCursor(currentCursor, incomingCursor);
    this.state.set(key, result.cursor);
    return result;
  }
}
