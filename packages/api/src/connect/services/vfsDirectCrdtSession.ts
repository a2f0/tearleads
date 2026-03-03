import { Code, ConnectError } from '@connectrpc/connect';
import type { VfsCrdtSyncSessionResponse } from '@tearleads/shared';
import {
  buildVfsCrdtSyncQuery,
  decodeVfsSyncCursor,
  encodeVfsSyncCursor,
  mapVfsCrdtSyncRows,
  parseVfsCrdtLastReconciledWriteIds,
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
import { shouldReadEnvelopeBytea } from '../../routes/vfs/crdtEnvelopeReadOptions.js';
import { applyCrdtPushOperations } from '../../routes/vfs/crdtPushApply.js';
import {
  toIsoString,
  toLastReconciledWriteIds
} from '../../routes/vfs/crdtRouteHelpers.js';
import {
  type ParsedPushOperation,
  parsePushPayload
} from '../../routes/vfs/post-crdt-push-parse.js';
import { requireVfsClaims } from './vfsDirectAuth.js';
import { isRecord, parseJsonBody } from './vfsDirectJson.js';

interface JsonRequest {
  json: string;
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
}

function parseLimit(value: unknown): number | null {
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 1 && value <= 500) {
      return value;
    }
    return null;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 500) {
      return parsed;
    }
  }

  return null;
}

function parseOptionalRootId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mergeLastReconciledWriteIds(
  ...sources: Record<string, number>[]
): Record<string, number> {
  const merged = new Map<string, number>();

  for (const source of sources) {
    for (const [replicaId, writeId] of Object.entries(source)) {
      const existing = merged.get(replicaId) ?? 0;
      if (writeId > existing) {
        merged.set(replicaId, writeId);
      }
    }
  }

  const sortedEntries = Array.from(merged.entries()).sort((left, right) =>
    left[0].localeCompare(right[0])
  );
  return Object.fromEntries(sortedEntries);
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

  return {
    ok: true,
    value: {
      clientId: parsedPushPayload.value.clientId,
      parsedOperations: parsedPushPayload.value.operations,
      cursor: decodedCursor,
      limit,
      rootId: parseOptionalRootId(body['rootId']),
      lastReconciledWriteIds: parsedLastWriteIds.value
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
  request: JsonRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const claims = await requireVfsClaims(
    '/vfs/crdt/session',
    context.requestHeader
  );

  const parsedPayload = parseSessionPayload(parseJsonBody(request.json));
  if (!parsedPayload.ok) {
    throw new ConnectError(parsedPayload.error, Code.InvalidArgument);
  }

  const pool = await getPostgresPool();
  const client = await pool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    const pushResult = await applyCrdtPushOperations({
      client,
      userId: claims.sub,
      parsedOperations: parsedPayload.value.parsedOperations
    });

    const syncQuery = buildVfsCrdtSyncQuery({
      userId: claims.sub,
      limit: parsedPayload.value.limit,
      cursor: parsedPayload.value.cursor,
      rootId: parsedPayload.value.rootId,
      includeEnvelopeByteaReads: shouldReadEnvelopeBytea()
    });

    const pullRows = await client.query<VfsCrdtSyncDbRow>(
      syncQuery.text,
      syncQuery.values
    );
    const replicaWriteIdsRows = await loadReplicaWriteIdRows(
      client,
      claims.sub
    );

    const pullResponse = mapVfsCrdtSyncRows(
      pullRows.rows,
      parsedPayload.value.limit,
      toLastReconciledWriteIds(replicaWriteIdsRows)
    );

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
      ) VALUES ($1, $2, $3::timestamptz, $4, $5::jsonb, NOW())
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
        last_reconciled_write_ids = "vfs_merge_reconciled_write_ids"(
          vfs_sync_client_state.last_reconciled_write_ids,
          EXCLUDED.last_reconciled_write_ids
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

    const response: VfsCrdtSyncSessionResponse = {
      push: {
        clientId: parsedPayload.value.clientId,
        results: pushResult.results
      },
      pull: pullResponse,
      reconcile: {
        clientId: parsedPayload.value.clientId,
        cursor: encodeVfsSyncCursor({
          changedAt: reconciledAt,
          changeId
        }),
        lastReconciledWriteIds: parsedLastWriteIds.value
      }
    };

    return {
      json: JSON.stringify(response)
    };
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
