import { randomUUID } from 'node:crypto';
import {
  compareVfsSyncCursorOrder,
  parseVfsCrdtLastReconciledWriteIds,
  type VfsSyncCursor
} from '@tearleads/vfs-sync/vfs';
import type { Request, Response, Router as RouterType } from 'express';
import type { PoolClient } from 'pg';
import { getPostgresPool } from '../../lib/postgres.js';
import {
  normalizeRequiredString,
  parseBlobAttachBody,
  toIsoFromDateOrString
} from './blob-shared.js';
import {
  dominatesLastWriteIds,
  parseBlobAttachConsistency,
  parseBlobLinkRelationKind,
  parseBlobLinkRelationKindFromSessionKey,
  toBlobLinkSessionKey,
  toScopedCrdtClientId
} from './post-blobs-stage-stagingId-attach-helpers.js';

interface BlobStagingRow {
  id: string;
  blob_id: string;
  staged_by: string | null;
  status: string;
  expires_at: Date | string | null;
}

interface CrdtReconcileStateRow {
  last_reconciled_at: Date | string;
  last_reconciled_change_id: string;
  last_reconciled_write_ids: unknown;
}

interface BlobRegistryRow {
  object_type: string;
}

interface BlobLinkRow {
  id: string;
  created_at: Date | string;
  wrapped_session_key: string | null;
  visible_children: unknown;
}

