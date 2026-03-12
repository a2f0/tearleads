import { Code, ConnectError } from '@connectrpc/connect';
import { buildVfsV2ConnectMethodPath } from '@tearleads/shared';
import type { PoolClient } from 'pg';
import { getPool, getPostgresPool } from '../../lib/postgres.js';
import { deleteVfsBlobData, readVfsBlobData } from '../../lib/vfsBlobStore.js';
import { requireVfsClaims } from './vfsDirectAuth.js';
import {
  isPostgresErrorWithCode,
  normalizeRequiredString
} from './vfsDirectBlobShared.js';

type BlobIdRequest = { blobId: string };

interface BlobRegistryRow {
  object_type: string;
  owner_id: string | null;
}

export async function getBlobDirect(
  request: BlobIdRequest,
  context: { requestHeader: Headers }
): Promise<{ data: Uint8Array; contentType?: string }> {
  const blobId = normalizeRequiredString(request.blobId);
  if (!blobId) {
    throw new ConnectError('blobId is required', Code.InvalidArgument);
  }

  const claims = await requireVfsClaims(
    buildVfsV2ConnectMethodPath('GetBlob'),
    context.requestHeader
  );

  try {
    const pool = await getPool('read');
    const blobRegistryResult = await pool.query<BlobRegistryRow>(
      `
      SELECT object_type, owner_id
      FROM vfs_registry
      WHERE id = $1::uuid
      LIMIT 1
      `,
      [blobId]
    );
    const blobRegistryRow = blobRegistryResult.rows[0];
    if (!blobRegistryRow) {
      throw new ConnectError('Blob object not found', Code.NotFound);
    }

    if (blobRegistryRow.object_type !== 'file') {
      throw new ConnectError(
        'Blob object id conflicts with existing VFS object',
        Code.AlreadyExists
      );
    }

    if (blobRegistryRow.owner_id !== claims.sub) {
      throw new ConnectError('Forbidden', Code.PermissionDenied);
    }

    const blobData = await readVfsBlobData({ blobId });
    return {
      data: blobData.data,
      ...(blobData.contentType ? { contentType: blobData.contentType } : {})
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    if (isPostgresErrorWithCode(error, '23503')) {
      throw new ConnectError('Blob object not found', Code.NotFound);
    }

    console.error('Failed to read blob data:', error);
    throw new ConnectError('Failed to read blob data', Code.Internal);
  }
}

export async function deleteBlobDirect(
  request: BlobIdRequest,
  context: { requestHeader: Headers }
): Promise<{ deleted: boolean; blobId: string }> {
  const blobId = normalizeRequiredString(request.blobId);
  if (!blobId) {
    throw new ConnectError('blobId is required', Code.InvalidArgument);
  }

  const claims = await requireVfsClaims(
    buildVfsV2ConnectMethodPath('DeleteBlob'),
    context.requestHeader,
    { requireDeclaredOrganization: true }
  );

  const pool = await getPostgresPool();
  const client = await pool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    const blobRegistryResult = await client.query<BlobRegistryRow>(
      `
      SELECT object_type, owner_id
      FROM vfs_registry
      WHERE id = $1::uuid
      LIMIT 1
      FOR UPDATE
      `,
      [blobId]
    );
    const blobRegistryRow = blobRegistryResult.rows[0];
    if (!blobRegistryRow) {
      await client.query('ROLLBACK');
      inTransaction = false;
      throw new ConnectError('Blob object not found', Code.NotFound);
    }

    if (blobRegistryRow.object_type !== 'file') {
      await client.query('ROLLBACK');
      inTransaction = false;
      throw new ConnectError(
        'Blob object id conflicts with existing VFS object',
        Code.AlreadyExists
      );
    }

    if (blobRegistryRow.owner_id !== claims.sub) {
      await client.query('ROLLBACK');
      inTransaction = false;
      throw new ConnectError('Forbidden', Code.PermissionDenied);
    }

    const attachedLinkResult = await client.query(
      `
      SELECT 1
      FROM vfs_links
      WHERE child_id = $1::uuid
        AND wrapped_session_key LIKE 'blob-link:%'
      LIMIT 1
      FOR UPDATE
      `,
      [blobId]
    );
    if (attachedLinkResult.rows.length > 0) {
      await client.query('ROLLBACK');
      inTransaction = false;
      throw new ConnectError(
        'Blob is attached and cannot be deleted',
        Code.AlreadyExists
      );
    }

    const deleted = await client.query(
      `
      DELETE FROM vfs_registry
      WHERE id = $1::uuid
        AND object_type = 'file'
      `,
      [blobId]
    );
    if ((deleted.rowCount ?? 0) < 1) {
      throw new ConnectError(
        'Failed to delete blob registry row',
        Code.Internal
      );
    }

    await deleteVfsBlobData({ blobId });

    await client.query('COMMIT');
    inTransaction = false;

    return { deleted: true, blobId };
  } catch (error) {
    if (inTransaction) {
      await rollbackQuietly(client);
    }

    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to delete blob data:', error);
    throw new ConnectError('Failed to delete blob data', Code.Internal);
  } finally {
    client.release();
  }
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // no-op
  }
}
