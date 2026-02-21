import { describe, expect, it, vi } from 'vitest';
import type { VfsCryptoEngine } from './engine';
import { createVfsSecureWritePipeline } from './secureWritePipelineRuntime';

describe('secureWritePipelineRuntime streaming', () => {
  it('calls onChunk callback for each encrypted chunk when provided', async () => {
    const encryptChunk = vi.fn(
      async ({
        chunkIndex,
        isFinal,
        plaintext
      }: {
        chunkIndex: number;
        isFinal: boolean;
        plaintext: Uint8Array;
      }) => {
        const ciphertext = new Uint8Array(plaintext.length + 2);
        ciphertext.set([chunkIndex, isFinal ? 1 : 0], 0);
        ciphertext.set(plaintext, 2);
        return {
          chunkIndex,
          isFinal,
          nonce: `nonce-${chunkIndex}`,
          aadHash: `aad-${chunkIndex}`,
          ciphertext,
          plaintextLength: plaintext.length,
          ciphertextLength: ciphertext.length
        };
      }
    );

    const pipeline = createVfsSecureWritePipeline({
      engine: {
        encryptChunk,
        decryptChunk: vi.fn(),
        signManifest: vi.fn(async () => 'sig'),
        verifyManifest: vi.fn()
      } satisfies VfsCryptoEngine,
      chunkSizeBytes: 4
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        controller.enqueue(new Uint8Array([5, 6, 7, 8]));
        controller.enqueue(new Uint8Array([9]));
        controller.close();
      }
    });

    const receivedChunks: Array<{
      chunkIndex: number;
      isFinal: boolean;
      ciphertextBase64: string;
    }> = [];

    const onChunk = vi.fn(async (chunk) => {
      receivedChunks.push({
        chunkIndex: chunk.chunkIndex,
        isFinal: chunk.isFinal,
        ciphertextBase64: chunk.ciphertextBase64
      });
    });

    const result = await pipeline.uploadEncryptedBlob({
      itemId: 'item-streamed',
      blobId: 'blob-streamed',
      stream,
      onChunk
    });

    expect(onChunk).toHaveBeenCalledTimes(3);
    expect(receivedChunks).toHaveLength(3);
    expect(receivedChunks[0]).toMatchObject({
      chunkIndex: 0,
      isFinal: false
    });
    expect(receivedChunks[1]).toMatchObject({
      chunkIndex: 1,
      isFinal: false
    });
    expect(receivedChunks[2]).toMatchObject({
      chunkIndex: 2,
      isFinal: true
    });

    expect(result.chunks).toBeUndefined();
    expect(result.manifest.chunkCount).toBe(3);
  });

  it('does not accumulate chunks when onChunk callback is provided', async () => {
    const encryptChunk = vi.fn(
      async ({
        chunkIndex,
        isFinal,
        plaintext
      }: {
        chunkIndex: number;
        isFinal: boolean;
        plaintext: Uint8Array;
      }) => ({
        chunkIndex,
        isFinal,
        nonce: 'nonce',
        aadHash: 'aad',
        ciphertext: new Uint8Array(plaintext.length + 16),
        plaintextLength: plaintext.length,
        ciphertextLength: plaintext.length + 16
      })
    );

    const pipeline = createVfsSecureWritePipeline({
      engine: {
        encryptChunk,
        decryptChunk: vi.fn(),
        signManifest: vi.fn(async () => 'sig'),
        verifyManifest: vi.fn()
      } satisfies VfsCryptoEngine,
      chunkSizeBytes: 1024
    });

    const largeData = new Uint8Array(10 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(largeData);
        controller.close();
      }
    });

    const onChunk = vi.fn(async () => {});

    const result = await pipeline.uploadEncryptedBlob({
      itemId: 'item-large',
      blobId: 'blob-large',
      stream,
      onChunk
    });

    expect(onChunk).toHaveBeenCalledTimes(10);
    expect(result.chunks).toBeUndefined();
    expect(result.manifest.chunkCount).toBe(10);
    expect(result.manifest.totalPlaintextBytes).toBe(10 * 1024);
  });
});
