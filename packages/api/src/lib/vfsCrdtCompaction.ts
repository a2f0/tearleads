import {
  buildVfsCrdtCompactionDeleteQuery,
  type VfsCrdtCompactionExecuteOptions
} from './vfsCrdtCompactionSql.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

export const DEFAULT_VFS_CRDT_HOT_RETENTION_MS = 30 * MS_PER_DAY;
export const DEFAULT_VFS_CRDT_INACTIVE_CLIENT_WINDOW_MS = 90 * MS_PER_DAY;
export const DEFAULT_VFS_CRDT_CURSOR_SAFETY_BUFFER_MS = 6 * MS_PER_HOUR;
export const DEFAULT_VFS_CRDT_CLIENT_PREFIX = 'crdt:';
export const DEFAULT_VFS_CRDT_STALE_CLIENT_ID_SAMPLE_LIMIT = 50;

interface CursorRow {
  occurred_at: Date | string;
  id: string;
}

interface ClientStateRow {
  client_id: string;
  last_reconciled_at: Date | string;
  last_reconciled_change_id: string;
  updated_at: Date | string;
}

interface CountRow {
  count: string | number;
}

interface QueryResultRow<T> {
  rows: T[];
}

interface PgQueryable {
  query<T>(text: string, values?: unknown[]): Promise<QueryResultRow<T>>;
}

export interface VfsCrdtCompactionOptions {
  now?: Date;
  hotRetentionMs?: number;
  inactiveClientWindowMs?: number;
  cursorSafetyBufferMs?: number;
  clientIdPrefix?: string;
  staleClientIdSampleLimit?: number;
}

export interface VfsCrdtCompactionCursor {
  changedAt: string;
  changeId: string;
}

export interface VfsCrdtCompactionClientState {
  clientId: string;
  lastReconciledAt: string;
  lastReconciledChangeId: string;
  updatedAt: string;
}

export interface VfsCrdtCompactionPlan {
  now: string;
  latestCursor: VfsCrdtCompactionCursor | null;
  hotRetentionFloor: string | null;
  activeClientCount: number;
  staleClientCount: number;
  oldestActiveCursor: VfsCrdtCompactionCursor | null;
  cutoffOccurredAt: string | null;
  estimatedRowsToDelete: number;
  staleClientIds: string[];
  staleClientIdsTruncatedCount: number;
  malformedClientStateCount: number;
  blockedReason: 'malformedClientState' | null;
  note: string;
}

interface NormalizedOptions {
  now: Date;
  hotRetentionMs: number;
  inactiveClientWindowMs: number;
  cursorSafetyBufferMs: number;
  clientIdPrefix: string;
  staleClientIdSampleLimit: number;
}

function parsePositiveMs(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.trunc(value);
}

function parseNonNegativeInteger(
  value: number | undefined,
  fallback: number
): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.trunc(value);
}

function normalizeOptions(
  options: VfsCrdtCompactionOptions
): NormalizedOptions {
  return {
    now: options.now ?? new Date(),
    hotRetentionMs: parsePositiveMs(
      options.hotRetentionMs,
      DEFAULT_VFS_CRDT_HOT_RETENTION_MS
    ),
    inactiveClientWindowMs: parsePositiveMs(
      options.inactiveClientWindowMs,
      DEFAULT_VFS_CRDT_INACTIVE_CLIENT_WINDOW_MS
    ),
    cursorSafetyBufferMs: parsePositiveMs(
      options.cursorSafetyBufferMs,
      DEFAULT_VFS_CRDT_CURSOR_SAFETY_BUFFER_MS
    ),
    clientIdPrefix: options.clientIdPrefix ?? DEFAULT_VFS_CRDT_CLIENT_PREFIX,
    staleClientIdSampleLimit: parseNonNegativeInteger(
      options.staleClientIdSampleLimit,
      DEFAULT_VFS_CRDT_STALE_CLIENT_ID_SAMPLE_LIMIT
    )
  };
}

function toIsoString(value: Date | string): string | null {
  if (value instanceof Date) {
    const asMs = value.getTime();
    if (!Number.isFinite(asMs)) {
      return null;
    }
    return value.toISOString();
  }

  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(parsedMs).toISOString();
}

function parseCount(value: number | string): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function toCursor(
  occurredAt: Date | string,
  changeId: string
): VfsCrdtCompactionCursor | null {
  const changedAt = toIsoString(occurredAt);
  const normalizedChangeId = changeId.trim();
  if (!changedAt || normalizedChangeId.length === 0) {
    return null;
  }

  return {
    changedAt,
    changeId: normalizedChangeId
  };
}

