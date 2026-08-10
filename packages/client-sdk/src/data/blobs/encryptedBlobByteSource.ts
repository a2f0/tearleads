import {
  assertReadRange,
  type BlobByteSource,
  type BlobBytes,
  readExactBlobBytes,
} from "../blobContracts";
import {
  AES_GCM_TAG_BYTES,
  chunkAdditionalData,
  deriveChunkIv,
  ENCRYPTED_BLOB_CHUNK_SIZE,
  type EncryptedBlobEnvelope,
  getChunkPlaintextByteLength,
  type ParsedEncryptedBlobEnvelope,
} from "./encryptedBlobEnvelope";

interface BlobEncryptionContext {
  readonly headerBytes: BlobBytes;
  readonly iv: BlobBytes;
  readonly key: CryptoKey;
  readonly namespace: string;
  readonly storageKey: string;
}

interface CreateEncryptedBlobByteSourceInput extends BlobEncryptionContext {
  readonly envelope: EncryptedBlobEnvelope;
  readonly plaintextSource: BlobByteSource;
  readonly prefixBytes: BlobBytes;
}

interface CreateDecryptedBlobByteSourceInput extends BlobEncryptionContext {
  readonly encryptedSource: BlobByteSource;
  readonly parsed: ParsedEncryptedBlobEnvelope;
}

function ciphertextOffset(
  prefixByteLength: number,
  chunkIndex: number,
): number {
  return (
    prefixByteLength +
    chunkIndex * (ENCRYPTED_BLOB_CHUNK_SIZE + AES_GCM_TAG_BYTES)
  );
}

function chunkCiphertextByteLength(
  plaintextByteLength: number,
  chunkIndex: number,
): number {
  return (
    getChunkPlaintextByteLength(plaintextByteLength, chunkIndex) +
    AES_GCM_TAG_BYTES
  );
}

function encryptionAlgorithm(
  context: BlobEncryptionContext,
  chunkIndex: number,
): AesGcmParams {
  return {
    name: "AES-GCM",
    iv: deriveChunkIv(context.iv, chunkIndex),
    additionalData: chunkAdditionalData({
      chunkIndex,
      headerBytes: context.headerBytes,
      namespace: context.namespace,
      storageKey: context.storageKey,
    }),
  };
}

async function encryptChunk(
  input: CreateEncryptedBlobByteSourceInput,
  chunkIndex: number,
): Promise<BlobBytes> {
  const plaintextByteLength = getChunkPlaintextByteLength(
    input.envelope.plaintextByteLength,
    chunkIndex,
  );
  const plaintext = await readExactBlobBytes(
    input.plaintextSource,
    chunkIndex * ENCRYPTED_BLOB_CHUNK_SIZE,
    plaintextByteLength,
  );
  return new Uint8Array(
    await crypto.subtle.encrypt(
      encryptionAlgorithm(input, chunkIndex),
      input.key,
      plaintext,
    ),
  );
}

async function decryptChunk(
  input: CreateDecryptedBlobByteSourceInput,
  chunkIndex: number,
): Promise<BlobBytes> {
  const { envelope, prefixByteLength } = input.parsed;
  const ciphertext = await readExactBlobBytes(
    input.encryptedSource,
    ciphertextOffset(prefixByteLength, chunkIndex),
    chunkCiphertextByteLength(envelope.plaintextByteLength, chunkIndex),
  );
  try {
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        encryptionAlgorithm(input, chunkIndex),
        input.key,
        ciphertext,
      ),
    );
    const expectedByteLength = getChunkPlaintextByteLength(
      envelope.plaintextByteLength,
      chunkIndex,
    );
    if (plaintext.byteLength !== expectedByteLength) {
      throw new Error("Unexpected plaintext length.");
    }
    return plaintext;
  } catch {
    throw new Error("Encrypted blob store payload could not be decrypted.");
  }
}

function copyIntersection(input: {
  chunk: BlobBytes;
  chunkOffset: number;
  output: BlobBytes;
  readByteLength: number;
  readOffset: number;
}): void {
  const intersectionStart = Math.max(input.readOffset, input.chunkOffset);
  const intersectionEnd = Math.min(
    input.readOffset + input.readByteLength,
    input.chunkOffset + input.chunk.byteLength,
  );
  if (intersectionStart >= intersectionEnd) {
    return;
  }
  input.output.set(
    input.chunk.subarray(
      intersectionStart - input.chunkOffset,
      intersectionEnd - input.chunkOffset,
    ),
    intersectionStart - input.readOffset,
  );
}

