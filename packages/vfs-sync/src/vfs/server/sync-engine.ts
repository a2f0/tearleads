import type {
  VfsAclAccessLevel,
  VfsObjectType,
  VfsSyncChangeType,
  VfsSyncItem,
  VfsSyncResponse
} from '@tearleads/shared';
import {
  decodeVfsSyncCursor,
  encodeVfsSyncCursor,
  type VfsSyncCursor
} from '../protocol/sync-cursor.js';
import { VFS_SYNC_SQL } from './syncEngineSql.js';

const DEFAULT_SYNC_LIMIT = 100;
const MAX_SYNC_LIMIT = 500;

const VALID_OBJECT_TYPES: VfsObjectType[] = [
  'file',
  'photo',
  'audio',
  'video',
  'contact',
  'note',
  'email',
  'mlsMessage',
  'conversation',
  'folder',
  'playlist',
  'album',
  'contactGroup',
  'tag'
];
/**
 * Guardrail: `email` stays a first-class VFS object type in the generic sync
 * feed. We do not branch into an email-specific sync protocol domain; email
 * metadata/attachments are modeled through the same object + link mechanics.
 */

const VALID_ACCESS_LEVELS: VfsAclAccessLevel[] = ['read', 'write', 'admin'];
const VALID_CHANGE_TYPES: VfsSyncChangeType[] = ['upsert', 'delete', 'acl'];

export interface ParseVfsSyncQueryInput {
  limit?: unknown;
  cursor?: unknown;
  rootId?: unknown;
}

export interface ParsedVfsSyncQuery {
  limit: number;
  cursor: VfsSyncCursor | null;
  rootId: string | null;
}

export type ParseVfsSyncQueryResult =
  | {
      ok: true;
      value: ParsedVfsSyncQuery;
    }
  | {
      ok: false;
      error: string;
    };

export interface BuildVfsSyncQueryInput {
  userId: string;
  limit: number;
  cursor: VfsSyncCursor | null;
  rootId: string | null;
}

export interface VfsSyncDbQuery {
  text: string;
  values: Array<string | number | null>;
}

export interface VfsSyncDbRow {
  change_id: string;
  item_id: string;
  change_type: string;
  changed_at: Date | string;
  object_type: string | null;
  encrypted_name?: string | null;
  owner_id: string | null;
  created_at: Date | string | null;
  access_level: string;
}

export type VfsSyncOrderViolationCode =
  | 'invalidChangedAt'
  | 'missingChangeId'
  | 'duplicateChangeId'
  | 'outOfOrderRow';

export class VfsSyncOrderViolationError extends Error {
  readonly code: VfsSyncOrderViolationCode;
  readonly rowIndex: number;

  constructor(
    code: VfsSyncOrderViolationCode,
    rowIndex: number,
    message: string
  ) {
    super(message);
    this.name = 'VfsSyncOrderViolationError';
    this.code = code;
    this.rowIndex = rowIndex;
  }
}

function isValidObjectType(value: unknown): value is VfsObjectType {
  return (
    typeof value === 'string' &&
    VALID_OBJECT_TYPES.some((objectType) => objectType === value)
  );
}

function isValidAccessLevel(value: unknown): value is VfsAclAccessLevel {
  return (
    typeof value === 'string' &&
    VALID_ACCESS_LEVELS.some((accessLevel) => accessLevel === value)
  );
}

function normalizeAccessLevel(value: unknown): VfsAclAccessLevel {
  if (isValidAccessLevel(value)) {
    return value;
  }
  return 'read';
}

function isValidChangeType(value: unknown): value is VfsSyncChangeType {
  return (
    typeof value === 'string' &&
    VALID_CHANGE_TYPES.some((changeType) => changeType === value)
  );
}

