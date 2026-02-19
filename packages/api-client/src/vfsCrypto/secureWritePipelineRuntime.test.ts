import { describe, expect, it, vi } from 'vitest';
import type { VfsCryptoEngine } from './engine';
import { createVfsSecureWritePipeline } from './secureWritePipelineRuntime';

describe('secureWritePipelineRuntime', () => {
  it('streams blob input into encrypted chunks and builds manifest', async () => {
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
    const signManifest = vi.fn(async () => 'manifest-signature');

    const pipeline = createVfsSecureWritePipeline({
      engine: {
        encryptChunk,
        decryptChunk: vi.fn(),
        signManifest,
        verifyManifest: vi.fn()
      } satisfies VfsCryptoEngine,
      chunkSizeBytes: 4,
      resolveKeyEpoch: async () => 12,
      listWrappedFileKeys: async () => [
        {
          recipientUserId: 'user-1',
          recipientPublicKeyId: 'pk-1',
          keyEpoch: 12,
          encryptedKey: 'wrapped-key',
          senderSignature: 'sig-1'
        }
      ],
      createUploadId: () => 'upload-fixed'
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.enqueue(new Uint8Array([7, 8, 9]));
        controller.close();
      }
    });

    const result = await pipeline.uploadEncryptedBlob({
      itemId: 'item-1',
      blobId: 'blob-1',
      contentType: 'application/octet-stream',
      stream
    });

    expect(encryptChunk).toHaveBeenCalledTimes(3);
    expect(encryptChunk).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        chunkIndex: 0,
        isFinal: false,
        plaintext: new Uint8Array([1, 2, 3, 4]),
        keyEpoch: 12
      })
    );
    expect(encryptChunk).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        chunkIndex: 1,
        isFinal: false,
        plaintext: new Uint8Array([5, 6, 7, 8]),
        keyEpoch: 12
      })
    );
    expect(encryptChunk).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        chunkIndex: 2,
        isFinal: true,
        plaintext: new Uint8Array([9]),
        keyEpoch: 12
      })
    );

    expect(signManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'item-1',
        blobId: 'blob-1',
        keyEpoch: 12,
        chunkCount: 3,
        totalPlaintextBytes: 9,
        totalCiphertextBytes: 15
      })
    );

    expect(result.uploadId).toBe('upload-fixed');
    expect(result.manifest).toEqual(
      expect.objectContaining({
        keyEpoch: 12,
        chunkCount: 3,
        totalPlaintextBytes: 9,
        totalCiphertextBytes: 15,
        manifestSignature: 'manifest-signature'
      })
    );
    expect(result.manifest.chunkHashes).toHaveLength(3);
    expect(result.manifest.wrappedFileKeys).toHaveLength(1);
    expect(result.chunks).toEqual([
      expect.objectContaining({ chunkIndex: 0, isFinal: false }),
      expect.objectContaining({ chunkIndex: 1, isFinal: false }),
      expect.objectContaining({ chunkIndex: 2, isFinal: true })
    ]);
  });

  it('emits a final empty chunk for empty streams', async () => {
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
        return {
          chunkIndex,
          isFinal,
          nonce: 'nonce-0',
          aadHash: 'aad-0',
          ciphertext: plaintext,
          plaintextLength: plaintext.length,
          ciphertextLength: plaintext.length
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
      chunkSizeBytes: 8
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      }
    });

    const result = await pipeline.uploadEncryptedBlob({
      itemId: 'item-empty',
      blobId: 'blob-empty',
      stream
    });

    expect(encryptChunk).toHaveBeenCalledTimes(1);
    expect(encryptChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkIndex: 0,
        isFinal: true,
        plaintext: new Uint8Array(0)
      })
    );
    expect(result.manifest.chunkCount).toBe(1);
    expect(result.manifest.totalPlaintextBytes).toBe(0);
    expect(result.chunks).toHaveLength(1);
  });

  it('encrypts CRDT payloads through engine chunk encryption', async () => {
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
        const ciphertext = plaintext.slice().reverse();
        return {
          chunkIndex,
          isFinal,
          nonce: 'crdt-nonce',
          aadHash: 'crdt-aad',
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
        signManifest: vi.fn(async () => 'unused'),
        verifyManifest: vi.fn()
      } satisfies VfsCryptoEngine,
      resolveKeyEpoch: () => 21
    });

    const result = await pipeline.encryptCrdtOp({
      itemId: 'item-5',
      opType: 'set_data',
      opPayload: { value: 'hello' }
    });

    expect(encryptChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'item-5',
        blobId: 'crdt-op:set_data',
        chunkIndex: 0,
        isFinal: true,
        keyEpoch: 21,
        contentType: 'application/json'
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        opNonce: 'crdt-nonce',
        opAad: 'crdt-aad',
        keyEpoch: 21
      })
    );
    expect(result.encryptedOp.length).toBeGreaterThan(0);
    expect(result.opSignature.length).toBeGreaterThan(0);
  });

  it('throws error for invalid chunkSizeBytes', () => {
    expect(() =>
      createVfsSecureWritePipeline({
        engine: {
          encryptChunk: vi.fn(),
          decryptChunk: vi.fn(),
          signManifest: vi.fn(),
          verifyManifest: vi.fn()
        },
        chunkSizeBytes: 0
      })
    ).toThrow('chunkSizeBytes must be a positive integer');

    expect(() =>
      createVfsSecureWritePipeline({
        engine: {
          encryptChunk: vi.fn(),
          decryptChunk: vi.fn(),
          signManifest: vi.fn(),
          verifyManifest: vi.fn()
        },
        chunkSizeBytes: -1
      })
    ).toThrow('chunkSizeBytes must be a positive integer');

    expect(() =>
      createVfsSecureWritePipeline({
        engine: {
          encryptChunk: vi.fn(),
          decryptChunk: vi.fn(),
          signManifest: vi.fn(),
          verifyManifest: vi.fn()
        },
        chunkSizeBytes: 1.5
      })
    ).toThrow('chunkSizeBytes must be a positive integer');
  });

  it('throws error for invalid keyEpoch from resolver', async () => {
    const pipeline = createVfsSecureWritePipeline({
      engine: {
        encryptChunk: vi.fn(),
        decryptChunk: vi.fn(),
        signManifest: vi.fn(),
        verifyManifest: vi.fn()
      },
      resolveKeyEpoch: () => 0
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      }
    });

    await expect(
      pipeline.uploadEncryptedBlob({
        itemId: 'item-1',
        blobId: 'blob-1',
        stream
      })
    ).rejects.toThrow('keyEpoch must be a positive integer');
  });

  it('generates unique uploadId when createUploadId not provided', async () => {
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
        ciphertext: plaintext,
        plaintextLength: plaintext.length,
        ciphertextLength: plaintext.length
      })
    );

    const pipeline = createVfsSecureWritePipeline({
      engine: {
        encryptChunk,
        decryptChunk: vi.fn(),
        signManifest: vi.fn(async () => 'sig'),
        verifyManifest: vi.fn()
      }
    });

    const stream1 = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      }
    });
    const stream2 = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      }
    });

    const result1 = await pipeline.uploadEncryptedBlob({
      itemId: 'item-1',
      blobId: 'blob-1',
      stream: stream1
    });
    const result2 = await pipeline.uploadEncryptedBlob({
      itemId: 'item-2',
      blobId: 'blob-2',
      stream: stream2
    });

    expect(result1.uploadId).toBeTruthy();
    expect(result2.uploadId).toBeTruthy();
    expect(result1.uploadId).not.toBe(result2.uploadId);
  });
});
