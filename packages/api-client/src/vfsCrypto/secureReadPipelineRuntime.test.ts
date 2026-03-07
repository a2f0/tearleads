import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVfsCryptoEngine } from './engineRuntime';
import { createVfsSecureReadPipeline } from './secureReadPipelineRuntime';
import type { UploadEncryptedBlobChunk } from './secureWritePipeline';
import { createVfsSecureWritePipeline } from './secureWritePipelineRuntime';

const fixedSessionKey = new Uint8Array(32).fill(3);

describe('secureReadPipelineRuntime', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('decrypts encrypted blob chunks produced by secure write pipeline', async () => {
    const engine = createVfsCryptoEngine({
      keyResolver: {
        getItemKey: async ({ itemId, keyEpoch }) => {
          if (itemId !== 'item-1' || keyEpoch !== 1) {
            throw new Error('unexpected key lookup');
          }
          return fixedSessionKey;
        }
      }
    });

    const writer = createVfsSecureWritePipeline({
      engine,
      chunkSizeBytes: 4,
      resolveKeyEpoch: async () => 1,
      listWrappedFileKeys: async () => []
    });

    const reader = createVfsSecureReadPipeline({ engine });

    const plaintext = new TextEncoder().encode('read pipeline roundtrip data');

    const chunks: UploadEncryptedBlobChunk[] = [];
    const uploadResult = await writer.uploadEncryptedBlob({
      itemId: 'item-1',
      blobId: 'blob-1',
      contentType: 'text/plain',
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(plaintext);
          controller.close();
        }
      }),
      onChunk: async (chunk) => {
        chunks.push(chunk);
      }
    });
    const decrypted = await reader.decryptEncryptedBlob({
      manifest: uploadResult.manifest,
      chunks
    });

    expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
  });

  it('fails closed when manifest signature verification fails', async () => {
    const engine = createVfsCryptoEngine({
      keyResolver: {
        getItemKey: async () => fixedSessionKey
      }
    });

    const writer = createVfsSecureWritePipeline({
      engine,
      resolveKeyEpoch: async () => 1,
      listWrappedFileKeys: async () => []
    });

    const reader = createVfsSecureReadPipeline({ engine });

    const chunks: UploadEncryptedBlobChunk[] = [];
    const uploadResult = await writer.uploadEncryptedBlob({
      itemId: 'item-1',
      blobId: 'blob-1',
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('tamper me'));
          controller.close();
        }
      }),
      onChunk: async (chunk) => {
        chunks.push(chunk);
      }
    });

    const tamperedManifest = {
      ...uploadResult.manifest,
      totalCiphertextBytes: uploadResult.manifest.totalCiphertextBytes + 1
    };

    await expect(
      reader.decryptEncryptedBlob({
        manifest: tamperedManifest,
        chunks
      })
    ).rejects.toThrow('Encrypted manifest signature verification failed');
  });

  it('fails closed when chunk hash does not match manifest', async () => {
    const engine = createVfsCryptoEngine({
      keyResolver: {
        getItemKey: async () => fixedSessionKey
      }
    });

    const writer = createVfsSecureWritePipeline({
      engine,
      resolveKeyEpoch: async () => 1,
      listWrappedFileKeys: async () => []
    });

    const reader = createVfsSecureReadPipeline({ engine });

    const chunks: UploadEncryptedBlobChunk[] = [];
    const uploadResult = await writer.uploadEncryptedBlob({
      itemId: 'item-1',
      blobId: 'blob-1',
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('chunk hash check'));
          controller.close();
        }
      }),
      onChunk: async (chunk) => {
        chunks.push(chunk);
      }
    });
    const firstChunk = chunks[0];
    if (!firstChunk) {
      throw new Error('expected at least one chunk');
    }

    const tamperedChunks = chunks.map((chunk, index) => {
      if (index !== 0) {
        return chunk;
      }
      return {
        ...chunk,
        ciphertextBase64: 'AA=='
      };
    });

    await expect(
      reader.decryptEncryptedBlob({
        manifest: uploadResult.manifest,
        chunks: tamperedChunks
      })
    ).rejects.toThrow(
      'Encrypted chunk ciphertextLength does not match ciphertext'
    );
  });

  it('fails closed when chunk finality is invalid for manifest order', async () => {
    const engine = createVfsCryptoEngine({
      keyResolver: {
        getItemKey: async () => fixedSessionKey
      }
    });

    const writer = createVfsSecureWritePipeline({
      engine,
      chunkSizeBytes: 5,
      resolveKeyEpoch: async () => 1,
      listWrappedFileKeys: async () => []
    });

    const reader = createVfsSecureReadPipeline({ engine });

    const chunks: UploadEncryptedBlobChunk[] = [];
    const uploadResult = await writer.uploadEncryptedBlob({
      itemId: 'item-1',
      blobId: 'blob-1',
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('finality-check-data'));
          controller.close();
        }
      }),
      onChunk: async (chunk) => {
        chunks.push(chunk);
      }
    });
    if (chunks.length < 2) {
      throw new Error('expected at least two chunks');
    }

    const tamperedChunks = chunks.map((chunk, index) => {
      if (index === chunks.length - 1) {
        return {
          ...chunk,
          isFinal: false
        };
      }
      return chunk;
    });

    await expect(
      reader.decryptEncryptedBlob({
        manifest: uploadResult.manifest,
        chunks: tamperedChunks
      })
    ).rejects.toThrow(
      'Encrypted chunk finality does not match manifest ordering'
    );
  });
});
