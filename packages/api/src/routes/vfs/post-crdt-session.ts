import type { VfsCrdtSyncSessionResponse } from '@tearleads/shared';
import {
  buildVfsCrdtSyncQuery,
  decodeVfsCrdtSyncSessionRequestProtobuf,
  decodeVfsSyncCursor,
  encodeVfsCrdtSyncSessionResponseProtobuf,
  encodeVfsSyncCursor,
  mapVfsCrdtSyncRows,
  parseVfsCrdtLastReconciledWriteIds,
  type VfsCrdtSyncDbRow,
  type VfsSyncCursor
} from '@tearleads/vfs-sync/vfs';
import type { Request, Response, Router as RouterType } from 'express';
import type { PoolClient } from 'pg';
import { getPostgresPool } from '../../lib/postgres.js';
import { publishVfsContainerCursorBump } from '../../lib/vfsSyncChannels.js';
import { applyCrdtPushOperations } from './crdtPushApply.js';
import {
  createCrdtProtobufRawBodyParser,
  decodeCrdtRequestBody,
  sendCrdtProtobufOrJson
} from './crdtProtobuf.js';
import { CRDT_CLIENT_PUSH_SOURCE_TABLE } from './post-crdt-push-canonical.js';
import {
  parsePushPayload,
  type ParsedPushOperation
} from './post-crdt-push-parse.js';

interface VfsCrdtReplicaWriteIdRow {
  replica_id: string | null;
  max_write_id: string | number | null;
}

interface ReconcileRow {
  last_reconciled_at: Date | string;
  last_reconciled_change_id: string;
  last_reconciled_write_ids: unknown;
}

function normalizeReplicaId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseWriteId(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
      return null;
    }

    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

function toLastReconciledWriteIds(
  rows: VfsCrdtReplicaWriteIdRow[]
): Record<string, number> {
  const entries: Array<[string, number]> = [];
  for (const row of rows) {
    const replicaId = normalizeReplicaId(row.replica_id);
    const writeId = parseWriteId(row.max_write_id);
    if (!replicaId || writeId === null) {
      continue;
    }

    entries.push([replicaId, writeId]);
  }

  entries.sort((left, right) => left[0].localeCompare(right[0]));
  return Object.fromEntries(entries);
}

function toScopedCrdtClientId(clientId: string): string {
  return `crdt:${clientId}`;
}

function toIsoString(value: Date | string): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(parsedMs).toISOString();
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

function parseSessionPayload(body: unknown): {
  ok: true;
  value: {
    clientId: string;
    parsedOperations: ParsedPushOperation[];
    cursor: VfsSyncCursor;
    limit: number;
    rootId: string | null;
    lastReconciledWriteIds: Record<string, number>;
  };
} | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return {
      ok: false,
      error: 'clientId, cursor, and limit are required'
    };
  }

  const record = body as Record<string, unknown>;
  const operations = Array.isArray(record['operations'])
    ? record['operations']
    : [];
  const parsedPushPayload = parsePushPayload({
    clientId: record['clientId'],
    operations
  });
  if (!parsedPushPayload.ok) {
    return parsedPushPayload;
  }

  if (typeof record['cursor'] !== 'string') {
    return {
      ok: false,
      error: 'cursor is required'
    };
  }

  const decodedCursor = decodeVfsSyncCursor(record['cursor']);
  if (!decodedCursor) {
    return {
      ok: false,
      error: 'Invalid cursor'
    };
  }

  const limit = parseLimit(record['limit']);
  if (limit === null) {
    return {
      ok: false,
      error: 'limit must be an integer between 1 and 500'
    };
  }

  const parsedLastWriteIds = parseVfsCrdtLastReconciledWriteIds(
    record['lastReconciledWriteIds'] ?? {}
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
      rootId: parseOptionalRootId(record['rootId']),
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

const postCrdtSessionHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const decodedRequestBody = decodeCrdtRequestBody(
    req,
    decodeVfsCrdtSyncSessionRequestProtobuf
  );
  if (!decodedRequestBody.ok) {
    res.status(400).json({ error: decodedRequestBody.error });
    return;
  }

  const parsedPayload = parseSessionPayload(decodedRequestBody.value);
  if (!parsedPayload.ok) {
    res.status(400).json({ error: parsedPayload.error });
    return;
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
      rootId: parsedPayload.value.rootId
    });
    const pullRows = await client.query<VfsCrdtSyncDbRow>(
      syncQuery.text,
      syncQuery.values
    );

    const replicaWriteIdsResult = await client.query<VfsCrdtReplicaWriteIdRow>(
      `
      SELECT
        split_part(source_id, ':', 2) AS replica_id,
        MAX(
          CASE
            WHEN split_part(source_id, ':', 3) ~ '^[0-9]+$'
              THEN split_part(source_id, ':', 3)::bigint
            ELSE NULL
          END
        ) AS max_write_id
      FROM vfs_crdt_ops
      WHERE source_table = $1
        AND actor_id = $2
      GROUP BY split_part(source_id, ':', 2)
      `,
      [CRDT_CLIENT_PUSH_SOURCE_TABLE, claims.sub]
    );

    const pullResponse = mapVfsCrdtSyncRows(
      pullRows.rows,
      parsedPayload.value.limit,
      toLastReconciledWriteIds(replicaWriteIdsResult.rows)
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
        JSON.stringify({
          ...parsedPayload.value.lastReconciledWriteIds,
          ...pullResponse.lastReconciledWriteIds
        })
      ]
    );

    const row = result.rows[0];
    const reconciledAt = row ? toIsoString(row.last_reconciled_at) : null;
    const changeId = row?.last_reconciled_change_id ?? null;
    const parsedLastWriteIds = parseVfsCrdtLastReconciledWriteIds(
      row?.last_reconciled_write_ids
    );
    if (!reconciledAt || !changeId || !parsedLastWriteIds.ok) {
      throw new Error('Failed to reconcile CRDT cursor');
    }

    await client.query('COMMIT');
    inTransaction = false;

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
    sendCrdtProtobufOrJson(
      req,
      res,
      200,
      response,
      encodeVfsCrdtSyncSessionResponseProtobuf
    );
  } catch (error) {
    if (inTransaction) {
      await rollbackQuietly(client);
    }
    console.error('Failed to run VFS CRDT session:', error);
    res.status(500).json({ error: 'Failed to run CRDT sync session' });
  } finally {
    client.release();
  }
};

export function registerPostCrdtSessionRoute(routeRouter: RouterType): void {
  routeRouter.post(
    '/crdt/session',
    createCrdtProtobufRawBodyParser(),
    postCrdtSessionHandler
  );
}
