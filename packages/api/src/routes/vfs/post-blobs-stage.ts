import type { Request, Response, Router as RouterType } from 'express';
import type { PoolClient } from 'pg';
import { getPostgresPool } from '../../lib/postgres.js';
import { persistVfsBlobData } from '../../lib/vfsBlobStore.js';
import { isPostgresErrorWithCode, parseBlobStageBody } from './blob-shared.js';

interface BlobRegistryTypeRow {
  object_type: string;
}

interface BlobStageRow {
  id: string;
  blob_id: string;
  status: string;
  staged_at: Date | string;
  expires_at: Date | string;
}

function parseBase64Data(dataBase64: string): Buffer | null {
  const normalized = dataBase64.replace(/\s+/g, '');
  if (normalized.length === 0) {
    return null;
  }

  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.length === 0) {
    return null;
  }

  if (
    decoded.toString('base64').replace(/=+$/u, '') !==
    normalized.replace(/=+$/u, '')
  ) {
    return null;
  }

  return decoded;
}

const postBlobsStageHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsedBody = parseBlobStageBody(req.body);
  if (!parsedBody) {
    res.status(400).json({ error: 'blobId and expiresAt are required' });
    return;
  }

  if (Date.parse(parsedBody.expiresAt) <= Date.now()) {
    res.status(400).json({ error: 'expiresAt must be in the future' });
    return;
  }

  let decodedBlobData: Buffer | null = null;
  if (parsedBody.dataBase64) {
    decodedBlobData = parseBase64Data(parsedBody.dataBase64);
    if (!decodedBlobData) {
      res.status(400).json({ error: 'dataBase64 must be valid base64' });
      return;
    }
  }

  if (decodedBlobData) {
    try {
      await persistVfsBlobData({
        blobId: parsedBody.blobId,
        data: decodedBlobData,
        ...(parsedBody.contentType
          ? { contentType: parsedBody.contentType }
          : {})
      });
    } catch (error) {
      console.error('Failed to persist blob data for VFS stage:', error);
      res.status(500).json({ error: 'Failed to persist blob data' });
      return;
    }
  }

  try {
    const pool = await getPostgresPool();
    const client = await pool.connect();
    let inTransaction = false;

    try {
      await client.query('BEGIN');
      inTransaction = true;

      await client.query(
        `
        INSERT INTO vfs_registry (
          id,
          object_type,
          owner_id,
          created_at
        ) VALUES (
          $1::text,
          'file',
          $2::text,
          NOW()
        )
        ON CONFLICT (id) DO NOTHING
        `,
        [parsedBody.blobId, claims.sub]
      );

      const blobRegistryResult = await client.query<BlobRegistryTypeRow>(
        `
        SELECT object_type
        FROM vfs_registry
        WHERE id = $1::text
        LIMIT 1
        FOR UPDATE
        `,
        [parsedBody.blobId]
      );
      const blobRegistryRow = blobRegistryResult.rows[0];
      if (!blobRegistryRow) {
        await client.query('ROLLBACK');
        inTransaction = false;
        res.status(404).json({ error: 'Blob object not found' });
        return;
      }

      if (blobRegistryRow.object_type !== 'file') {
        await client.query('ROLLBACK');
        inTransaction = false;
        res
          .status(409)
          .json({ error: 'Blob object id conflicts with existing VFS object' });
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
          'blobStage',
          $2::text,
          NOW()
        )
        `,
        [parsedBody.stagingId, claims.sub]
      );

      /**
       * Guardrail: stage state is represented as a dedicated link row keyed by
       * stagingId, so attach/abandon can lock and transition exactly one record.
       */
      const result = await client.query<BlobStageRow>(
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
          $1::text,
          $2::text,
          'blob-stage:staged',
          jsonb_build_object(
            'status',
            'staged',
            'expiresAt',
            $3::timestamptz
          )::json,
          NOW()
        )
        RETURNING
          id,
          child_id AS blob_id,
          'staged'::text AS status,
          created_at AS staged_at,
          $3::timestamptz AS expires_at
        `,
        [parsedBody.stagingId, parsedBody.blobId, parsedBody.expiresAt]
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error('Failed to stage blob');
      }

      await client.query('COMMIT');
      inTransaction = false;

      res.status(201).json({
        stagingId: row.id,
        blobId: row.blob_id,
        status: row.status,
        stagedAt:
          row.staged_at instanceof Date
            ? row.staged_at.toISOString()
            : new Date(row.staged_at).toISOString(),
        expiresAt:
          row.expires_at instanceof Date
            ? row.expires_at.toISOString()
            : new Date(row.expires_at).toISOString()
      });
    } catch (error) {
      if (inTransaction) {
        await rollbackQuietly(client);
      }

      if (isPostgresErrorWithCode(error, '23503')) {
        res.status(404).json({ error: 'Blob object not found' });
        return;
      }

      if (isPostgresErrorWithCode(error, '23505')) {
        res.status(409).json({ error: 'Blob staging already exists' });
        return;
      }

      console.error('Failed to stage blob for VFS attach:', error);
      res.status(500).json({ error: 'Failed to stage blob' });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Failed to stage blob for VFS attach:', error);
    res.status(500).json({ error: 'Failed to stage blob' });
  }
};

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // no-op
  }
}

export function registerPostBlobsStageRoute(routeRouter: RouterType): void {
  routeRouter.post('/blobs/stage', postBlobsStageHandler);
}
