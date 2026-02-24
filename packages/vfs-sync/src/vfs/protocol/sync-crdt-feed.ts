import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtOpType,
  VfsCrdtSyncItem,
  VfsCrdtSyncResponse
} from '@tearleads/shared';
import { VFS_CRDT_SYNC_SQL } from './sync-crdt-feed-sql.js';
import {
  decodeVfsSyncCursor,
  encodeVfsSyncCursor,
  type VfsSyncCursor
} from './sync-cursor.js';

const DEFAULT_SYNC_LIMIT = 100;
const MAX_SYNC_LIMIT = 500;

export interface ParseVfsCrdtSyncQueryInput {
  limit?: unknown;
  cursor?: unknown;
  rootId?: unknown;
}

export interface ParsedVfsCrdtSyncQuery {
  limit: number;
  cursor: VfsSyncCursor | null;
  rootId: string | null;
}

export type ParseVfsCrdtSyncQueryResult =
  | {
      ok: true;
      value: ParsedVfsCrdtSyncQuery;
    }
  | {
      ok: false;
      error: string;
    };

export interface BuildVfsCrdtSyncQueryInput {
  userId: string;
  limit: number;
  cursor: VfsSyncCursor | null;
  rootId: string | null;
}

export interface VfsCrdtSyncDbQuery {
  text: string;
  values: Array<string | number | null>;
}

export interface VfsCrdtSyncDbRow {
  op_id: string;
  item_id: string;
  op_type: string;
  principal_type: string | null;
  principal_id: string | null;
  access_level: string | null;
  parent_id: string | null;
  child_id: string | null;
  actor_id: string | null;
  source_table: string;
  source_id: string;
  occurred_at: Date | string;
  encrypted_payload?: string | null;
  key_epoch?: number | string | null;
  encryption_nonce?: string | null;
  encryption_aad?: string | null;
  encryption_signature?: string | null;
}

export type VfsCrdtFeedOrderViolationCode =
  | 'invalidOccurredAt'
  | 'missingOpId'
  | 'duplicateOpId'
  | 'outOfOrderRow'
  | 'invalidLinkPayload'
  | 'invalidEncryptedEnvelope';

export class VfsCrdtFeedOrderViolationError extends Error {
  readonly code: VfsCrdtFeedOrderViolationCode;
  readonly rowIndex: number;

  constructor(
    code: VfsCrdtFeedOrderViolationCode,
    rowIndex: number,
    message: string
  ) {
    super(message);
    this.name = 'VfsCrdtFeedOrderViolationError';
    this.code = code;
    this.rowIndex = rowIndex;
  }
}

const VALID_ACCESS_LEVELS: VfsAclAccessLevel[] = ['read', 'write', 'admin'];
const VALID_OP_TYPES: VfsCrdtOpType[] = [
  'acl_add',
  'acl_remove',
  'link_add',
  'link_remove',
  'item_upsert',
  'item_delete'
];
const VALID_PRINCIPAL_TYPES: VfsAclPrincipalType[] = [
  'user',
  'group',
  'organization'
];

function parseSyncLimit(value: unknown): number | null {
  if (value === undefined) {
    return DEFAULT_SYNC_LIMIT;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (parsed < 1 || parsed > MAX_SYNC_LIMIT) {
    return null;
  }

  return parsed;
}

function parseOptionalString(
  value: unknown,
  name: string,
  allowEmpty: boolean
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined) {
    return {
      ok: true,
      value: null
    };
  }

  if (typeof value !== 'string') {
    return {
      ok: false,
      error: `${name} must be a string`
    };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    if (allowEmpty) {
      return {
        ok: true,
        value: null
      };
    }

    return {
      ok: false,
      error: `${name} must not be empty`
    };
  }

  return {
    ok: true,
    value: trimmed
  };
}

