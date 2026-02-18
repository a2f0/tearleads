import type { VfsCrdtPushOperation } from '@tearleads/shared';

export const CRDT_CLIENT_PUSH_SOURCE_TABLE = 'vfs_crdt_client_push';

export interface MaxWriteIdRow {
  max_write_id: number | string | null;
  max_occurred_at: Date | string | null;
}

export function toPushSourceId(
  userId: string,
  operation: VfsCrdtPushOperation
): string {
  return `${userId}:${operation.replicaId}:${operation.writeId}:${operation.opId}`;
}

export function toReplicaPrefix(userId: string, replicaId: string): string {
  return `${userId}:${replicaId}:`;
}

export function parseMaxWriteId(row: MaxWriteIdRow | undefined): number {
  if (!row) {
    return 0;
  }

  const value = row.max_write_id;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function parseOccurredAtMs(
  value: Date | string | null | undefined
): number | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    const parsedMs = value.getTime();
    return Number.isFinite(parsedMs) ? parsedMs : null;
  }

  const parsedMs = Date.parse(value);
  return Number.isFinite(parsedMs) ? parsedMs : null;
}

export function normalizeCanonicalOccurredAt(
  inputOccurredAt: string,
  maxOccurredAt: Date | string | null
): string {
  const inputOccurredAtMs = Date.parse(inputOccurredAt);
  if (!Number.isFinite(inputOccurredAtMs)) {
    throw new Error('operation occurredAt is invalid');
  }

  const maxOccurredAtMs = parseOccurredAtMs(maxOccurredAt);
  if (maxOccurredAtMs === null) {
    return new Date(inputOccurredAtMs).toISOString();
  }

  /**
   * Guardrail: canonical feed pagination keys off `occurred_at`. To prevent
   * cross-replica backfill (late commit with older client timestamp), enforce a
   * strictly increasing per-user feed clock at write time.
   */
  const canonicalOccurredAtMs =
    inputOccurredAtMs <= maxOccurredAtMs
      ? maxOccurredAtMs + 1
      : inputOccurredAtMs;
  return new Date(canonicalOccurredAtMs).toISOString();
}
