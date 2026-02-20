import type { VfsCryptoEngine } from './engine';
import type {
  EncryptCrdtOpInput,
  EncryptCrdtOpResult,
  QueueEncryptedCrdtOpAndPersistInput,
  UploadEncryptedBlobChunk,
  UploadEncryptedBlobInput,
  UploadEncryptedBlobResult,
  VfsSecureWritePipeline
} from './secureWritePipeline';
import type { VfsWrappedKey } from './types';

const DEFAULT_CHUNK_SIZE_BYTES = 4 * 1024 * 1024;
const CRDT_BLOB_PREFIX = 'crdt-op';

/**
 * Ensures Uint8Array is typed with ArrayBuffer (not ArrayBufferLike).
 * WebCrypto APIs require BufferSource which expects ArrayBuffer, not SharedArrayBuffer.
 */
function asBufferSource(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return data as Uint8Array<ArrayBuffer>;
}

export interface VfsSecureWritePipelineRuntimeOptions {
  engine: VfsCryptoEngine;
  chunkSizeBytes?: number;
  resolveKeyEpoch?: (itemId: string) => Promise<number> | number;
  listWrappedFileKeys?:
    | ((input: {
        itemId: string;
        keyEpoch: number;
      }) => Promise<VfsWrappedKey[]>)
    | ((input: { itemId: string; keyEpoch: number }) => VfsWrappedKey[]);
  createUploadId?: () => string;
}

export function createVfsSecureWritePipeline(
  options: VfsSecureWritePipelineRuntimeOptions
): VfsSecureWritePipeline {
  return new DefaultVfsSecureWritePipeline(options);
}

class DefaultVfsSecureWritePipeline implements VfsSecureWritePipeline {
  private readonly engine: VfsCryptoEngine;
  private readonly chunkSizeBytes: number;
  private readonly resolveKeyEpoch: (itemId: string) => Promise<number>;
  private readonly listWrappedFileKeys: (input: {
    itemId: string;
    keyEpoch: number;
  }) => Promise<VfsWrappedKey[]>;
  private readonly createUploadId: () => string;

  constructor(options: VfsSecureWritePipelineRuntimeOptions) {
    this.engine = options.engine;
    this.chunkSizeBytes = validateChunkSize(options.chunkSizeBytes);
    this.resolveKeyEpoch = async (itemId) => {
      const resolved = await (options.resolveKeyEpoch?.(itemId) ?? 1);
      validateKeyEpoch(resolved);
      return resolved;
    };
    this.listWrappedFileKeys = async ({ itemId, keyEpoch }) => {
      return options.listWrappedFileKeys?.({ itemId, keyEpoch }) ?? [];
    };
    this.createUploadId = options.createUploadId ?? defaultCreateUploadId;
  }

  async uploadEncryptedBlob(
    input: UploadEncryptedBlobInput
  ): Promise<UploadEncryptedBlobResult> {
    const keyEpoch = await this.resolveKeyEpoch(input.itemId);
    const wrappedFileKeys = await this.listWrappedFileKeys({
      itemId: input.itemId,
      keyEpoch
    });

    const chunkHashes: string[] = [];
    const chunks: UploadEncryptedBlobChunk[] = [];
    let totalPlaintextBytes = 0;
    let totalCiphertextBytes = 0;
    let chunkIndex = 0;
    let pendingPlaintextChunk: Uint8Array | null = null;

    for await (const plaintextChunk of splitStreamIntoChunks(
      input.stream,
      this.chunkSizeBytes
    )) {
      if (pendingPlaintextChunk !== null) {
        const encryptedChunk = await this.engine.encryptChunk({
          itemId: input.itemId,
          blobId: input.blobId,
          chunkIndex,
          isFinal: false,
          plaintext: pendingPlaintextChunk,
          keyEpoch,
          contentType: input.contentType
        });
        chunks.push(toUploadEncryptedBlobChunk(encryptedChunk));
        chunkHashes.push(await hashBase64(encryptedChunk.ciphertext));
        totalPlaintextBytes += encryptedChunk.plaintextLength;
        totalCiphertextBytes += encryptedChunk.ciphertextLength;
        chunkIndex += 1;
      }
      pendingPlaintextChunk = plaintextChunk;
    }

    const finalPlaintextChunk = pendingPlaintextChunk ?? new Uint8Array(0);
    const finalEncryptedChunk = await this.engine.encryptChunk({
      itemId: input.itemId,
      blobId: input.blobId,
      chunkIndex,
      isFinal: true,
      plaintext: finalPlaintextChunk,
      keyEpoch,
      contentType: input.contentType
    });
    chunks.push(toUploadEncryptedBlobChunk(finalEncryptedChunk));
    chunkHashes.push(await hashBase64(finalEncryptedChunk.ciphertext));
    totalPlaintextBytes += finalEncryptedChunk.plaintextLength;
    totalCiphertextBytes += finalEncryptedChunk.ciphertextLength;

    const manifestWithoutSignature = {
      itemId: input.itemId,
      blobId: input.blobId,
      keyEpoch,
      contentType: input.contentType,
      totalPlaintextBytes,
      totalCiphertextBytes,
      chunkCount: chunks.length,
      chunkHashes,
      wrappedFileKeys
    };
    const manifestSignature = await this.engine.signManifest(
      manifestWithoutSignature
    );

    return {
      manifest: {
        ...manifestWithoutSignature,
        manifestSignature
      },
      uploadId: this.createUploadId(),
      chunks
    };
  }

