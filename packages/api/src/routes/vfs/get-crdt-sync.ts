import type { VfsCrdtSyncResponse } from '@tearleads/shared';
import {
  buildVfsCrdtSyncQuery,
  encodeVfsCrdtSyncResponseProtobuf,
  encodeVfsSyncCursor,
  mapVfsCrdtSyncRows,
  parseVfsCrdtSyncQuery,
  type VfsCrdtSyncDbRow,
  type VfsSyncCursor
} from '@tearleads/vfs-sync/vfs';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { sendCrdtProtobufOrJson } from './crdtProtobuf.js';
import {
  toLastReconciledWriteIds,
  type VfsCrdtReplicaWriteIdRow
} from './crdtRouteHelpers.js';

const CRDT_CLIENT_PUSH_SOURCE_TABLE = 'vfs_crdt_client_push';
const CRDT_REMATERIALIZATION_REQUIRED_CODE = 'crdt_rematerialization_required';

interface CursorBoundaryRow {
  occurred_at: Date | string;
  id: string;
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
  pool: { query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }> },
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
    SELECT ops.occurred_at, ops.id
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
    ORDER BY ops.occurred_at ASC, ops.id ASC
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
 *       409:
 *         description: Cursor is older than retained CRDT history and client must re-materialize.
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
    if (parsedQuery.value.cursor) {
      const oldestAccessibleCursor = await loadOldestAccessibleCursor(
        pool,
        claims.sub,
        parsedQuery.value.rootId
      );
      if (
        oldestAccessibleCursor &&
        compareCursor(parsedQuery.value.cursor, oldestAccessibleCursor) < 0
      ) {
        res.status(409).json({
          error:
            'CRDT cursor is older than retained history; re-materialization required',
          code: CRDT_REMATERIALIZATION_REQUIRED_CODE,
          requestedCursor: encodeVfsSyncCursor(parsedQuery.value.cursor),
          oldestAvailableCursor: encodeVfsSyncCursor(oldestAccessibleCursor)
        });
        return;
      }
    }

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
    sendCrdtProtobufOrJson(
      req,
      res,
      200,
      response,
      encodeVfsCrdtSyncResponseProtobuf
    );
  } catch (error) {
    console.error('Failed to sync VFS CRDT operations:', error);
    res.status(500).json({ error: 'Failed to sync VFS CRDT operations' });
  }
};

export function registerGetCrdtSyncRoute(routeRouter: RouterType): void {
  routeRouter.get('/crdt/vfs-sync', getCrdtSyncHandler);
}
