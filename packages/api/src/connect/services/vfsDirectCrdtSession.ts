import { Code, ConnectError } from '@connectrpc/connect';
import {
  buildVfsV2ConnectMethodPath,
  type VfsCrdtSyncSessionResponse,
  type VfsSyncBloomFilter
} from '@tearleads/shared';
import {
  buildVfsCrdtSyncQuery,
  decodeVfsSyncCursor,
  encodeVfsSyncCursor,
  mapVfsCrdtSyncRows,
  parseVfsCrdtLastReconciledWriteIds,
  type VfsBloomFilter,
  type VfsCrdtSyncDbRow,
  type VfsSyncCursor
} from '@tearleads/vfs-sync/vfs';
import type { PoolClient } from 'pg';
import { getPostgresPool } from '../../lib/postgres.js';
import {
  invalidateReplicaWriteIdRowsForUser,
  loadReplicaWriteIdRows
} from '../../lib/vfsCrdtReplicaWriteIds.js';
import { publishVfsContainerCursorBump } from '../../lib/vfsSyncChannels.js';
import { requireVfsClaims } from './vfsDirectAuth.js';
import { parseIdentifier } from './vfsDirectCrdtCompactDecoding.js';
import { applyCrdtPushOperations } from './vfsDirectCrdtPushApply.js';
import {
  type ParsedPushOperation,
  parsePushPayload
} from './vfsDirectCrdtPushParse.js';
import {
  toIsoString,
  toLastReconciledWriteIds,
  toProtoVfsCrdtSyncResponse,
  type VfsCrdtSyncProtoResponse
} from './vfsDirectCrdtRouteHelpers.js';
import {
  createRuntimeBloomFilter,
  mergeLastReconciledWriteIds,
  parseBloomFilter,
  parseLimit,
  parseOptionalRootId,
  shouldPruneSessionRow
} from './vfsDirectCrdtSessionHelpers.js';
import { isRecord } from './vfsDirectJson.js';

interface RunCrdtSessionRequest {
  organizationId?: string;
  clientId?: string;
  operations: unknown[];
  cursor: string;
  limit: number;
  rootId?: string | null;
  lastReconciledWriteIds?: Record<string, number>;
  bloomFilter?: {
    data: string;
    capacity: number;
    errorRate: number;
  } | null;
}

interface ReconcileRow {
  last_reconciled_at: Date | string;
  last_reconciled_change_id: string;
  last_reconciled_write_ids: unknown;
}

interface ParsedSessionPayload {
  clientId: string;
  parsedOperations: ParsedPushOperation[];
  cursor: VfsSyncCursor;
  limit: number;
  rootId: string | null;
  lastReconciledWriteIds: Record<string, number>;
  bloomFilter: VfsSyncBloomFilter | null;
  runtimeBloomFilter: VfsBloomFilter | null;
  version: number;
}

export interface RunCrdtSessionDirectResponse {
  push: VfsCrdtSyncSessionResponse['push'];
  pull: VfsCrdtSyncProtoResponse;
  reconcile: VfsCrdtSyncSessionResponse['reconcile'];
}

function toScopedCrdtClientId(clientId: string): string {
  return `crdt:${clientId}`;
}

