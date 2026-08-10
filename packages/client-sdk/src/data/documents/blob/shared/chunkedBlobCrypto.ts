import {
  AES_256_KEY_BYTES,
  AES_GCM_TAG_BYTES,
  assertAesGcmIv,
  bytesToHex,
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  createAesGcmIv,
  createIncrementalSha256,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { BlobContentKeyBundleRequest } from "@tearleads/validators/request";
import type { BlobByteSource, BlobBytes } from "../../../blobContracts";
import { importContentKeyMaterial } from "../../shared/contentRecordKeys";
import {
  BLOB_CHUNK_SIZE_BYTES,
  blobChunkPlaintextByteLength,
  computeBlobChunkCount,
  computeBlobEncryptedByteLength,
  deriveBlobChunkIv,
  encodeBlobEnvelopeV2Header,
  joinBlobPartBytes,
  normalizeBlobChunkSize,
} from "./blobEnvelopeV2";
import {
  blobContentMetadataHash,
  contentRecordAdditionalDataBytes,
  deriveBlobBaseIv,
  deriveBlobContentRecordKey,
} from "./blobRecordCrypto";
import {
  type BlobSourceSnapshot,
  inspectBlobSource,
  readVerifiedBlobSourceChunk,
} from "./blobSourceSnapshot";
import type { BlobEncryptionPlan } from "./types";
import {
  BLOB_ENCRYPTED_BYTES_FORMAT,
  BLOB_ENCRYPTED_BYTES_VERSION,
} from "./types";

export const DEFAULT_BLOB_CHUNK_SIZE_BYTES = BLOB_CHUNK_SIZE_BYTES;

interface PrepareBlobEncryptionInput {
  readonly blobId: string;
  readonly chunkSize?: number | undefined;
  readonly contentKey: Uint8Array;
  readonly contentKeyBundle: BlobContentKeyBundleRequest;
  readonly nonceSeed?: Uint8Array | undefined;
  readonly organizationId: string;
  readonly source: BlobByteSource;
  readonly sourceSnapshot?: BlobSourceSnapshot | undefined;
}

function assertPartIndex(index: number, partCount: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= partCount) {
    throw new Error("Blob encryption part index is out of range");
  }
}

interface BlobEncryptionContext {
  readonly baseIv: BlobBytes;
  readonly blobId: string;
  readonly chunkSize: number;
  readonly contentKeyEpoch: number;
  readonly contentRecordId: string;
  readonly headerBytes: BlobBytes;
  readonly metadataHash: string;
  readonly nonceDomainHash: string;
  readonly organizationId: string;
  readonly partCount: number;
  readonly plaintextByteLength: number;
  readonly recordKey: CryptoKey;
}

async function createBlobEncryptionContext(
  input: PrepareBlobEncryptionInput,
  snapshot: BlobSourceSnapshot,
): Promise<BlobEncryptionContext> {
  const chunkSize = normalizeBlobChunkSize(
    input.chunkSize ?? DEFAULT_BLOB_CHUNK_SIZE_BYTES,
  );
  const plaintextByteLength = input.source.byteLength;
  const partCount = computeBlobChunkCount(plaintextByteLength, chunkSize);
  const contentRecordId = input.blobId;
  const { contentKeyEpoch } = input.contentKeyBundle;
  const nonceSeed = new Uint8Array(input.nonceSeed ?? createAesGcmIv());
  const baseIv = await deriveBlobBaseIv({
    chunkSize,
    nonceSeed,
    plaintextSha256: snapshot.sha256,
  });

  const [nonceDomainHash, metadataHash] = await Promise.all([
    computeContentRecordNonceDomainHash({
      version: 1,
      organizationId: input.organizationId,
      objectKind: "blob",
      objectId: input.blobId,
      contentKeyEpoch,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
      contentRecordId,
    }),
    blobContentMetadataHash({
      blobId: input.blobId,
      byteLength: plaintextByteLength,
      chunkCount: partCount,
      chunkSize,
      contentKeyEpoch,
    }),
  ]);
  const contentKeyMaterial = await importContentKeyMaterial(input.contentKey);
  const recordKey = await deriveBlobContentRecordKey({
    blobId: input.blobId,
    contentKeyEpoch,
    contentKeyMaterial,
    contentRecordId,
    organizationId: input.organizationId,
    usage: "encrypt",
  });
  return {
    baseIv,
    blobId: input.blobId,
    chunkSize,
    contentKeyEpoch,
    contentRecordId,
    headerBytes: encodeBlobEnvelopeV2Header({
      blobId: input.blobId,
      byteLength: plaintextByteLength,
      chunkCount: partCount,
      chunkSize,
      contentKeyEpoch,
      contentRecordId,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
      format: BLOB_ENCRYPTED_BYTES_FORMAT,
      iv: bytesToBase64(baseIv),
      metadataHash,
      nonceDomainHash,
      version: BLOB_ENCRYPTED_BYTES_VERSION,
    }),
    metadataHash,
    nonceDomainHash,
    organizationId: input.organizationId,
    partCount,
    plaintextByteLength,
    recordKey,
  };
}

