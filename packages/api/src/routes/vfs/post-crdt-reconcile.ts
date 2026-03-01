import type { VfsCrdtReconcileResponse } from '@tearleads/shared';
import {
  decodeVfsCrdtReconcileRequestProtobuf,
  encodeVfsCrdtReconcileResponseProtobuf,
  encodeVfsSyncCursor,
  parseVfsCrdtLastReconciledWriteIds,
  parseVfsCrdtReconcilePayload
} from '@tearleads/vfs-sync/vfs';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import {
  createCrdtProtobufRawBodyParser,
  decodeCrdtRequestBody,
  sendCrdtProtobufOrJson
} from './crdtProtobuf.js';
import { toIsoString } from './crdtRouteHelpers.js';

interface ReconcileRow {
  last_reconciled_at: Date | string;
  last_reconciled_change_id: string;
  last_reconciled_write_ids: unknown;
}

const CRDT_CLIENT_NAMESPACE = 'crdt';

/**
 * Guardrail: persist CRDT cursor state under a feed-specific namespace so
 * client IDs do not collide with the standard VFS sync feed cursors.
 */
function toScopedCrdtClientId(clientId: string): string {
  return `${CRDT_CLIENT_NAMESPACE}:${clientId}`;
}

/**
 * @openapi
 * /vfs/crdt/reconcile:
 *   post:
 *     summary: Reconcile per-client CRDT cursor
 *     description: Acknowledges the latest applied CRDT cursor for a given client and stores it monotonically.
 *     tags:
 *       - VFS
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               clientId:
 *                 type: string
 *               cursor:
 *                 type: string
 *               lastReconciledWriteIds:
 *                 type: object
 *                 additionalProperties:
 *                   type: integer
 *                 description: Optional per-replica write-id watermarks to merge monotonically.
 *             required:
 *               - clientId
 *               - cursor
 *     responses:
 *       200:
 *         description: Reconciled CRDT cursor for this user/client
 *       400:
 *         description: Invalid request payload
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
const postCrdtReconcileHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const decodedRequestBody = decodeCrdtRequestBody(
    req,
    decodeVfsCrdtReconcileRequestProtobuf
  );
  if (!decodedRequestBody.ok) {
    res.status(400).json({ error: decodedRequestBody.error });
    return;
  }

  const parsedPayload = parseVfsCrdtReconcilePayload(decodedRequestBody.value);
  if (!parsedPayload.ok) {
    res.status(400).json({ error: parsedPayload.error });
    return;
  }

  // Guardrail: ':' is reserved for feed namespacing in cursor state keys.
  if (parsedPayload.value.clientId.includes(':')) {
    res.status(400).json({ error: 'clientId must not contain ":"' });
    return;
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
      res.status(500).json({ error: 'Failed to reconcile CRDT cursor' });
      return;
    }

    const response: VfsCrdtReconcileResponse = {
      clientId: parsedPayload.value.clientId,
      cursor: encodeVfsSyncCursor({
        changedAt: reconciledAt,
        changeId
      }),
      lastReconciledWriteIds: parsedLastWriteIds.value
    };

    sendCrdtProtobufOrJson(
      req,
      res,
      200,
      response,
      encodeVfsCrdtReconcileResponseProtobuf
    );
  } catch (error) {
    console.error('Failed to reconcile VFS CRDT cursor:', error);
    res.status(500).json({ error: 'Failed to reconcile CRDT cursor' });
  }
};

export function registerPostCrdtReconcileRoute(routeRouter: RouterType): void {
  routeRouter.post(
    '/crdt/reconcile',
    createCrdtProtobufRawBodyParser(),
    postCrdtReconcileHandler
  );
}