function normalizeChangeType(value: unknown): VfsSyncChangeType {
  if (isValidChangeType(value)) {
    return value;
  }
  return 'upsert';
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

function parseChangedAtMs(value: Date | string): number | null {
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

/**
 * Guardrail: page rows must already be globally ordered by
 * (changed_at ASC, change_id ASC) and change_id must be unique.
 * Without this invariant, cursor pagination can skip or replay rows.
 */
export function assertStronglyConsistentVfsSyncRows(
  rows: VfsSyncDbRow[]
): void {
  const seenChangeIds = new Set<string>();
  let previous: { changedAtMs: number; changeId: string } | null = null;

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!row) {
      continue;
    }

    if (!isNonEmptyString(row.change_id)) {
      throw new VfsSyncOrderViolationError(
        'missingChangeId',
        index,
        `Sync row ${index} is missing change_id`
      );
    }

    if (seenChangeIds.has(row.change_id)) {
      throw new VfsSyncOrderViolationError(
        'duplicateChangeId',
        index,
        `Sync row ${index} repeats change_id ${row.change_id}`
      );
    }
    seenChangeIds.add(row.change_id);

    const changedAtMs = parseChangedAtMs(row.changed_at);
    if (changedAtMs === null) {
      throw new VfsSyncOrderViolationError(
        'invalidChangedAt',
        index,
        `Sync row ${index} has invalid changed_at`
      );
    }

    if (
      previous &&
      (changedAtMs < previous.changedAtMs ||
        (changedAtMs === previous.changedAtMs &&
          row.change_id <= previous.changeId))
    ) {
      throw new VfsSyncOrderViolationError(
        'outOfOrderRow',
        index,
        `Sync row ${index} violates required ordering`
      );
    }

    previous = {
      changedAtMs,
      changeId: row.change_id
    };
  }
}

type ParseStringResult =
  | {
      ok: true;
      value: string | null;
    }
  | {
      ok: false;
      error: string;
    };

function parseOptionalString(
  value: unknown,
  name: string,
  allowEmpty: boolean
): ParseStringResult {
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

export function parseVfsSyncQuery(
  input: ParseVfsSyncQueryInput
): ParseVfsSyncQueryResult {
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

export function buildVfsSyncQuery(
  input: BuildVfsSyncQueryInput
): VfsSyncDbQuery {
  return {
    text: VFS_SYNC_SQL,
    values: [
      input.userId,
      input.cursor?.changedAt ?? null,
      input.cursor?.changeId ?? null,
      input.limit + 1,
      input.rootId
    ]
  };
}

export function mapVfsSyncRows(
  rows: VfsSyncDbRow[],
  limit: number
): VfsSyncResponse {
  assertStronglyConsistentVfsSyncRows(rows);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const items: VfsSyncItem[] = [];
  for (let index = 0; index < pageRows.length; index++) {
    const row = pageRows[index];
    if (!row) {
      continue;
    }

    const changedAt = toIsoString(row.changed_at);
    if (!changedAt) {
      throw new VfsSyncOrderViolationError(
        'invalidChangedAt',
        index,
        `Sync row ${index} has invalid changed_at`
      );
    }

    const createdAt =
      row.created_at === null ? null : toIsoString(row.created_at);

    const item: VfsSyncItem = {
      changeId: row.change_id,
      itemId: row.item_id,
      changeType: normalizeChangeType(row.change_type),
      changedAt,
      objectType: isValidObjectType(row.object_type) ? row.object_type : null,
      ownerId: row.owner_id,
      createdAt,
      accessLevel: normalizeAccessLevel(row.access_level)
    };
    if (typeof row.encrypted_name === 'string') {
      item.encryptedName = row.encrypted_name;
    }
    items.push(item);
  }

  const lastRow = items.at(-1);
  const nextCursor =
    hasMore && lastRow
      ? encodeVfsSyncCursor({
          changedAt: lastRow.changedAt,
          changeId: lastRow.changeId
        })
      : null;

  return {
    items,
    nextCursor,
    hasMore
  };
}