async function encryptBlobChunk(
  context: BlobEncryptionContext,
  chunkIndex: number,
  plaintext: BlobBytes,
): Promise<BlobBytes> {
  return new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: deriveBlobChunkIv(context.baseIv, chunkIndex),
        additionalData: contentRecordAdditionalDataBytes({
          blobId: context.blobId,
          chunkCount: context.partCount,
          chunkIndex,
          chunkPlaintextByteLength: plaintext.byteLength,
          chunkSize: context.chunkSize,
          contentKeyEpoch: context.contentKeyEpoch,
          contentRecordId: context.contentRecordId,
          metadataHash: context.metadataHash,
          nonceDomainHash: context.nonceDomainHash,
          organizationId: context.organizationId,
          plaintextByteLength: context.plaintextByteLength,
        }),
      },
      context.recordKey,
      plaintext,
    ),
  );
}

async function runEncryptionHashPass(
  source: BlobByteSource,
  snapshot: BlobSourceSnapshot,
  context: BlobEncryptionContext,
): Promise<string> {
  const objectHash = createIncrementalSha256();
  objectHash.update(context.headerBytes);
  for (let chunkIndex = 0; chunkIndex < context.partCount; chunkIndex += 1) {
    const plaintext = await readVerifiedBlobSourceChunk({
      chunkIndex,
      snapshot,
      source,
    });
    objectHash.update(await encryptBlobChunk(context, chunkIndex, plaintext));
  }
  return bytesToHex(objectHash.digest());
}

function planPartByteLength(
  context: BlobEncryptionContext,
  index: number,
): number {
  assertPartIndex(index, context.partCount);
  const plaintextLength = blobChunkPlaintextByteLength({
    chunkCount: context.partCount,
    chunkIndex: index,
    chunkSize: context.chunkSize,
    plaintextByteLength: context.plaintextByteLength,
  });
  return (
    plaintextLength +
    AES_GCM_TAG_BYTES +
    (index === 0 ? context.headerBytes.byteLength : 0)
  );
}

function createBlobEncryptionPlan(input: {
  readonly context: BlobEncryptionContext;
  readonly sha256: string;
  readonly snapshot: BlobSourceSnapshot;
  readonly source: BlobByteSource;
}): BlobEncryptionPlan {
  const { context, sha256, snapshot, source } = input;
  return {
    byteLength: computeBlobEncryptedByteLength({
      chunkCount: context.partCount,
      headerByteLength: context.headerBytes.byteLength,
      plaintextByteLength: context.plaintextByteLength,
    }),
    chunkSize: context.chunkSize,
    metadataHash: context.metadataHash,
    partCount: context.partCount,
    plaintextByteLength: context.plaintextByteLength,
    plaintextSha256: snapshot.sha256,
    sha256,
    getPartByteLength(index) {
      return planPartByteLength(context, index);
    },
    async encryptPart(index) {
      assertPartIndex(index, context.partCount);
      const plaintext = await readVerifiedBlobSourceChunk({
        chunkIndex: index,
        snapshot,
        source,
      });
      const ciphertext = await encryptBlobChunk(context, index, plaintext);
      return joinBlobPartBytes(
        index === 0 ? context.headerBytes : null,
        ciphertext,
      );
    },
  };
}

export async function prepareBlobEncryption(
  input: PrepareBlobEncryptionInput,
): Promise<BlobEncryptionPlan> {
  if (input.contentKey.byteLength !== AES_256_KEY_BYTES) {
    throw new Error("Blob content key must be 32 bytes");
  }
  if (input.nonceSeed) {
    assertAesGcmIv(input.nonceSeed, "Blob nonce seed is invalid");
  }
  const chunkSize = normalizeBlobChunkSize(
    input.chunkSize ?? DEFAULT_BLOB_CHUNK_SIZE_BYTES,
  );
  const snapshot =
    input.sourceSnapshot ?? (await inspectBlobSource(input.source, chunkSize));
  const context = await createBlobEncryptionContext(input, snapshot);
  if (
    snapshot.byteLength !== context.plaintextByteLength ||
    snapshot.chunkSize !== context.chunkSize
  ) {
    throw new Error("Blob source snapshot does not match encryption layout");
  }
  const sha256 = await runEncryptionHashPass(input.source, snapshot, context);
  return createBlobEncryptionPlan({
    context,
    sha256,
    snapshot,
    source: input.source,
  });
}
