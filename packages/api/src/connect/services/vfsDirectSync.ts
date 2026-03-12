import { Code, ConnectError } from '@connectrpc/connect';
import type {
  VfsCrdtSyncResponse,
  VfsSyncReconcileResponse,
  VfsSyncResponse
} from '@tearleads/shared';
import { buildVfsV2ConnectMethodPath } from '@tearleads/shared';
import {
  buildVfsCrdtSyncQuery,
  buildVfsSyncQuery,
  encodeVfsSyncCursor,
  mapVfsCrdtSyncRows,
  mapVfsSyncRows,
  parseVfsCrdtSyncQuery,
  parseVfsSyncQuery,
  parseVfsSyncReconcilePayload,
  type VfsCrdtSyncDbRow,
  type VfsSyncCursor,
  type VfsSyncDbRow
} from '@tearleads/vfs-sync/vfs';
import { getPostgresPool } from '../../lib/postgres.js';
import {
  getVfsCrdtCompactionEpoch,
  readOldestAccessibleCursorCache,
  writeOldestAccessibleCursorCache
} from '../../lib/vfsCrdtRedisCache.js';
import { loadReplicaWriteIdRows } from '../../lib/vfsCrdtReplicaWriteIds.js';
import { loadVfsCrdtRematerializationSnapshot } from '../../lib/vfsCrdtSnapshots.js';
import { requireVfsClaims } from './vfsDirectAuth.js';
import {
  toIsoString,
  toLastReconciledWriteIds,
  toProtoVfsCrdtSnapshotResponse,
  toProtoVfsCrdtSyncResponse,
  toProtoVfsSyncResponse,
  type VfsCrdtSnapshotProtoResponse,
  type VfsCrdtSyncProtoResponse,
  type VfsSyncProtoResponse
} from './vfsDirectCrdtRouteHelpers.js';
import { materializeScaffoldEncryptedNames } from './vfsDirectScaffoldDecrypt.js';

type GetSyncRequest = {
  cursor: string;
  limit: number;
  rootId: string;
  bloomFilter?: {
    data: string;
    capacity: number;
    errorRate: number;
  } | null;
};
type GetCrdtSnapshotRequest = { clientId: string };
type ReconcileSyncRequest = { clientId: string; cursor: string };

interface ReconcileRow {
  last_reconciled_at: Date | string;
  last_reconciled_change_id: string;
}

interface CursorBoundaryRow {
  occurred_at: Date | string;
  id: string;
}

