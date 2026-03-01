import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { loadVfsCrdtRematerializationSnapshot } from '../../lib/vfsCrdtSnapshots.js';

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

/**
 * @openapi
 * /vfs/crdt/snapshot:
 *   get:
 *     summary: Load latest server-side CRDT rematerialization snapshot
 *     description: Returns latest periodically refreshed CRDT snapshot state for stale-client recovery.
 *     tags:
 *       - VFS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *         description: Client identifier used for reconcile-state hydration.
 *     responses:
 *       200:
 *         description: Latest rematerialization snapshot
 *       400:
 *         description: Invalid query parameters
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No snapshot available
 *       500:
 *         description: Server error
 */
const getCrdtSnapshotHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const clientId = normalizeRequiredClientId(req.query['clientId']);
  if (!clientId) {
    res.status(400).json({
      error:
        'clientId must be non-empty, at most 128 characters, and must not include ":"'
    });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const snapshot = await loadVfsCrdtRematerializationSnapshot(pool, {
      userId: claims.sub,
      clientId
    });

    if (!snapshot) {
      res.status(404).json({ error: 'No CRDT snapshot is available' });
      return;
    }

    res.status(200).json(snapshot);
  } catch (error) {
    console.error('Failed to load VFS CRDT rematerialization snapshot:', error);
    res.status(500).json({ error: 'Failed to load CRDT snapshot' });
  }
};

export function registerGetCrdtSnapshotRoute(routeRouter: RouterType): void {
  routeRouter.get('/crdt/snapshot', getCrdtSnapshotHandler);
}