function compareCursor(
  left: VfsCrdtCompactionCursor,
  right: VfsCrdtCompactionCursor
): number {
  const leftMs = Date.parse(left.changedAt);
  const rightMs = Date.parse(right.changedAt);

  if (leftMs < rightMs) {
    return -1;
  }
  if (leftMs > rightMs) {
    return 1;
  }

  return left.changeId.localeCompare(right.changeId);
}

function sanitizeClientId(clientId: string, prefix: string): string {
  if (!clientId.startsWith(prefix)) {
    return clientId;
  }

  const trimmed = clientId.slice(prefix.length);
  return trimmed.length > 0 ? trimmed : clientId;
}

function buildCompactionPlanFromRows(
  latestCursorRow: CursorRow | null,
  clientStateRows: ClientStateRow[],
  estimatedRowsToDelete: number,
  options: NormalizedOptions
): VfsCrdtCompactionPlan {
  const nowMs = options.now.getTime();
  const cutoffForActiveClientMs = nowMs - options.inactiveClientWindowMs;

  const latestCursor = latestCursorRow
    ? toCursor(latestCursorRow.occurred_at, latestCursorRow.id)
    : null;

  if (!latestCursor) {
    return {
      now: options.now.toISOString(),
      latestCursor: null,
      hotRetentionFloor: null,
      activeClientCount: 0,
      staleClientCount: 0,
      oldestActiveCursor: null,
      cutoffOccurredAt: null,
      estimatedRowsToDelete: 0,
      staleClientIds: [],
      staleClientIdsTruncatedCount: 0,
      malformedClientStateCount: 0,
      blockedReason: null,
      note: 'No CRDT operations found; compaction is not needed.'
    };
  }

  const latestCursorMs = Date.parse(latestCursor.changedAt);
  const boundedLatestCursorMs = Math.min(latestCursorMs, nowMs);
  const hotRetentionFloorMs = boundedLatestCursorMs - options.hotRetentionMs;
  const hotRetentionFloor = new Date(hotRetentionFloorMs).toISOString();

  const activeCursors: VfsCrdtCompactionCursor[] = [];
  const staleClientIds: string[] = [];
  let staleClientIdsTruncatedCount = 0;
  let malformedClientStateCount = 0;

  for (const row of clientStateRows) {
    const updatedAt = toIsoString(row.updated_at);
    const reconciledCursor = toCursor(
      row.last_reconciled_at,
      row.last_reconciled_change_id
    );

    if (!updatedAt || !reconciledCursor) {
      malformedClientStateCount += 1;
      continue;
    }

    const updatedAtMs = Date.parse(updatedAt);
    if (!Number.isFinite(updatedAtMs)) {
      malformedClientStateCount += 1;
      continue;
    }

    if (updatedAtMs < cutoffForActiveClientMs) {
      if (staleClientIds.length < options.staleClientIdSampleLimit) {
        staleClientIds.push(
          sanitizeClientId(row.client_id, options.clientIdPrefix)
        );
      } else {
        staleClientIdsTruncatedCount += 1;
      }
      continue;
    }

    activeCursors.push(reconciledCursor);
  }

  if (malformedClientStateCount > 0) {
    return {
      now: options.now.toISOString(),
      latestCursor,
      hotRetentionFloor,
      activeClientCount: activeCursors.length,
      staleClientCount: staleClientIds.length + staleClientIdsTruncatedCount,
      oldestActiveCursor: null,
      cutoffOccurredAt: null,
      estimatedRowsToDelete: 0,
      staleClientIds,
      staleClientIdsTruncatedCount,
      malformedClientStateCount,
      blockedReason: 'malformedClientState',
      note: 'Compaction was blocked because malformed CRDT client-state rows were found; fix reconcile state before retrying.'
    };
  }

  let oldestActiveCursor: VfsCrdtCompactionCursor | null = null;
  for (const cursor of activeCursors) {
    if (!oldestActiveCursor || compareCursor(cursor, oldestActiveCursor) < 0) {
      oldestActiveCursor = cursor;
    }
  }

  let cutoffMs = hotRetentionFloorMs;
  if (oldestActiveCursor) {
    const oldestActiveCursorMs = Date.parse(oldestActiveCursor.changedAt);
    const activeBoundMs =
      Math.min(oldestActiveCursorMs, nowMs) - options.cursorSafetyBufferMs;
    cutoffMs = Math.min(cutoffMs, activeBoundMs);
  }

  if (cutoffMs >= latestCursorMs) {
    return {
      now: options.now.toISOString(),
      latestCursor,
      hotRetentionFloor,
      activeClientCount: activeCursors.length,
      staleClientCount: staleClientIds.length + staleClientIdsTruncatedCount,
      oldestActiveCursor,
      cutoffOccurredAt: null,
      estimatedRowsToDelete: 0,
      staleClientIds,
      staleClientIdsTruncatedCount,
      malformedClientStateCount,
      blockedReason: null,
      note: 'No safe cutoff was found below the latest cursor; skip compaction for this run.'
    };
  }

  const cutoffOccurredAt = new Date(Math.max(0, cutoffMs)).toISOString();

  return {
    now: options.now.toISOString(),
    latestCursor,
    hotRetentionFloor,
    activeClientCount: activeCursors.length,
    staleClientCount: staleClientIds.length + staleClientIdsTruncatedCount,
    oldestActiveCursor,
    cutoffOccurredAt,
    estimatedRowsToDelete,
    staleClientIds,
    staleClientIdsTruncatedCount,
    malformedClientStateCount,
    blockedReason: null,
    note:
      staleClientIds.length + staleClientIdsTruncatedCount > 0
        ? 'Stale clients were excluded from the frontier and will require re-materialization on return.'
        : 'Compaction frontier is bounded by active client cursors and hot retention.'
  };
}

