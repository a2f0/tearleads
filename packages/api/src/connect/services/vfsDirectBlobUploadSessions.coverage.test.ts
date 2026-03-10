import './vfsDirectTestSupport.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearBlobUploadSessions,
  deleteBlobUploadSession,
  deleteBlobUploadSessionsForStaging,
  getBlobUploadChunks,
  upsertBlobUploadChunk
} from './vfsDirectBlobUploadSessions.js';
import {
  mockRedisClient,
  mockRedisStore,
  setupVfsTestEnv,
  teardownVfsTestEnv
} from './vfsDirectTestSupport.js';
import { setTestEnv } from '../../test/env.js';

const BLOB_UPLOAD_CHUNK_KEY_PREFIX = 'vfs:blobUpload';
const BLOB_UPLOAD_INDEX_KEY_PREFIX = 'vfs:blobUploadIndex';
const BLOB_UPLOAD_STAGE_UPLOADS_KEY_PREFIX = 'vfs:blobUploadStageUploads';
const BLOB_UPLOAD_STAGES_KEY = 'vfs:blobUploadStages';

function toChunkKey(input: {
  stagingId: string;
  uploadId: string;
  chunkIndex: number;
}): string {
  return `${BLOB_UPLOAD_CHUNK_KEY_PREFIX}:${input.stagingId}:${input.uploadId}:${String(input.chunkIndex)}`;
}

function toUploadIndexKey(input: {
  stagingId: string;
  uploadId: string;
}): string {
  return `${BLOB_UPLOAD_INDEX_KEY_PREFIX}:${input.stagingId}:${input.uploadId}`;
}

function toStageUploadsKey(stagingId: string): string {
  return `${BLOB_UPLOAD_STAGE_UPLOADS_KEY_PREFIX}:${stagingId}`;
}