export const postBlobsStageStagingIdAttachHandler = async (
  req: Request,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const stagingId = normalizeRequiredString(req.params['stagingId']);
  if (!stagingId) {
    res.status(400).json({ error: 'stagingId is required' });
    return;
  }

  const parsedBody = parseBlobAttachBody(req.body);
  if (!parsedBody) {
    res.status(400).json({ error: 'itemId is required' });
    return;
  }

  const parsedConsistency = parseBlobAttachConsistency(req.body);
  if (!parsedConsistency.ok) {
    res.status(400).json({ error: parsedConsistency.error });
    return;
  }

  const pool = await getPostgresPool();
  const client = await pool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    const stagedResult = await client.query<BlobStagingRow>(
      `
      SELECT
        stage_registry.id AS id,
        stage_link.child_id AS blob_id,
        stage_registry.owner_id AS staged_by,
        CASE stage_link.wrapped_session_key
          WHEN 'blob-stage:staged' THEN 'staged'
          WHEN 'blob-stage:attached' THEN 'attached'
          WHEN 'blob-stage:abandoned' THEN 'abandoned'
          ELSE 'invalid'
        END AS status,
        (stage_link.visible_children ->> 'expiresAt')::timestamptz AS expires_at
      FROM vfs_registry AS stage_registry
      INNER JOIN vfs_links AS stage_link
        ON stage_link.id = stage_registry.id
       AND stage_link.parent_id = stage_registry.id
      WHERE stage_registry.id = $1::text
        AND stage_registry.object_type = 'blobStage'
      FOR UPDATE OF stage_registry, stage_link
      `,
      [stagingId]
    );

    const stagedRow = stagedResult.rows[0];
    if (!stagedRow) {
      await client.query('ROLLBACK');
      inTransaction = false;
      res.status(404).json({ error: 'Blob staging not found' });
      return;
    }

    if (stagedRow.staged_by !== claims.sub) {
      await client.query('ROLLBACK');
      inTransaction = false;
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    if (stagedRow.status !== 'staged') {
      await client.query('ROLLBACK');
      inTransaction = false;
      res.status(409).json({ error: 'Blob staging is no longer attachable' });
      return;
    }

    if (!stagedRow.expires_at) {
      await client.query('ROLLBACK');
      inTransaction = false;
      res.status(500).json({ error: 'Failed to attach staged blob' });
      return;
    }

    const expiresAtMs = Date.parse(toIsoFromDateOrString(stagedRow.expires_at));
    if (expiresAtMs <= Date.now()) {
      await client.query('ROLLBACK');
      inTransaction = false;
      res.status(409).json({ error: 'Blob staging has expired' });
      return;
    }

    if (parsedConsistency.value) {
      const reconcileState = await client.query<CrdtReconcileStateRow>(
        `
        SELECT
          last_reconciled_at,
          last_reconciled_change_id,
          last_reconciled_write_ids
        FROM vfs_sync_client_state
        WHERE user_id = $1::text
          AND client_id = $2::text
        FOR UPDATE
        `,
        [claims.sub, toScopedCrdtClientId(parsedConsistency.value.clientId)]
      );

      const reconcileStateRow = reconcileState.rows[0];
      if (!reconcileStateRow) {
        await client.query('ROLLBACK');
        inTransaction = false;
        res.status(409).json({
          error: 'Client reconcile state is behind required visibility'
        });
        return;
      }

      const currentCursor: VfsSyncCursor = {
        changedAt: toIsoFromDateOrString(reconcileStateRow.last_reconciled_at),
        changeId: reconcileStateRow.last_reconciled_change_id
      };

      const parsedCurrentLastWriteIds = parseVfsCrdtLastReconciledWriteIds(
        reconcileStateRow.last_reconciled_write_ids
      );
      if (!parsedCurrentLastWriteIds.ok) {
        await client.query('ROLLBACK');
        inTransaction = false;
        res.status(500).json({ error: 'Failed to attach staged blob' });
        return;
      }

      if (
        compareVfsSyncCursorOrder(
          currentCursor,
          parsedConsistency.value.requiredCursor
        ) < 0 ||
        !dominatesLastWriteIds(
          parsedCurrentLastWriteIds.value,
          parsedConsistency.value.requiredLastReconciledWriteIds
        )
      ) {
        await client.query('ROLLBACK');
        inTransaction = false;
        res.status(409).json({
          error: 'Client reconcile state is behind required visibility'
        });
        return;
      }
    }

    const attachedAtIso = new Date().toISOString();
    /**
     * Guardrail: status transition is conditional on the row still being in the
     * staged state. This prevents double-commit on attach races.
     */
    const updatedResult = await client.query<{
      blob_id: string;
      attached_at: Date | string;
      attached_item_id: string;
    }>(
      `
      UPDATE vfs_links
      SET wrapped_session_key = 'blob-stage:attached',
          visible_children = jsonb_set(
            jsonb_set(
              jsonb_set(
                COALESCE(vfs_links.visible_children::jsonb, '{}'::jsonb),
                '{status}',
                to_jsonb('attached'::text),
                true
              ),
              '{attachedAt}',
              to_jsonb($2::text),
              true
            ),
            '{attachedItemId}',
            to_jsonb($3::text),
            true
          )::json
      WHERE id = $1::text
        AND wrapped_session_key = 'blob-stage:staged'
      RETURNING
        child_id AS blob_id,
        $2::timestamptz AS attached_at,
        $3::text AS attached_item_id
      `,
      [stagingId, attachedAtIso, parsedBody.itemId]
    );

    const updatedRow = updatedResult.rows[0];
    if (!updatedRow) {
      await client.query('ROLLBACK');
      inTransaction = false;
      res.status(409).json({ error: 'Blob staging is no longer attachable' });
      return;
    }

    await client.query(
      `
      INSERT INTO vfs_registry (
        id,
        object_type,
        owner_id,
        created_at
      ) VALUES (
        $1::text,
        'blob',
        $2::text,
        NOW()
      )
      ON CONFLICT (id) DO NOTHING
      `,
      [updatedRow.blob_id, claims.sub]
    );

    const blobRegistryResult = await client.query<BlobRegistryRow>(
      `
      SELECT object_type
      FROM vfs_registry
      WHERE id = $1::text
      LIMIT 1
      `,
      [updatedRow.blob_id]
    );
    const blobRegistryRow = blobRegistryResult.rows[0];
    if (!blobRegistryRow || blobRegistryRow.object_type !== 'blob') {
      await client.query('ROLLBACK');
      inTransaction = false;
      res
        .status(409)
        .json({ error: 'Blob object id conflicts with existing VFS object' });
      return;
    }

    const insertedRef = await client.query<{
      id: string;
      created_at: Date | string;
    }>(
      `
      INSERT INTO vfs_links (
        id,
        parent_id,
        child_id,
        wrapped_session_key,
        visible_children,
        created_at
      ) VALUES (
        $1::text,
        $2::text,
        $3::text,
        $4::text,
        $5::json,
        NOW()
      )
      ON CONFLICT (parent_id, child_id) DO NOTHING
      RETURNING id, created_at
      `,
      [
        randomUUID(),
        parsedBody.itemId,
        updatedRow.blob_id,
        toBlobLinkSessionKey(parsedBody.relationKind),
        JSON.stringify({
          relationKind: parsedBody.relationKind,
          attachedBy: claims.sub
        })
      ]
    );

    let refId: string;
    let attachedAt: Date | string;

    const insertedRow = insertedRef.rows[0];
    if (insertedRow) {
      refId = insertedRow.id;
      attachedAt = insertedRow.created_at;
    } else {
      const existingRef = await client.query<BlobLinkRow>(
        `
        SELECT id, created_at, wrapped_session_key, visible_children
        FROM vfs_links
        WHERE parent_id = $1::text
          AND child_id = $2::text
        LIMIT 1
        `,
        [parsedBody.itemId, updatedRow.blob_id]
      );

      const existingRow = existingRef.rows[0];
      if (!existingRow) {
        throw new Error('Failed to persist blob attachment reference');
      }

      const existingRelationKind =
        parseBlobLinkRelationKind(existingRow.visible_children) ??
        parseBlobLinkRelationKindFromSessionKey(
          existingRow.wrapped_session_key
        );
      /**
       * Guardrail: blob link identity is currently `(item_id, blob_id)` in
       * vfs_links. If a conflicting relation kind already exists for the same
       * pair, fail closed so sync projections stay deterministic.
       */
      if (
        existingRelationKind &&
        existingRelationKind !== parsedBody.relationKind
      ) {
        await client.query('ROLLBACK');
        inTransaction = false;
        res.status(409).json({
          error: 'Blob is already attached with a different relation kind'
        });
        return;
      }

      refId = existingRow.id;
      attachedAt = existingRow.created_at;
    }

    await client.query('COMMIT');
    inTransaction = false;

    res.status(200).json({
      attached: true,
      stagingId,
      blobId: updatedRow.blob_id,
      itemId: parsedBody.itemId,
      relationKind: parsedBody.relationKind,
      refId,
      attachedAt: toIsoFromDateOrString(attachedAt)
    });
  } catch (error) {
    if (inTransaction) {
      await rollbackQuietly(client);
    }

    console.error('Failed to attach staged blob:', error);
    res.status(500).json({ error: 'Failed to attach staged blob' });
  } finally {
    client.release();
  }
};

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // no-op
  }
}

export function registerPostBlobsStageStagingIdAttachRoute(
  routeRouter: RouterType
): void {
  routeRouter.post(
    '/blobs/stage/:stagingId/attach',
    postBlobsStageStagingIdAttachHandler
  );
}
