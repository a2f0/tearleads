import type { VfsCryptoEngine } from './engine';
import type {
  DownloadEncryptedBlobInput,
  VfsSecureReadPipeline
} from './secureReadPipeline';
import type { UploadEncryptedBlobChunk } from './secureWritePipeline';
import type { EncryptedChunk } from './types';

export interface VfsSecureReadPipelineRuntimeOptions {
  engine: VfsCryptoEngine;
}

export function createVfsSecureReadPipeline(
  options: VfsSecureReadPipelineRuntimeOptions
): VfsSecureReadPipeline {
  return new DefaultVfsSecureReadPipeline(options);
}

class DefaultVfsSecureReadPipeline implements VfsSecureReadPipeline {
  private readonly engine: VfsCryptoEngine;

  constructor(options: VfsSecureReadPipelineRuntimeOptions) {
    this.engine = options.engine;
  }

  async decryptEncryptedBlob(
    input: DownloadEncryptedBlobInput
  ): Promise<Uint8Array> {
    const manifestValid = await this.engine.verifyManifest(input.manifest);
    if (!manifestValid) {
      throw new Error('Encrypted manifest signature verification failed');
    }

    const orderedChunks = await normalizeAndValidateChunks(
      input.chunks,
      input.manifest
    );

    const plaintextChunks: Uint8Array[] = [];

    for (const chunk of orderedChunks) {
      const plaintext = await this.engine.decryptChunk({
        itemId: input.manifest.itemId,
        blobId: input.manifest.blobId,
        chunk: {
          chunkIndex: chunk.chunkIndex,
          isFinal: chunk.isFinal,
          nonce: chunk.nonce,
          aadHash: chunk.aadHash,
          ciphertext: chunk.ciphertext,
          plaintextLength: chunk.plaintextLength,
          ciphertextLength: chunk.ciphertextLength
        },
        keyEpoch: input.manifest.keyEpoch,
        contentType: input.manifest.contentType
      });

      if (plaintext.length !== chunk.plaintextLength) {
        throw new Error('Decrypted chunk length does not match manifest metadata');
      }

      plaintextChunks.push(plaintext);
    }

    const plaintext = concatChunks(plaintextChunks);
    if (plaintext.length !== input.manifest.totalPlaintextBytes) {
      throw new Error('Decrypted plaintext total does not match manifest metadata');
    }

    return plaintext;
  }
}

interface NormalizedChunk extends UploadEncryptedBlobChunk {
  ciphertext: Uint8Array;
}

async function normalizeAndValidateChunks(
  chunks: UploadEncryptedBlobChunk[],
  manifest: DownloadEncryptedBlobInput['manifest']
): Promise<NormalizedChunk[]> {
  if (chunks.length !== manifest.chunkCount) {
    throw new Error('Encrypted chunks do not match manifest chunkCount');
  }

  const byIndex: Array<NormalizedChunk | null> = Array.from(
    { length: manifest.chunkCount },
    () => null
  );

  let totalPlaintextBytes = 0;
  let totalCiphertextBytes = 0;

  for (const chunk of chunks) {
    validateChunkShape(chunk, manifest.chunkCount);

    if (byIndex[chunk.chunkIndex] !== null) {
      throw new Error('Encrypted chunks contain duplicate chunkIndex values');
    }

    const ciphertext = fromBase64(chunk.ciphertextBase64);
    if (ciphertext.length !== chunk.ciphertextLength) {
      throw new Error('Encrypted chunk ciphertextLength does not match ciphertext');
    }

    const hash = await hashBase64(ciphertext);
    const expectedHash = manifest.chunkHashes[chunk.chunkIndex];
    if (hash !== expectedHash) {
      throw new Error('Encrypted chunk hash does not match manifest');
    }

    totalPlaintextBytes += chunk.plaintextLength;
    totalCiphertextBytes += chunk.ciphertextLength;

    byIndex[chunk.chunkIndex] = {
      ...chunk,
      ciphertext
    };
  }

  if (totalPlaintextBytes !== manifest.totalPlaintextBytes) {
    throw new Error('Encrypted chunk plaintext total does not match manifest');
  }
  if (totalCiphertextBytes !== manifest.totalCiphertextBytes) {
    throw new Error('Encrypted chunk ciphertext total does not match manifest');
  }

  const ordered: NormalizedChunk[] = [];
  for (let index = 0; index < byIndex.length; index += 1) {
    const chunk = byIndex[index];
    if (!chunk) {
      throw new Error('Encrypted chunks are not contiguous from chunkIndex 0');
    }

    const shouldBeFinal = index === byIndex.length - 1;
    if (chunk.isFinal !== shouldBeFinal) {
      throw new Error('Encrypted chunk finality does not match manifest ordering');
    }

    ordered.push(chunk);
  }

  return ordered;
}

function validateChunkShape(
  chunk: UploadEncryptedBlobChunk,
  chunkCount: number
): void {
  if (!Number.isInteger(chunk.chunkIndex)) {
    throw new Error('Encrypted chunk chunkIndex must be an integer');
  }
  if (chunk.chunkIndex < 0 || chunk.chunkIndex >= chunkCount) {
    throw new Error('Encrypted chunk chunkIndex is out of manifest bounds');
  }
  if (!Number.isInteger(chunk.plaintextLength) || chunk.plaintextLength < 0) {
    throw new Error('Encrypted chunk plaintextLength must be a non-negative integer');
  }
  if (
    !Number.isInteger(chunk.ciphertextLength) ||
    chunk.ciphertextLength < 0
  ) {
    throw new Error('Encrypted chunk ciphertextLength must be a non-negative integer');
  }
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);

  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

async function hashBase64(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toBase64(new Uint8Array(digest));
}

function toBase64(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < data.length; index += chunkSize) {
    binary += String.fromCharCode(...data.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export type { DownloadEncryptedBlobInput };
export type { EncryptedChunk };