function parseSessionPayload(
  body: unknown
): { ok: true; value: ParsedSessionPayload } | { ok: false; error: string } {
  if (!isRecord(body)) {
    return {
      ok: false,
      error: 'clientId, cursor, and limit are required'
    };
  }

  const operations = Array.isArray(body['operations'])
    ? body['operations']
    : [];
  const parsedPushPayload = parsePushPayload({
    clientId: body['clientId'],
    operations
  });
  if (!parsedPushPayload.ok) {
    return parsedPushPayload;
  }

  const cursorValue = body['cursor'];
  if (typeof cursorValue !== 'string') {
    return {
      ok: false,
      error: 'cursor is required'
    };
  }

  const decodedCursor = decodeVfsSyncCursor(cursorValue);
  if (!decodedCursor) {
    return {
      ok: false,
      error: 'Invalid cursor'
    };
  }

  const limit = parseLimit(body['limit']);
  if (limit === null) {
    return {
      ok: false,
      error: 'limit must be an integer between 1 and 500'
    };
  }

  const parsedLastWriteIds = parseVfsCrdtLastReconciledWriteIds(
    body['lastReconciledWriteIds'] ?? {}
  );
  if (!parsedLastWriteIds.ok) {
    return {
      ok: false,
      error: parsedLastWriteIds.error
    };
  }
  const parsedBloomFilter = parseBloomFilter(body['bloomFilter']);
  if (!parsedBloomFilter.ok) {
    return parsedBloomFilter;
  }
  const runtimeBloomFilter = createRuntimeBloomFilter(parsedBloomFilter.value);
  if (parsedBloomFilter.value && !runtimeBloomFilter) {
    return {
      ok: false,
      error:
        'bloomFilter payload is invalid for the declared capacity/errorRate'
    };
  }

  return {
    ok: true,
    value: {
      clientId: parsedPushPayload.value.clientId,
      parsedOperations: parsedPushPayload.value.operations,
      cursor: decodedCursor,
      limit,
      rootId: parseOptionalRootId(body['rootId']),
      lastReconciledWriteIds: parsedLastWriteIds.value,
      bloomFilter: parsedBloomFilter.value,
      runtimeBloomFilter,
      version: 1
    }
  };
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // no-op
  }
}