async function readEncryptedRange(
  input: CreateEncryptedBlobByteSourceInput,
  offset: number,
  byteLength: number,
  getEncryptedChunk: (chunkIndex: number) => Promise<BlobBytes>,
): Promise<BlobBytes> {
  const output = new Uint8Array(byteLength);
  copyIntersection({
    chunk: input.prefixBytes,
    chunkOffset: 0,
    output,
    readByteLength: byteLength,
    readOffset: offset,
  });

  const encryptedStart = Math.max(offset, input.prefixBytes.byteLength);
  const encryptedEnd = offset + byteLength;
  if (encryptedStart >= encryptedEnd) {
    return output;
  }
  const relativeStart = encryptedStart - input.prefixBytes.byteLength;
  const firstChunk = Math.floor(
    relativeStart / (ENCRYPTED_BLOB_CHUNK_SIZE + AES_GCM_TAG_BYTES),
  );
  const relativeEnd = encryptedEnd - input.prefixBytes.byteLength;
  const lastChunk = Math.min(
    input.envelope.chunkCount - 1,
    Math.floor(
      Math.max(0, relativeEnd - 1) /
        (ENCRYPTED_BLOB_CHUNK_SIZE + AES_GCM_TAG_BYTES),
    ),
  );

  for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex += 1) {
    const ciphertext = await getEncryptedChunk(chunkIndex);
    copyIntersection({
      chunk: ciphertext,
      chunkOffset: ciphertextOffset(input.prefixBytes.byteLength, chunkIndex),
      output,
      readByteLength: byteLength,
      readOffset: offset,
    });
  }
  return output;
}

async function readDecryptedRange(
  input: CreateDecryptedBlobByteSourceInput,
  offset: number,
  byteLength: number,
): Promise<BlobBytes> {
  const output = new Uint8Array(byteLength);
  if (byteLength === 0) {
    if (input.parsed.envelope.plaintextByteLength === 0) {
      await decryptChunk(input, 0);
    }
    return output;
  }
  const firstChunk = Math.floor(offset / ENCRYPTED_BLOB_CHUNK_SIZE);
  const lastChunk = Math.floor(
    (offset + byteLength - 1) / ENCRYPTED_BLOB_CHUNK_SIZE,
  );
  for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex += 1) {
    const plaintext = await decryptChunk(input, chunkIndex);
    copyIntersection({
      chunk: plaintext,
      chunkOffset: chunkIndex * ENCRYPTED_BLOB_CHUNK_SIZE,
      output,
      readByteLength: byteLength,
      readOffset: offset,
    });
  }
  return output;
}

export function createEncryptedBlobByteSource(
  input: CreateEncryptedBlobByteSourceInput,
): BlobByteSource {
  let cachedChunkIndex = -1;
  let cachedChunkPromise: Promise<BlobBytes> | null = null;

  function getEncryptedChunk(chunkIndex: number): Promise<BlobBytes> {
    if (chunkIndex !== cachedChunkIndex || !cachedChunkPromise) {
      cachedChunkIndex = chunkIndex;
      cachedChunkPromise = encryptChunk(input, chunkIndex);
    }
    return cachedChunkPromise;
  }

  return {
    byteLength:
      input.prefixBytes.byteLength +
      input.envelope.plaintextByteLength +
      input.envelope.chunkCount * AES_GCM_TAG_BYTES,
    async read(offset, byteLength) {
      assertReadRange(this.byteLength, offset, byteLength);
      return readEncryptedRange(input, offset, byteLength, getEncryptedChunk);
    },
  };
}

export function createDecryptedBlobByteSource(
  input: CreateDecryptedBlobByteSourceInput,
): BlobByteSource {
  return {
    byteLength: input.parsed.envelope.plaintextByteLength,
    async read(offset, byteLength) {
      assertReadRange(this.byteLength, offset, byteLength);
      return readDecryptedRange(input, offset, byteLength);
    },
  };
}