function parseOccurredAtMs(value: Date | string): number | null {
  if (value instanceof Date) {
    const asMs = value.getTime();
    return Number.isFinite(asMs) ? asMs : null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toIsoString(value: Date | string): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

function normalizeAccessLevel(value: unknown): VfsAclAccessLevel | null {
  if (typeof value !== 'string') {
    return null;
  }

  for (const accessLevel of VALID_ACCESS_LEVELS) {
    if (accessLevel === value) {
      return accessLevel;
    }
  }

  return null;
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    if (
      Number.isFinite(value) &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= Number.MAX_SAFE_INTEGER
    ) {
      return value;
    }
    return null;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (
      Number.isFinite(parsed) &&
      Number.isInteger(parsed) &&
      parsed >= 1 &&
      parsed <= Number.MAX_SAFE_INTEGER
    ) {
      return parsed;
    }
  }

  return null;
}

function normalizeOpType(value: unknown): VfsCrdtOpType {
  if (typeof value === 'string') {
    for (const opType of VALID_OP_TYPES) {
      if (opType === value) {
        return opType;
      }
    }
  }

  return 'acl_add';
}

function normalizePrincipalType(value: unknown): VfsAclPrincipalType | null {
  if (typeof value === 'string') {
    for (const principalType of VALID_PRINCIPAL_TYPES) {
      if (principalType === value) {
        return principalType;
      }
    }
  }

  return null;
}

export function parseVfsCrdtSyncQuery(
  input: ParseVfsCrdtSyncQueryInput
): ParseVfsCrdtSyncQueryResult {
  const limit = parseSyncLimit(input.limit);
  if (limit === null) {
    return {
      ok: false,
      error: `limit must be an integer between 1 and ${MAX_SYNC_LIMIT}`
    };
  }

  const parsedCursor = parseOptionalString(input.cursor, 'cursor', true);
  if (!parsedCursor.ok) {
    return parsedCursor;
  }

  const parsedRootId = parseOptionalString(input.rootId, 'rootId', true);
  if (!parsedRootId.ok) {
    return parsedRootId;
  }

  const cursorValue = parsedCursor.value;
  const cursor = cursorValue ? decodeVfsSyncCursor(cursorValue) : null;
  if (cursorValue && !cursor) {
    return {
      ok: false,
      error: 'Invalid cursor'
    };
  }

  return {
    ok: true,
    value: {
      limit,
      cursor,
      rootId: parsedRootId.value
    }
  };
}

export function buildVfsCrdtSyncQuery(
  input: BuildVfsCrdtSyncQueryInput
): VfsCrdtSyncDbQuery {
  return {
    text: VFS_CRDT_SYNC_SQL,
    values: [
      input.userId,
      input.cursor?.changedAt ?? null,
      input.cursor?.changeId ?? null,
      input.limit + 1,
      input.rootId
    ]
  };
}

export function assertStronglyConsistentVfsCrdtRows(
  rows: VfsCrdtSyncDbRow[]
): void {
  const seenOpIds = new Set<string>();
  let previous: { occurredAtMs: number; opId: string } | null = null;

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!row) {
      continue;
    }

    if (!isNonEmptyString(row.op_id)) {
      throw new VfsCrdtFeedOrderViolationError(
        'missingOpId',
        index,
        `CRDT row ${index} is missing op_id`
      );
    }

    if (seenOpIds.has(row.op_id)) {
      throw new VfsCrdtFeedOrderViolationError(
        'duplicateOpId',
        index,
        `CRDT row ${index} repeats op_id ${row.op_id}`
      );
    }
    seenOpIds.add(row.op_id);

    const occurredAtMs = parseOccurredAtMs(row.occurred_at);
    if (occurredAtMs === null) {
      throw new VfsCrdtFeedOrderViolationError(
        'invalidOccurredAt',
        index,
        `CRDT row ${index} has invalid occurred_at`
      );
    }

    if (
      previous &&
      (occurredAtMs < previous.occurredAtMs ||
        (occurredAtMs === previous.occurredAtMs && row.op_id <= previous.opId))
    ) {
      throw new VfsCrdtFeedOrderViolationError(
        'outOfOrderRow',
        index,
        `CRDT row ${index} violates required ordering`
      );
    }

    previous = {
      occurredAtMs,
      opId: row.op_id
    };
  }
}

export function mapVfsCrdtSyncRows(
  rows: VfsCrdtSyncDbRow[],
  limit: number,
  lastReconciledWriteIds: Record<string, number> = {}
): VfsCrdtSyncResponse {
  assertStronglyConsistentVfsCrdtRows(rows);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const items: VfsCrdtSyncItem[] = [];
  for (let index = 0; index < pageRows.length; index++) {
    const row = pageRows[index];
    if (!row) {
      continue;
    }

    const occurredAt = toIsoString(row.occurred_at);
    if (!occurredAt) {
      throw new VfsCrdtFeedOrderViolationError(
        'invalidOccurredAt',
        index,
        `CRDT row ${index} has invalid occurred_at`
      );
    }

    const opType = normalizeOpType(row.op_type);
    const parentId = normalizeNonEmptyString(row.parent_id);
    const childId = normalizeNonEmptyString(row.child_id);
    const encryptedPayload = normalizeNonEmptyString(row.encrypted_payload);
    const hasEncryptedPayload = encryptedPayload !== null;
    const keyEpoch = normalizePositiveInteger(row.key_epoch);
    const encryptionNonce = normalizeNonEmptyString(row.encryption_nonce);
    const encryptionAad = normalizeNonEmptyString(row.encryption_aad);
    const encryptionSignature = normalizeNonEmptyString(
      row.encryption_signature
    );

    if (hasEncryptedPayload && keyEpoch === null) {
      throw new VfsCrdtFeedOrderViolationError(
        'invalidEncryptedEnvelope',
        index,
        `CRDT row ${index} has invalid encrypted envelope metadata`
      );
    }

    if (opType === 'link_add' || opType === 'link_remove') {
      const hasPlaintextLinkFields = parentId !== null || childId !== null;
      const shouldRequirePlaintextLinkFields = !hasEncryptedPayload;
      if (
        (shouldRequirePlaintextLinkFields && (!parentId || !childId)) ||
        (hasPlaintextLinkFields &&
          (!parentId ||
            !childId ||
            childId !== row.item_id ||
            parentId === childId))
      ) {
        throw new VfsCrdtFeedOrderViolationError(
          'invalidLinkPayload',
          index,
          `CRDT row ${index} has invalid link payload`
        );
      }
    }

    items.push({
      opId: row.op_id,
      itemId: row.item_id,
      opType,
      principalType: normalizePrincipalType(row.principal_type),
      principalId: row.principal_id,
      accessLevel: normalizeAccessLevel(row.access_level),
      parentId,
      childId,
      actorId: row.actor_id,
      sourceTable: row.source_table,
      sourceId: row.source_id,
      occurredAt,
      ...(hasEncryptedPayload && keyEpoch !== null
        ? {
            encryptedPayload,
            keyEpoch
          }
        : {}),
      ...(encryptionNonce !== null ? { encryptionNonce } : {}),
      ...(encryptionAad !== null ? { encryptionAad } : {}),
      ...(encryptionSignature !== null ? { encryptionSignature } : {})
    });
  }

  const lastItem = items.at(-1);
  const nextCursor =
    hasMore && lastItem
      ? encodeVfsSyncCursor({
          changedAt: lastItem.occurredAt,
          changeId: lastItem.opId
        })
      : null;

  return {
    items,
    nextCursor,
    hasMore,
    lastReconciledWriteIds
  };
}

export type { VfsCrdtSyncItem, VfsCrdtSyncResponse };
