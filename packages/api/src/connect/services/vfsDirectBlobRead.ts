import { Code, ConnectError } from '@connectrpc/connect';
import { buildVfsV2ConnectMethodPath } from '@tearleads/shared';
import { getPool } from '../../lib/postgres.js';
import { readVfsBlobData } from '../../lib/vfsBlobStore.js';
import { requireVfsClaims } from './vfsDirectAuth.js';
import { normalizeRequiredString } from './vfsDirectBlobShared.js';

interface BlobManifestRow {
  blob_id: string;
  key_epoch: number;
  chunk_count: number;
  total_plaintext_bytes: number;
  total_ciphertext_bytes: number;
  chunk_hashes: string[];
  chunk_boundaries: Array<{
    offset: number;
    length: number;
    plaintextLength: number;
    nonce?: string;
    aadHash?: string;
  }>;
  manifest_hash: string;
  manifest_signature: string;
}

interface BlobVisibilityRow {
  user_id: string | null;
}

export interface GetBlobManifestResponse {
  blobId: string;
  keyEpoch: number;
  chunkCount: number;
  totalPlaintextBytes: number;
  totalCiphertextBytes: number;
  chunkHashes: string[];
  manifestHash: string;
  manifestSignature: string;
  contentType?: string;
}

export interface GetBlobChunkResponse {
  data: Uint8Array;
  chunkIndex: number;
  isFinal: boolean;
  plaintextLength: number;
  ciphertextLength: number;
  nonce: string;
  aadHash: string;
}

async function requireBlobReadAccess(
  blobId: string,
  claims: { sub: string }
): Promise<void> {
  const pool = await getPool('read');
  const result = await pool.query<BlobVisibilityRow>(
    `
    SELECT vev.user_id
    FROM vfs_registry vr
    LEFT JOIN vfs_effective_visibility vev
      ON vev.item_id = vr.id AND vev.user_id = $2::uuid
    WHERE vr.id = $1::uuid
    LIMIT 1
    `,
    [blobId, claims.sub]
  );

  const row = result.rows[0];
  if (!row) {
    throw new ConnectError('Blob not found', Code.NotFound);
  }

  if (!row.user_id) {
    throw new ConnectError('Forbidden', Code.PermissionDenied);
  }
}

export async function getBlobManifestDirect(
  request: { blobId: string },
  context: { requestHeader: Headers }
): Promise<GetBlobManifestResponse> {
  const blobId = normalizeRequiredString(request.blobId);
  if (!blobId) {
    throw new ConnectError('blobId is required', Code.InvalidArgument);
  }

  const claims = await requireVfsClaims(
    buildVfsV2ConnectMethodPath('GetBlobManifest'),
    context.requestHeader
  );

  await requireBlobReadAccess(blobId, claims);

  const pool = await getPool('read');
  const result = await pool.query<BlobManifestRow>(
    `
    SELECT
      blob_id,
      key_epoch,
      chunk_count,
      total_plaintext_bytes,
      total_ciphertext_bytes,
      chunk_hashes,
      chunk_boundaries,
      manifest_hash,
      manifest_signature
    FROM vfs_blob_manifests
    WHERE blob_id = $1::uuid
    LIMIT 1
    `,
    [blobId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new ConnectError('Blob manifest not found', Code.NotFound);
  }

  return {
    blobId: row.blob_id,
    keyEpoch: row.key_epoch,
    chunkCount: row.chunk_count,
    totalPlaintextBytes: row.total_plaintext_bytes,
    totalCiphertextBytes: row.total_ciphertext_bytes,
    chunkHashes: row.chunk_hashes,
    manifestHash: row.manifest_hash,
    manifestSignature: row.manifest_signature
  };
}

export async function getBlobChunkDirect(
  request: { blobId: string; chunkIndex: number },
  context: { requestHeader: Headers }
): Promise<GetBlobChunkResponse> {
  const blobId = normalizeRequiredString(request.blobId);
  if (!blobId) {
    throw new ConnectError('blobId is required', Code.InvalidArgument);
  }

  const chunkIndex = request.chunkIndex;
  if (
    typeof chunkIndex !== 'number' ||
    !Number.isInteger(chunkIndex) ||
    chunkIndex < 0
  ) {
    throw new ConnectError(
      'chunkIndex must be a non-negative integer',
      Code.InvalidArgument
    );
  }

  const claims = await requireVfsClaims(
    buildVfsV2ConnectMethodPath('GetBlobChunk'),
    context.requestHeader
  );

  await requireBlobReadAccess(blobId, claims);

  const pool = await getPool('read');
  const manifestResult = await pool.query<BlobManifestRow>(
    `
    SELECT
      chunk_count,
      chunk_boundaries
    FROM vfs_blob_manifests
    WHERE blob_id = $1::uuid
    LIMIT 1
    `,
    [blobId]
  );

  const manifest = manifestResult.rows[0];
  if (!manifest) {
    throw new ConnectError('Blob manifest not found', Code.NotFound);
  }

  if (chunkIndex >= manifest.chunk_count) {
    throw new ConnectError('Chunk index out of range', Code.InvalidArgument);
  }

  const boundary = manifest.chunk_boundaries[chunkIndex];
  if (!boundary) {
    throw new ConnectError('Chunk boundary not found', Code.Internal);
  }

  const blobData = await readVfsBlobData({ blobId });
  const chunkData = blobData.data.slice(
    boundary.offset,
    boundary.offset + boundary.length
  );

  return {
    data: chunkData,
    chunkIndex,
    isFinal: chunkIndex === manifest.chunk_count - 1,
    plaintextLength: boundary.plaintextLength,
    ciphertextLength: boundary.length,
    nonce: boundary.nonce ?? '',
    aadHash: boundary.aadHash ?? ''
  };
}