describe('vfsDirectBlobUploadSessions', () => {
  beforeEach(async () => {
    setupVfsTestEnv();
    await clearBlobUploadSessions();
  });

  afterEach(async () => {
    await clearBlobUploadSessions();
    teardownVfsTestEnv();
  });

  it('stores and retrieves sorted chunks for an upload', async () => {
    await upsertBlobUploadChunk({
      stagingId: 'stage-1',
      uploadId: 'upload-1',
      expiresAt: '2099-02-14T11:00:00.000Z',
      chunk: {
        chunkIndex: 1,
        isFinal: true,
        ciphertextBase64: 'Yg==',
        plaintextLength: 1,
        ciphertextLength: 1
      }
    });
    await upsertBlobUploadChunk({
      stagingId: 'stage-1',
      uploadId: 'upload-1',
      expiresAt: '2099-02-14T11:00:00.000Z',
      chunk: {
        chunkIndex: 0,
        isFinal: false,
        ciphertextBase64: 'YQ==',
        plaintextLength: 1,
        ciphertextLength: 1
      }
    });

    const chunks = await getBlobUploadChunks({
      stagingId: 'stage-1',
      uploadId: 'upload-1'
    });

    expect(chunks).toEqual([
      {
        chunkIndex: 0,
        isFinal: false,
        ciphertextBase64: 'YQ==',
        plaintextLength: 1,
        ciphertextLength: 1
      },
      {
        chunkIndex: 1,
        isFinal: true,
        ciphertextBase64: 'Yg==',
        plaintextLength: 1,
        ciphertextLength: 1
      }
    ]);
  });

  it('returns null when upload index contains an invalid chunk index', async () => {
    mockRedisStore.set(
      toUploadIndexKey({ stagingId: 'stage-1', uploadId: 'upload-1' }),
      new Set(['invalid-index'])
    );

    const chunks = await getBlobUploadChunks({
      stagingId: 'stage-1',
      uploadId: 'upload-1'
    });

    expect(chunks).toBeNull();
  });

  it('returns null when chunk payload is malformed or mismatched', async () => {
    const chunkKey = toChunkKey({
      stagingId: 'stage-1',
      uploadId: 'upload-1',
      chunkIndex: 0
    });
    mockRedisStore.set(
      toUploadIndexKey({ stagingId: 'stage-1', uploadId: 'upload-1' }),
      new Set(['0'])
    );
    mockRedisStore.set(chunkKey, '{"bad-json"');

    const malformedChunks = await getBlobUploadChunks({
      stagingId: 'stage-1',
      uploadId: 'upload-1'
    });
    expect(malformedChunks).toBeNull();

    mockRedisStore.set(
      chunkKey,
      JSON.stringify({
        chunkIndex: 1,
        isFinal: true,
        ciphertextBase64: 'YQ==',
        plaintextLength: 1,
        ciphertextLength: 1
      })
    );

    const mismatchedChunks = await getBlobUploadChunks({
      stagingId: 'stage-1',
      uploadId: 'upload-1'
    });
    expect(mismatchedChunks).toBeNull();
  });

  it('deletes a single upload and prunes stage/global indexes', async () => {
    await upsertBlobUploadChunk({
      stagingId: 'stage-1',
      uploadId: 'upload-1',
      expiresAt: '2099-02-14T11:00:00.000Z',
      chunk: {
        chunkIndex: 0,
        isFinal: true,
        ciphertextBase64: 'YQ==',
        plaintextLength: 1,
        ciphertextLength: 1
      }
    });
    await upsertBlobUploadChunk({
      stagingId: 'stage-1',
      uploadId: 'upload-2',
      expiresAt: '2099-02-14T11:00:00.000Z',
      chunk: {
        chunkIndex: 0,
        isFinal: true,
        ciphertextBase64: 'Yg==',
        plaintextLength: 1,
        ciphertextLength: 1
      }
    });

    await deleteBlobUploadSession({
      stagingId: 'stage-1',
      uploadId: 'upload-1'
    });

    const stageUploadsAfterFirstDelete = mockRedisStore.get(
      toStageUploadsKey('stage-1')
    );
    expect(stageUploadsAfterFirstDelete instanceof Set).toBe(true);
    if (!(stageUploadsAfterFirstDelete instanceof Set)) {
      throw new Error('expected stage upload index set');
    }
    expect(Array.from(stageUploadsAfterFirstDelete)).toEqual(['upload-2']);

    await deleteBlobUploadSession({
      stagingId: 'stage-1',
      uploadId: 'upload-2'
    });

    expect(mockRedisStore.has(toStageUploadsKey('stage-1'))).toBe(false);

    const globalStages = mockRedisStore.get(BLOB_UPLOAD_STAGES_KEY);
    if (globalStages instanceof Set) {
      expect(globalStages.has('stage-1')).toBe(false);
    } else {
      expect(globalStages).toBeUndefined();
    }
  });

  it('deletes all sessions for a staging id and clear removes remaining stages', async () => {
    await upsertBlobUploadChunk({
      stagingId: 'stage-1',
      uploadId: 'upload-1',
      expiresAt: '2099-02-14T11:00:00.000Z',
      chunk: {
        chunkIndex: 0,
        isFinal: true,
        ciphertextBase64: 'YQ==',
        plaintextLength: 1,
        ciphertextLength: 1
      }
    });
    await upsertBlobUploadChunk({
      stagingId: 'stage-2',
      uploadId: 'upload-2',
      expiresAt: '2099-02-14T11:00:00.000Z',
      chunk: {
        chunkIndex: 0,
        isFinal: true,
        ciphertextBase64: 'Yg==',
        plaintextLength: 1,
        ciphertextLength: 1
      }
    });

    await deleteBlobUploadSessionsForStaging({ stagingId: 'stage-1' });

    const stageOneChunks = await getBlobUploadChunks({
      stagingId: 'stage-1',
      uploadId: 'upload-1'
    });
    expect(stageOneChunks).toBeNull();

    const stageTwoChunksBeforeClear = await getBlobUploadChunks({
      stagingId: 'stage-2',
      uploadId: 'upload-2'
    });
    expect(stageTwoChunksBeforeClear).not.toBeNull();

    await clearBlobUploadSessions();

    const stageTwoChunksAfterClear = await getBlobUploadChunks({
      stagingId: 'stage-2',
      uploadId: 'upload-2'
    });
    expect(stageTwoChunksAfterClear).toBeNull();
  });

  it('bounds ttl by stage expiry and global index by configured max ttl', async () => {
    setTestEnv('VFS_BLOB_UPLOAD_SESSION_MAX_TTL_SECONDS', '600');

    await upsertBlobUploadChunk({
      stagingId: 'stage-1',
      uploadId: 'upload-1',
      expiresAt: '2000-01-01T00:00:00.000Z',
      chunk: {
        chunkIndex: 0,
        isFinal: true,
        ciphertextBase64: 'YQ==',
        plaintextLength: 1,
        ciphertextLength: 1
      }
    });

    const setCall = mockRedisClient.set.mock.calls.find(
      (call) =>
        String(call[0]) ===
        toChunkKey({
          stagingId: 'stage-1',
          uploadId: 'upload-1',
          chunkIndex: 0
        })
    );
    expect(setCall).toBeDefined();
    if (!setCall) {
      throw new Error('expected chunk set call');
    }
    expect(setCall[2]).toEqual({ EX: 1 });

    const globalExpireCall = mockRedisClient.expire.mock.calls.find(
      (call) => String(call[0]) === BLOB_UPLOAD_STAGES_KEY
    );
    expect(globalExpireCall).toBeDefined();
    if (!globalExpireCall) {
      throw new Error('expected global stage expire call');
    }
    expect(globalExpireCall[1]).toBe(600);
  });
});
