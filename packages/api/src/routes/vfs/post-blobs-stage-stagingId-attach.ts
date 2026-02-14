import { randomUUID } from 'node:crypto';
import type { Request, Response, Router as RouterType } from 'express';
import type { PoolClient } from 'pg';
import { getPostgresPool } from '../../lib/postgres.js';
import {
  normalizeRequiredString,
  parseBlobAttachBody,
  toIsoFromDateOrString
} from './blob-shared.js';

interface BlobStagingRow {
  id: string;
  blob_id: string;
  staged_by: string;
  status: string;
  expires_at: Date | string;
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

  const pool = await getPostgresPool();
  const client = await pool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    const stagedResult = await client.query<BlobStagingRow>(
      `
      SELECT id, blob_id, staged_by, status, expires_at
      FROM vfs_blob_staging
      WHERE id = $1::text
      FOR UPDATE
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

    const expiresAtMs = Date.parse(toIsoFromDateOrString(stagedRow.expires_at));
    if (expiresAtMs <= Date.now()) {
      await client.query('ROLLBACK');
      inTransaction = false;
      res.status(409).json({ error: 'Blob staging has expired' });
      return;
    }

    const updatedResult = await client.query<{
      blob_id: string;
      attached_at: Date | string;
      attached_item_id: string;
    }>(
      `
      UPDATE vfs_blob_staging
      SET status = 'attached',
          attached_at = NOW(),
          attached_item_id = $2::text
      WHERE id = $1::text
      RETURNING blob_id, attached_at, attached_item_id
      `,
      [stagingId, parsedBody.itemId]
    );

    const updatedRow = updatedResult.rows[0];
    if (!updatedRow) {
      throw new Error('Failed to update blob staging attach state');
    }

    const insertedRef = await client.query<{
      id: string;
      attached_at: Date | string;
    }>(
      `
      INSERT INTO vfs_blob_refs (
        id,
        blob_id,
        item_id,
        relation_kind,
        attached_by,
        attached_at
      ) VALUES (
        $1::text,
        $2::text,
        $3::text,
        $4::text,
        $5::text,
        NOW()
      )
      ON CONFLICT (blob_id, item_id, relation_kind) DO NOTHING
      RETURNING id, attached_at
      `,
      [
        randomUUID(),
        updatedRow.blob_id,
        parsedBody.itemId,
        parsedBody.relationKind,
        claims.sub
      ]
    );

    let refId: string;
    let attachedAt: Date | string;

    const insertedRow = insertedRef.rows[0];
    if (insertedRow) {
      refId = insertedRow.id;
      attachedAt = insertedRow.attached_at;
    } else {
      const existingRef = await client.query<{
        id: string;
        attached_at: Date | string;
      }>(
        `
        SELECT id, attached_at
        FROM vfs_blob_refs
        WHERE blob_id = $1::text
          AND item_id = $2::text
          AND relation_kind = $3::text
        LIMIT 1
        `,
        [updatedRow.blob_id, parsedBody.itemId, parsedBody.relationKind]
      );

      const existingRow = existingRef.rows[0];
      if (!existingRow) {
        throw new Error('Failed to persist blob attachment reference');
      }

      refId = existingRow.id;
      attachedAt = existingRow.attached_at;
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
