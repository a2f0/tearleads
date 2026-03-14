import { Code, ConnectError } from '@connectrpc/connect';
import {
  buildVfsV2ConnectMethodPath,
  type VfsCrdtReconcileResponse
} from '@tearleads/shared';
import {
  encodeVfsSyncCursor,
  parseVfsCrdtLastReconciledWriteIds,
  parseVfsCrdtReconcilePayload
} from '@tearleads/vfs-sync/vfs';
import { getPostgresPool } from '../../lib/postgres.js';
import { requireVfsClaims } from './vfsDirectAuth.js';
import {
  parseIdentifier
} from './vfsDirectCrdtCompactDecoding.js';
import { toIsoString } from './vfsDirectCrdtRouteHelpers.js';

interface ReconcileCrdtRequest {
  organizationId?: string;
  clientId?: string;
  cursor: string;
  lastReconciledWriteIds: Record<string, number>;
}

interface ReconcileRow {
  last_reconciled_at: Date | string;
  last_reconciled_change_id: string;
  last_reconciled_write_ids: unknown;
}

function toScopedCrdtClientId(clientId: string): string {
  return `crdt:${clientId}`;
}

export async function reconcileCrdtDirect(
  request: ReconcileCrdtRequest,
  context: { requestHeader: Headers }
): Promise<VfsCrdtReconcileResponse> {
  const declaredOrganizationId = parseIdentifier(request.organizationId);
  const claims = await requireVfsClaims(
    buildVfsV2ConnectMethodPath('ReconcileCrdt'),
    context.requestHeader,
    {
      requireDeclaredOrganization: true,
      declaredOrganizationId
    }
  );
  const parsedClientId = parseIdentifier(request.clientId);

  const parsedPayload = parseVfsCrdtReconcilePayload({
    clientId: parsedClientId ?? request.clientId ?? '',
    cursor: request.cursor,
    lastReconciledWriteIds: request.lastReconciledWriteIds
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
        parsedPayload.value.cursor.changedAt,
        parsedPayload.value.cursor.changeId,
        JSON.stringify(parsedPayload.value.lastReconciledWriteIds)
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

    const response: VfsCrdtReconcileResponse = {
      clientId: parsedPayload.value.clientId,
      cursor: encodeVfsSyncCursor({
        changedAt: reconciledAt,
        changeId
      }),
      lastReconciledWriteIds: parsedLastWriteIds.value
    };

    return response;
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to reconcile VFS CRDT cursor:', error);
    throw new ConnectError('Failed to reconcile CRDT cursor', Code.Internal);
  }
}