export async function runCrdtSessionDirect(
  request: RunCrdtSessionRequest,
  context: { requestHeader: Headers }
): Promise<RunCrdtSessionDirectResponse> {
  const parsedPayload = parseSessionPayload(request);
  if (!parsedPayload.ok) {
    throw new ConnectError(parsedPayload.error, Code.InvalidArgument);
  }
  const declaredOrganizationId = parseIdentifier(request.organizationId);

  const claims = await requireVfsClaims(
    buildVfsV2ConnectMethodPath('RunCrdtSession'),
    context.requestHeader,
    {
      declaredOrganizationId
    }
  );

  const pool = await getPostgresPool();
  const client = await pool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    const pushResult = await applyCrdtPushOperations({
      client,
      userId: claims.sub,
      organizationId: claims.organizationId,
      parsedOperations: parsedPayload.value.parsedOperations
    });

    const syncQuery = buildVfsCrdtSyncQuery({
      userId: claims.sub,
      limit: parsedPayload.value.limit,
      cursor: parsedPayload.value.cursor,
      rootId: parsedPayload.value.rootId
    });

    const pullRows = await client.query<VfsCrdtSyncDbRow>(
      syncQuery.text,
      syncQuery.values
    );
    const replicaWriteIdsRows = await loadReplicaWriteIdRows(
      client,
      claims.sub
    );
    const serverLastReconciledWriteIds =
      toLastReconciledWriteIds(replicaWriteIdsRows);

    const rawPullResponse = mapVfsCrdtSyncRows(
      pullRows.rows,
      parsedPayload.value.limit,
      serverLastReconciledWriteIds
    );
    const pageRows = pullRows.rows.slice(0, parsedPayload.value.limit);
    const pruneOpIds = new Set(
      pageRows
        .filter((row) =>
          shouldPruneSessionRow(row, {
            runtimeBloomFilter: parsedPayload.value.runtimeBloomFilter,
            lastReconciledWriteIds: parsedPayload.value.lastReconciledWriteIds
          })
        )
        .map((row) => row.op_id)
    );
    const prunedItems = rawPullResponse.items.filter(
      (item) => !pruneOpIds.has(item.opId)
    );
    const pullResponse = {
      ...rawPullResponse,
      items: prunedItems,
      bloomFilter: parsedPayload.value.bloomFilter
    };

    const nextCursor = pullResponse.nextCursor
      ? decodeVfsSyncCursor(pullResponse.nextCursor)
      : null;
    const reconcileCursor = nextCursor ?? parsedPayload.value.cursor;

    const result = await client.query<ReconcileRow>(
      `
      INSERT INTO vfs_sync_client_state (
        user_id,
        client_id,
        last_reconciled_at,
        last_reconciled_change_id,
        last_reconciled_write_ids,
        updated_at
      ) VALUES ($1::uuid, $2, $3::timestamptz, $4::uuid, $5::jsonb, NOW())
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
        last_reconciled_write_ids = (
          SELECT COALESCE(
            jsonb_object_agg(entry.key, to_jsonb(entry.max_write_id)),
            '{}'::jsonb
          )
          FROM (
            SELECT
              kv.key,
              MAX(kv.write_id) AS max_write_id
            FROM (
              SELECT
                e.key,
                CASE
                  WHEN e.value ~ '^[0-9]+$' THEN e.value::bigint
                  ELSE 0::bigint
                END AS write_id
              FROM jsonb_each_text(
                COALESCE(vfs_sync_client_state.last_reconciled_write_ids, '{}'::jsonb)
              ) AS e
              UNION ALL
              SELECT
                e.key,
                CASE
                  WHEN e.value ~ '^[0-9]+$' THEN e.value::bigint
                  ELSE 0::bigint
                END AS write_id
              FROM jsonb_each_text(
                COALESCE(EXCLUDED.last_reconciled_write_ids, '{}'::jsonb)
              ) AS e
            ) AS kv
            GROUP BY kv.key
          ) AS entry
        ),
        updated_at = NOW()
      RETURNING last_reconciled_at, last_reconciled_change_id, last_reconciled_write_ids
      `,
      [
        claims.sub,
        toScopedCrdtClientId(parsedPayload.value.clientId),
        reconcileCursor.changedAt,
        reconcileCursor.changeId,
        JSON.stringify(
          mergeLastReconciledWriteIds(
            parsedPayload.value.lastReconciledWriteIds,
            pullResponse.lastReconciledWriteIds
          )
        )
      ]
    );

    const row = result.rows[0];
    const reconciledAt = row ? toIsoString(row.last_reconciled_at) : null;
    const changeId = row?.last_reconciled_change_id ?? null;
    const parsedLastWriteIds = parseVfsCrdtLastReconciledWriteIds(
      row?.last_reconciled_write_ids
    );
    if (!reconciledAt || !changeId || !parsedLastWriteIds.ok) {
      throw new ConnectError('Failed to reconcile CRDT cursor', Code.Internal);
    }

    await client.query('COMMIT');
    inTransaction = false;

    await invalidateReplicaWriteIdRowsForUser(claims.sub);

    for (const notification of pushResult.notifications) {
      try {
        await publishVfsContainerCursorBump({
          containerId: notification.containerId,
          changedAt: notification.changedAt,
          changeId: notification.changeId,
          actorId: claims.sub,
          sourceClientId: parsedPayload.value.clientId
        });
      } catch (publishError) {
        console.error('Failed to publish VFS container cursor bump:', {
          containerId: notification.containerId,
          error: publishError
        });
      }
    }

    const response: RunCrdtSessionDirectResponse = {
      push: {
        clientId: parsedPayload.value.clientId,
        results: pushResult.results
      },
      pull: toProtoVfsCrdtSyncResponse(pullResponse),
      reconcile: {
        clientId: parsedPayload.value.clientId,
        cursor: encodeVfsSyncCursor({
          changedAt: reconciledAt,
          changeId
        }),
        lastReconciledWriteIds: parsedLastWriteIds.value
      }
    };

    return response;
  } catch (error) {
    if (inTransaction) {
      await rollbackQuietly(client);
    }

    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to run VFS CRDT session:', error);
    throw new ConnectError('Failed to run CRDT sync session', Code.Internal);
  } finally {
    client.release();
  }
}
