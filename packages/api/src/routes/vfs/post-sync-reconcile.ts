import type { VfsSyncReconcileResponse } from '@tearleads/shared';
import {
  encodeVfsSyncCursor,
  parseVfsSyncReconcilePayload
} from '@tearleads/vfs-sync/vfs';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { toIsoString } from './crdtRouteHelpers.js';

interface ReconcileRow {
  last_reconciled_at: Date | string;
  last_reconciled_change_id: string;
}

/**
 * @openapi
 * /vfs/vfs-sync/reconcile:
 *   post:
 *     summary: Reconcile per-client sync cursor
 *     description: Acknowledges the latest applied sync cursor for a given client and stores it monotonically.
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
 *             required:
 *               - clientId
 *               - cursor
 *     responses:
 *       200:
 *         description: Reconciled cursor for this user/client
 *       400:
 *         description: Invalid request payload
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
const postSyncReconcileHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsedPayload = parseVfsSyncReconcilePayload(req.body);
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
      res.status(500).json({ error: 'Failed to reconcile sync cursor' });
      return;
    }

    const response: VfsSyncReconcileResponse = {
      clientId: parsedPayload.value.clientId,
      cursor: encodeVfsSyncCursor({
        changedAt: reconciledAt,
        changeId
      })
    };

    res.json(response);
  } catch (error) {
    console.error('Failed to reconcile VFS sync cursor:', error);
    res.status(500).json({ error: 'Failed to reconcile sync cursor' });
  }
};

export function registerPostSyncReconcileRoute(routeRouter: RouterType): void {
  routeRouter.post('/vfs-sync/reconcile', postSyncReconcileHandler);
}
