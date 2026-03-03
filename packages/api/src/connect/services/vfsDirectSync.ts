import { Code, ConnectError } from '@connectrpc/connect';
import type { VfsSyncReconcileResponse } from '@tearleads/shared';
import {
  buildVfsSyncQuery,
  encodeVfsSyncCursor,
  mapVfsSyncRows,
  parseVfsSyncQuery,
  parseVfsSyncReconcilePayload,
  type VfsSyncDbRow
} from '@tearleads/vfs-sync/vfs';
import { getPostgresPool } from '../../lib/postgres.js';
import { loadVfsCrdtRematerializationSnapshot } from '../../lib/vfsCrdtSnapshots.js';
import { toIsoString } from '../../routes/vfs/crdtRouteHelpers.js';
import { parseJsonBody } from './vfsDirectJson.js';
import { requireVfsClaims } from './vfsDirectAuth.js';

type GetSyncRequest = { cursor: string; limit: number; rootId: string };
type GetCrdtSnapshotRequest = { clientId: string };
type JsonRequest = { json: string };

interface ReconcileRow {
  last_reconciled_at: Date | string;
  last_reconciled_change_id: string;
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
): Promise<{ json: string }> {
  const claims = await requireVfsClaims('/vfs/vfs-sync', context.requestHeader);

  const normalizedCursor = request.cursor.trim();
  const normalizedRootId = request.rootId.trim();
  const normalizedLimit =
    Number.isFinite(request.limit) && request.limit > 0
      ? String(Math.floor(request.limit))
      : undefined;

  const parsedQuery = parseVfsSyncQuery({
    limit: normalizedLimit,
    cursor: normalizedCursor.length > 0 ? normalizedCursor : undefined,
    rootId: normalizedRootId.length > 0 ? normalizedRootId : undefined
  });
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

    return {
      json: JSON.stringify(mapVfsSyncRows(result.rows, parsedQuery.value.limit))
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to sync VFS changes:', error);
    throw new ConnectError('Failed to sync VFS changes', Code.Internal);
  }
}

export async function getCrdtSnapshotDirect(
  request: GetCrdtSnapshotRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const claims = await requireVfsClaims('/vfs/crdt/snapshot', context.requestHeader);

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

    return {
      json: JSON.stringify(snapshot)
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to load VFS CRDT rematerialization snapshot:', error);
    throw new ConnectError('Failed to load CRDT snapshot', Code.Internal);
  }
}

export async function reconcileSyncDirect(
  request: JsonRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const claims = await requireVfsClaims('/vfs/sync/reconcile', context.requestHeader);

  const parsedPayload = parseVfsSyncReconcilePayload(parseJsonBody(request.json));
  if (!parsedPayload.ok) {
    throw new ConnectError(parsedPayload.error, Code.InvalidArgument);
  }

  if (parsedPayload.value.clientId.includes(':')) {
    throw new ConnectError('clientId must not contain ":"', Code.InvalidArgument);
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

    return {
      json: JSON.stringify(response)
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to reconcile VFS sync cursor:', error);
    throw new ConnectError('Failed to reconcile sync cursor', Code.Internal);
  }
}
