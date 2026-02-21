import type { VfsCrdtSyncResponse } from '@tearleads/shared';
import {
  buildVfsCrdtSyncQuery,
  mapVfsCrdtSyncRows,
  parseVfsCrdtSyncQuery,
  type VfsCrdtSyncDbRow
} from '@tearleads/vfs-sync/vfs';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';

const CRDT_CLIENT_PUSH_SOURCE_TABLE = 'vfs_crdt_client_push';

interface VfsCrdtReplicaWriteIdRow {
  replica_id: string | null;
  max_write_id: string | number | null;
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
  /**
   * Guardrail: return a deterministic, sanitized replica clock map.
   * - drop malformed rows (blank replica, non-numeric write ids)
   * - keep only positive integers
   * - sort keys to keep payload stable for downstream snapshot comparisons
   */
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

/**
 * @openapi
 * /vfs/crdt/vfs-sync:
 *   get:
 *     summary: Incremental VFS CRDT operation feed
 *     description: Returns cursor-paginated CRDT operations visible to the authenticated user.
 *     tags:
 *       - VFS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cursor
 *         required: false
 *         schema:
 *           type: string
 *         description: Opaque cursor returned from a previous CRDT sync page.
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 500
 *         description: Maximum number of operations to return, default 100.
 *       - in: query
 *         name: rootId
 *         required: false
 *         schema:
 *           type: string
 *         description: Optional root ID to limit CRDT operations to a partial view.
 *     responses:
 *       200:
 *         description: Incremental CRDT operation page
 *       400:
 *         description: Invalid query parameters
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
const getCrdtSyncHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsedQuery = parseVfsCrdtSyncQuery({
    limit: req.query['limit'],
    cursor: req.query['cursor'],
    rootId: req.query['rootId']
  });
  if (!parsedQuery.ok) {
    res.status(400).json({ error: parsedQuery.error });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const query = buildVfsCrdtSyncQuery({
      userId: claims.sub,
      limit: parsedQuery.value.limit,
      cursor: parsedQuery.value.cursor,
      rootId: parsedQuery.value.rootId
    });

    const result = await pool.query<VfsCrdtSyncDbRow>(query.text, query.values);
    /**
     * Guardrail: include per-replica max write IDs in every pull response.
     * This allows clients to enforce monotonic stale-write recovery even when
     * the current pull page is empty (cursor-only checkpoint advancement).
     */
    const replicaWriteIdsResult = await pool.query<VfsCrdtReplicaWriteIdRow>(
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

    const response: VfsCrdtSyncResponse = mapVfsCrdtSyncRows(
      result.rows,
      parsedQuery.value.limit,
      toLastReconciledWriteIds(replicaWriteIdsResult.rows)
    );
    res.json(response);
  } catch (error) {
    console.error('Failed to sync VFS CRDT operations:', error);
    res.status(500).json({ error: 'Failed to sync VFS CRDT operations' });
  }
};

export function registerGetCrdtSyncRoute(routeRouter: RouterType): void {
  routeRouter.get('/crdt/vfs-sync', getCrdtSyncHandler);
}