interface Queryable {
  query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

function compareCursor(left: VfsSyncCursor, right: VfsSyncCursor): number {
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

function parseOccurredAtMs(value: Date | string): number | null {
  if (value instanceof Date) {
    const asMs = value.getTime();
    return Number.isFinite(asMs) ? asMs : null;
  }

  const parsedMs = Date.parse(value);
  return Number.isFinite(parsedMs) ? parsedMs : null;
}

async function loadOldestAccessibleCursor(
  pool: Queryable,
  userId: string,
  rootId: string | null
): Promise<VfsSyncCursor | null> {
  const result = await pool.query<CursorBoundaryRow>(
    `
    WITH principals AS (
      SELECT 'user'::text AS principal_type, $1::text AS principal_id
      UNION ALL
      SELECT 'group'::text AS principal_type, ug.group_id AS principal_id
      FROM user_groups ug
      WHERE ug.user_id = $1
      UNION ALL
      SELECT 'organization'::text AS principal_type, uo.organization_id AS principal_id
      FROM user_organizations uo
      WHERE uo.user_id = $1
    ),
    owner_items AS (
      SELECT registry.id AS item_id
      FROM vfs_registry registry
      WHERE registry.owner_id = $1
    ),
    acl_items AS (
      SELECT
        entry.item_id
      FROM vfs_acl_entries entry
      INNER JOIN principals principal
        ON principal.principal_type = entry.principal_type
       AND principal.principal_id = entry.principal_id
      WHERE entry.revoked_at IS NULL
        AND (entry.expires_at IS NULL OR entry.expires_at > NOW())
      GROUP BY entry.item_id
    ),
    eligible_items AS (
      SELECT item_id FROM owner_items
      UNION
      SELECT item_id FROM acl_items
    )
    SELECT date_trunc('milliseconds', ops.occurred_at) AS occurred_at, ops.id
    FROM vfs_crdt_ops ops
    INNER JOIN eligible_items access ON access.item_id = ops.item_id
    WHERE (
        $2::text IS NULL
        OR ops.item_id = $2::text
        OR EXISTS (
          SELECT 1
          FROM vfs_links link
          WHERE link.parent_id = $2::text
            AND link.child_id = ops.item_id
        )
      )
    ORDER BY date_trunc('milliseconds', ops.occurred_at) ASC, ops.id ASC
    LIMIT 1
    `,
    [userId, rootId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const parsedOccurredAtMs = parseOccurredAtMs(row.occurred_at);
  if (parsedOccurredAtMs === null) {
    return null;
  }

  const changeId = row.id.trim();
  if (changeId.length === 0) {
    return null;
  }

  return {
    changedAt: new Date(parsedOccurredAtMs).toISOString(),
    changeId
  };
}

function normalizeSyncQueryRequest(request: GetSyncRequest): {
  cursor: string | undefined;
  limit: string | undefined;
  rootId: string | undefined;
} {
  const normalizedCursor = request.cursor.trim();
  const normalizedRootId = request.rootId.trim();
  const normalizedLimit =
    Number.isFinite(request.limit) && request.limit > 0
      ? String(Math.floor(request.limit))
      : undefined;

  return {
    cursor: normalizedCursor.length > 0 ? normalizedCursor : undefined,
    limit: normalizedLimit,
    rootId: normalizedRootId.length > 0 ? normalizedRootId : undefined
  };
}

function normalizeRequiredClientId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) {
    return null;
  }
  if (trimmed.includes(':')) {
    return null;
  }

  return trimmed;
}

export async function getSyncDirect(
  request: GetSyncRequest,
  context: { requestHeader: Headers }
): Promise<VfsSyncProtoResponse> {
  const claims = await requireVfsClaims(
    buildVfsV2ConnectMethodPath('GetSync'),
    context.requestHeader
  );

  const parsedQuery = parseVfsSyncQuery(normalizeSyncQueryRequest(request));
  if (!parsedQuery.ok) {
    throw new ConnectError(parsedQuery.error, Code.InvalidArgument);
  }

  try {
    const pool = await getPostgresPool();
    const query = buildVfsSyncQuery({
      userId: claims.sub,
      limit: parsedQuery.value.limit,
      cursor: parsedQuery.value.cursor,
      rootId: parsedQuery.value.rootId
    });
    const result = await pool.query<VfsSyncDbRow>(query.text, query.values);
    const rows = await materializeScaffoldEncryptedNames(pool, result.rows);

    const response: VfsSyncResponse = mapVfsSyncRows(
      rows,
      parsedQuery.value.limit
    );
    return toProtoVfsSyncResponse(response);
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to sync VFS changes:', error);
    throw new ConnectError('Failed to sync VFS changes', Code.Internal);
  }
}

export async function getCrdtSyncDirect(
  request: GetSyncRequest,
  context: { requestHeader: Headers }
): Promise<VfsCrdtSyncProtoResponse> {
  const claims = await requireVfsClaims(
    buildVfsV2ConnectMethodPath('GetCrdtSync'),
    context.requestHeader
  );

  const parsedQuery = parseVfsCrdtSyncQuery(normalizeSyncQueryRequest(request));
  if (!parsedQuery.ok) {
    throw new ConnectError(parsedQuery.error, Code.InvalidArgument);
  }

  try {
    const pool = await getPostgresPool();
    if (parsedQuery.value.cursor) {
      const compactionEpoch = await getVfsCrdtCompactionEpoch();
      const cachedOldestAccessibleCursor =
        await readOldestAccessibleCursorCache({
          compactionEpoch,
          userId: claims.sub,
          rootId: parsedQuery.value.rootId
        });
      const oldestAccessibleCursor =
        cachedOldestAccessibleCursor !== undefined
          ? cachedOldestAccessibleCursor
          : await loadOldestAccessibleCursor(
              pool,
              claims.sub,
              parsedQuery.value.rootId
            );

      if (cachedOldestAccessibleCursor === undefined) {
        await writeOldestAccessibleCursorCache({
          compactionEpoch,
          userId: claims.sub,
          rootId: parsedQuery.value.rootId,
          cursor: oldestAccessibleCursor
        });
      }

      if (
        oldestAccessibleCursor &&
        compareCursor(parsedQuery.value.cursor, oldestAccessibleCursor) < 0
      ) {
        throw new ConnectError(
          'CRDT cursor is older than retained history; re-materialization required',
          Code.AlreadyExists
        );
      }
    }

    const query = buildVfsCrdtSyncQuery({
      userId: claims.sub,
      limit: parsedQuery.value.limit,
      cursor: parsedQuery.value.cursor,
      rootId: parsedQuery.value.rootId
    });
    const result = await pool.query<VfsCrdtSyncDbRow>(query.text, query.values);
    const replicaWriteIdsRows = await loadReplicaWriteIdRows(pool, claims.sub);

    const response: VfsCrdtSyncResponse = {
      items: mapVfsCrdtSyncRows(
        result.rows,
        parsedQuery.value.limit,
        toLastReconciledWriteIds(replicaWriteIdsRows)
      ).items,
      hasMore: mapVfsCrdtSyncRows(
        result.rows,
        parsedQuery.value.limit,
        toLastReconciledWriteIds(replicaWriteIdsRows)
      ).hasMore,
      nextCursor: mapVfsCrdtSyncRows(
        result.rows,
        parsedQuery.value.limit,
        toLastReconciledWriteIds(replicaWriteIdsRows)
      ).nextCursor,
      lastReconciledWriteIds: toLastReconciledWriteIds(replicaWriteIdsRows),
      bloomFilter: request.bloomFilter
    };

    return toProtoVfsCrdtSyncResponse(response);
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to sync VFS CRDT operations:', error);
    throw new ConnectError('Failed to sync VFS CRDT operations', Code.Internal);
  }
}

export async function getCrdtSnapshotDirect(
  request: GetCrdtSnapshotRequest,
  context: { requestHeader: Headers }
): Promise<VfsCrdtSnapshotProtoResponse> {
  const claims = await requireVfsClaims(
    buildVfsV2ConnectMethodPath('GetCrdtSnapshot'),
    context.requestHeader
  );

  const clientId = normalizeRequiredClientId(request.clientId);
  if (!clientId) {
    throw new ConnectError(
      'clientId must be non-empty, at most 128 characters, and must not include ":"',
      Code.InvalidArgument
    );
  }

  try {
    const pool = await getPostgresPool();
    const snapshot = await loadVfsCrdtRematerializationSnapshot(pool, {
      userId: claims.sub,
      clientId
    });

    if (!snapshot) {
      throw new ConnectError('No CRDT snapshot is available', Code.NotFound);
    }

    return toProtoVfsCrdtSnapshotResponse(snapshot);
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to load VFS CRDT rematerialization snapshot:', error);
    throw new ConnectError('Failed to load CRDT snapshot', Code.Internal);
  }
}

export async function reconcileSyncDirect(
  request: ReconcileSyncRequest,
  context: { requestHeader: Headers }
): Promise<VfsSyncReconcileResponse> {
  const claims = await requireVfsClaims(
    buildVfsV2ConnectMethodPath('ReconcileSync'),
    context.requestHeader,
    { requireDeclaredOrganization: true }
  );

  const parsedPayload = parseVfsSyncReconcilePayload({
    clientId: request.clientId,
    cursor: request.cursor
  });
  if (!parsedPayload.ok) {
    throw new ConnectError(parsedPayload.error, Code.InvalidArgument);
  }

  if (parsedPayload.value.clientId.includes(':')) {
    throw new ConnectError(
      'clientId must not contain ":"',
      Code.InvalidArgument
    );
  }

  try {
    const pool = await getPostgresPool();
    const result = await pool.query<ReconcileRow>(
      `
      INSERT INTO vfs_sync_client_state (
        user_id,
        client_id,
        last_reconciled_at,
        last_reconciled_change_id,
        updated_at
      ) VALUES ($1, $2, $3::timestamptz, $4, NOW())
      ON CONFLICT (user_id, client_id) DO UPDATE
      SET
        last_reconciled_at = CASE
          WHEN EXCLUDED.last_reconciled_at > vfs_sync_client_state.last_reconciled_at THEN EXCLUDED.last_reconciled_at
          WHEN EXCLUDED.last_reconciled_at = vfs_sync_client_state.last_reconciled_at
            AND EXCLUDED.last_reconciled_change_id > vfs_sync_client_state.last_reconciled_change_id
            THEN EXCLUDED.last_reconciled_at
          ELSE vfs_sync_client_state.last_reconciled_at
        END,
        last_reconciled_change_id = CASE
          WHEN EXCLUDED.last_reconciled_at > vfs_sync_client_state.last_reconciled_at THEN EXCLUDED.last_reconciled_change_id
          WHEN EXCLUDED.last_reconciled_at = vfs_sync_client_state.last_reconciled_at
            AND EXCLUDED.last_reconciled_change_id > vfs_sync_client_state.last_reconciled_change_id
            THEN EXCLUDED.last_reconciled_change_id
          ELSE vfs_sync_client_state.last_reconciled_change_id
        END,
        updated_at = NOW()
      RETURNING last_reconciled_at, last_reconciled_change_id
      `,
      [
        claims.sub,
        parsedPayload.value.clientId,
        parsedPayload.value.cursor.changedAt,
        parsedPayload.value.cursor.changeId
      ]
    );

    const row = result.rows[0];
    const reconciledAt = row ? toIsoString(row.last_reconciled_at) : null;
    const changeId = row?.last_reconciled_change_id ?? null;

    if (!reconciledAt || !changeId) {
      throw new ConnectError('Failed to reconcile sync cursor', Code.Internal);
    }

    const response: VfsSyncReconcileResponse = {
      clientId: parsedPayload.value.clientId,
      cursor: encodeVfsSyncCursor({
        changedAt: reconciledAt,
        changeId
      })
    };

    return response;
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to reconcile VFS sync cursor:', error);
    throw new ConnectError('Failed to reconcile sync cursor', Code.Internal);
  }
}