async function loadLatestCursor(
  client: PgQueryable
): Promise<CursorRow | null> {
  const result = await client.query<CursorRow>(
    `
    SELECT occurred_at, id
    FROM vfs_crdt_ops
    ORDER BY occurred_at DESC, id DESC
    LIMIT 1
    `
  );

  return result.rows[0] ?? null;
}

async function loadClientStateRows(
  client: PgQueryable,
  clientIdPrefix: string
): Promise<ClientStateRow[]> {
  const result = await client.query<ClientStateRow>(
    `
    SELECT
      client_id,
      last_reconciled_at,
      last_reconciled_change_id,
      updated_at
    FROM vfs_sync_client_state
    WHERE client_id LIKE $1
    `,
    [`${clientIdPrefix}%`]
  );

  return result.rows;
}

async function countDeleteCandidates(
  client: PgQueryable,
  cutoffOccurredAt: string
): Promise<number> {
  const result = await client.query<CountRow>(
    `
    SELECT COUNT(*)::bigint AS count
    FROM vfs_crdt_ops
    WHERE occurred_at < $1::timestamptz
    `,
    [cutoffOccurredAt]
  );

  const row = result.rows[0];
  if (!row) {
    return 0;
  }

  return parseCount(row.count);
}

export function planVfsCrdtCompactionFromState(input: {
  latestCursor: VfsCrdtCompactionCursor | null;
  clientState: VfsCrdtCompactionClientState[];
  estimatedRowsToDelete?: number;
  options?: VfsCrdtCompactionOptions;
}): VfsCrdtCompactionPlan {
  const options = normalizeOptions(input.options ?? {});

  const latestRow = input.latestCursor
    ? {
        occurred_at: input.latestCursor.changedAt,
        id: input.latestCursor.changeId
      }
    : null;

  const clientRows: ClientStateRow[] = [];
  for (const entry of input.clientState) {
    clientRows.push({
      client_id: entry.clientId,
      last_reconciled_at: entry.lastReconciledAt,
      last_reconciled_change_id: entry.lastReconciledChangeId,
      updated_at: entry.updatedAt
    });
  }

  return buildCompactionPlanFromRows(
    latestRow,
    clientRows,
    input.estimatedRowsToDelete ?? 0,
    options
  );
}

export async function planVfsCrdtCompaction(
  client: PgQueryable,
  options: VfsCrdtCompactionOptions = {}
): Promise<VfsCrdtCompactionPlan> {
  const normalizedOptions = normalizeOptions(options);
  const latestCursor = await loadLatestCursor(client);
  const clientStateRows = await loadClientStateRows(
    client,
    normalizedOptions.clientIdPrefix
  );

  const prePlan = buildCompactionPlanFromRows(
    latestCursor,
    clientStateRows,
    0,
    normalizedOptions
  );

  if (!prePlan.cutoffOccurredAt) {
    return prePlan;
  }

  const estimatedRowsToDelete = await countDeleteCandidates(
    client,
    prePlan.cutoffOccurredAt
  );

  return {
    ...prePlan,
    estimatedRowsToDelete
  };
}

export async function executeVfsCrdtCompaction(
  client: PgQueryable,
  plan: VfsCrdtCompactionPlan,
  options: VfsCrdtCompactionExecuteOptions = {}
): Promise<number> {
  if (!plan.cutoffOccurredAt) {
    return 0;
  }

  const query = buildVfsCrdtCompactionDeleteQuery(
    plan.cutoffOccurredAt,
    options
  );
  const result = await client.query<CountRow>(query.text, query.values);

  const row = result.rows[0];
  if (!row) {
    return 0;
  }

  return parseCount(row.count);
}