  async encryptCrdtOp(input: EncryptCrdtOpInput): Promise<EncryptCrdtOpResult> {
    const keyEpoch = await this.resolveKeyEpoch(input.itemId);
    const plaintext = new TextEncoder().encode(
      JSON.stringify({
        itemId: input.itemId,
        opType: input.opType,
        opPayload: input.opPayload
      })
    );

    const encryptedChunk = await this.engine.encryptChunk({
      itemId: input.itemId,
      blobId: `${CRDT_BLOB_PREFIX}:${input.opType}`,
      chunkIndex: 0,
      isFinal: true,
      plaintext,
      keyEpoch,
      contentType: 'application/json'
    });
    const encryptedOp = toBase64(encryptedChunk.ciphertext);
    const opNonce = encryptedChunk.nonce;
    const opAad = encryptedChunk.aadHash;
    const opSignature = await hashBase64(
      new TextEncoder().encode(
        JSON.stringify({
          itemId: input.itemId,
          opType: input.opType,
          keyEpoch,
          encryptedOp,
          opNonce,
          opAad
        })
      )
    );

    return {
      encryptedOp,
      opNonce,
      opAad,
      keyEpoch,
      opSignature
    };
  }
}

function validateChunkSize(chunkSizeBytes: number | undefined): number {
  const resolved = chunkSizeBytes ?? DEFAULT_CHUNK_SIZE_BYTES;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error('chunkSizeBytes must be a positive integer');
  }

  return resolved;
}

function validateKeyEpoch(value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('keyEpoch must be a positive integer');
  }
}

function toUploadEncryptedBlobChunk(input: {
  chunkIndex: number;
  isFinal: boolean;
  nonce: string;
  aadHash: string;
  ciphertext: Uint8Array;
  plaintextLength: number;
  ciphertextLength: number;
}): UploadEncryptedBlobChunk {
  return {
    chunkIndex: input.chunkIndex,
    isFinal: input.isFinal,
    nonce: input.nonce,
    aadHash: input.aadHash,
    ciphertextBase64: toBase64(input.ciphertext),
    plaintextLength: input.plaintextLength,
    ciphertextLength: input.ciphertextLength
  };
}

async function* splitStreamIntoChunks(
  stream: ReadableStream<Uint8Array>,
  chunkSizeBytes: number
): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  let carry: Uint8Array<ArrayBuffer> = new Uint8Array(0);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.length === 0) {
        continue;
      }

      carry = concatBytes(carry, value);
      while (carry.length >= chunkSizeBytes) {
        yield carry.slice(0, chunkSizeBytes);
        carry = carry.slice(chunkSizeBytes);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (carry.length > 0) {
    yield carry;
  }
}

function concatBytes(
  left: Uint8Array,
  right: Uint8Array
): Uint8Array<ArrayBuffer> {
  if (left.length === 0) {
    return new Uint8Array(right);
  }
  const combined = new Uint8Array(left.length + right.length);
  combined.set(left, 0);
  combined.set(right, left.length);
  return combined;
}

async function hashBase64(input: Uint8Array): Promise<string> {
  const digestBuffer = await crypto.subtle.digest(
    'SHA-256',
    asBufferSource(input)
  );
  return toBase64(new Uint8Array(digestBuffer));
}

function toBase64(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < data.length; index += chunkSize) {
    binary += String.fromCharCode(...data.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function defaultCreateUploadId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const random = crypto.getRandomValues(new Uint8Array(8));
  const suffix = Array.from(random, (value) => value.toString(16)).join('');
  return `upload-${Date.now()}-${suffix}`;
}

export type {
  EncryptCrdtOpInput,
  QueueEncryptedCrdtOpAndPersistInput,
  UploadEncryptedBlobInput
};
