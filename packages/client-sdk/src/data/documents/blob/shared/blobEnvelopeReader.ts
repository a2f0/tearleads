import {
  AES_GCM_TAG_BYTES,
  assertAesGcmIv,
  CONTENT_RECORD_ENCRYPTION_SUITE,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import {
  assertOnlyRecordKeys,
  readRecordPositiveInteger,
  readRecordString,
} from "../../shared/readers";
import {
  BLOB_ENVELOPE_MAGIC_BYTES,
  BLOB_ENVELOPE_PREFIX_BYTES,
  type BlobEnvelopeV2Header,
  blobChunkPlaintextByteLength,
  computeBlobChunkCount,
  computeBlobEncryptedByteLength,
  encodeBlobEnvelopeV2Header,
} from "./blobEnvelopeV2";
import type { BlobEncryptedBytesRecord, BlobEncryptedChunk } from "./types";
import {
  BLOB_ENCRYPTED_BYTES_FORMAT,
  BLOB_ENCRYPTED_BYTES_KEYS,
  BLOB_ENCRYPTED_BYTES_VERSION,
} from "./types";

const MAX_HEADER_BYTES = 64 * 1024;
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

function readHeaderValue(encryptedBytes: Uint8Array<ArrayBuffer>): {
  readonly headerByteLength: number;
  readonly value: Record<string, unknown>;
} {
  if (encryptedBytes.byteLength < BLOB_ENVELOPE_PREFIX_BYTES) {
    throw new Error("Blob encrypted bytes envelope is truncated");
  }
  for (
    let index = 0;
    index < BLOB_ENVELOPE_MAGIC_BYTES.byteLength;
    index += 1
  ) {
    if (encryptedBytes[index] !== BLOB_ENVELOPE_MAGIC_BYTES[index]) {
      throw new Error("Blob encrypted bytes magic is invalid");
    }
  }
  const headerPayloadByteLength = new DataView(
    encryptedBytes.buffer,
    encryptedBytes.byteOffset,
    encryptedBytes.byteLength,
  ).getUint32(BLOB_ENVELOPE_MAGIC_BYTES.byteLength);
  if (
    headerPayloadByteLength === 0 ||
    headerPayloadByteLength > MAX_HEADER_BYTES
  ) {
    throw new Error("Blob encrypted bytes header length is invalid");
  }
  const headerByteLength = BLOB_ENVELOPE_PREFIX_BYTES + headerPayloadByteLength;
  if (headerByteLength > encryptedBytes.byteLength) {
    throw new Error("Blob encrypted bytes header is truncated");
  }

  let value: unknown;
  try {
    value = JSON.parse(
      TEXT_DECODER.decode(
        encryptedBytes.subarray(BLOB_ENVELOPE_PREFIX_BYTES, headerByteLength),
      ),
    );
  } catch {
    throw new Error("Blob encrypted bytes are invalid JSON");
  }
  if (!isPlainRecord(value)) {
    throw new Error("Blob encrypted bytes must be an object");
  }
  return { headerByteLength, value };
}

function readPlaintextByteLength(value: Record<string, unknown>): number {
  const byteLength = Reflect.get(value, "byteLength");
  if (
    typeof byteLength !== "number" ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0
  ) {
    throw new Error(
      "Blob encrypted bytes.byteLength must be a non-negative safe integer",
    );
  }
  return byteLength;
}

function normalizeHeader(value: Record<string, unknown>): {
  readonly header: BlobEnvelopeV2Header;
  readonly iv: Uint8Array;
} {
  assertOnlyRecordKeys(
    value,
    BLOB_ENCRYPTED_BYTES_KEYS,
    "Blob encrypted bytes",
  );
  const format = readRecordString(value, "format", "Blob encrypted bytes");
  if (format !== BLOB_ENCRYPTED_BYTES_FORMAT) {
    throw new Error("Blob encrypted bytes format is invalid");
  }
  const version = readRecordPositiveInteger(
    value,
    "version",
    "Blob encrypted bytes",
  );
  if (version !== BLOB_ENCRYPTED_BYTES_VERSION) {
    throw new Error(
      `Blob encrypted bytes version ${version} is invalid; expected ${BLOB_ENCRYPTED_BYTES_VERSION}`,
    );
  }
  const encryptionSuite = readRecordString(
    value,
    "encryptionSuite",
    "Blob encrypted bytes",
  );
  if (encryptionSuite !== CONTENT_RECORD_ENCRYPTION_SUITE) {
    throw new Error("Blob encrypted bytes suite is invalid");
  }
  const byteLength = readPlaintextByteLength(value);
  const chunkCount = readRecordPositiveInteger(
    value,
    "chunkCount",
    "Blob encrypted bytes",
  );
  const chunkSize = readRecordPositiveInteger(
    value,
    "chunkSize",
    "Blob encrypted bytes",
  );
  if (chunkCount !== computeBlobChunkCount(byteLength, chunkSize)) {
    throw new Error("Blob encrypted bytes chunk count is invalid");
  }
  const ivString = readRecordString(value, "iv", "Blob encrypted bytes");
  const iv = base64ToBytes(ivString);
  assertAesGcmIv(iv, "Blob encrypted bytes IV is invalid");
  return {
    header: {
      blobId: readRecordString(value, "blobId", "Blob encrypted bytes"),
      byteLength,
      chunkCount,
      chunkSize,
      contentKeyEpoch: readRecordPositiveInteger(
        value,
        "contentKeyEpoch",
        "Blob encrypted bytes",
      ),
      contentRecordId: readRecordString(
        value,
        "contentRecordId",
        "Blob encrypted bytes",
      ),
      encryptionSuite,
      format,
      iv: ivString,
      metadataHash: readRecordString(
        value,
        "metadataHash",
        "Blob encrypted bytes",
      ),
      nonceDomainHash: readRecordString(
        value,
        "nonceDomainHash",
        "Blob encrypted bytes",
      ),
      version,
    },
    iv,
  };
}

function readEncryptedChunks(input: {
  readonly encryptedBytes: Uint8Array<ArrayBuffer>;
  readonly header: BlobEnvelopeV2Header;
  readonly headerByteLength: number;
}): BlobEncryptedChunk[] {
  let chunkOffset = input.headerByteLength;
  return Array.from({ length: input.header.chunkCount }, (_, index) => {
    const plaintextByteLength = blobChunkPlaintextByteLength({
      chunkCount: input.header.chunkCount,
      chunkIndex: index,
      chunkSize: input.header.chunkSize,
      plaintextByteLength: input.header.byteLength,
    });
    const ciphertextByteLength = plaintextByteLength + AES_GCM_TAG_BYTES;
    const ciphertext = new Uint8Array(
      input.encryptedBytes.buffer,
      input.encryptedBytes.byteOffset + chunkOffset,
      ciphertextByteLength,
    );
    chunkOffset += ciphertextByteLength;
    return { ciphertext, index, plaintextByteLength };
  });
}

export function parseBlobEnvelopeV2(
  encryptedBytes: Uint8Array<ArrayBuffer>,
): BlobEncryptedBytesRecord {
  const { headerByteLength, value } = readHeaderValue(encryptedBytes);
  const { header, iv } = normalizeHeader(value);
  const canonicalHeaderBytes = encodeBlobEnvelopeV2Header(header);
  if (
    canonicalHeaderBytes.byteLength !== headerByteLength ||
    canonicalHeaderBytes.some((byte, index) => byte !== encryptedBytes[index])
  ) {
    throw new Error("Blob encrypted bytes header is not canonical");
  }
  const expectedByteLength = computeBlobEncryptedByteLength({
    chunkCount: header.chunkCount,
    headerByteLength,
    plaintextByteLength: header.byteLength,
  });
  if (encryptedBytes.byteLength !== expectedByteLength) {
    throw new Error("Blob encrypted bytes length is invalid");
  }
  return {
    blobId: header.blobId,
    byteLength: header.byteLength,
    chunkCount: header.chunkCount,
    chunks: readEncryptedChunks({ encryptedBytes, header, headerByteLength }),
    chunkSize: header.chunkSize,
    contentKeyEpoch: header.contentKeyEpoch,
    contentRecordId: header.contentRecordId,
    encryptedByteLength: encryptedBytes.byteLength,
    headerByteLength,
    iv,
    metadataHash: header.metadataHash,
    nonceDomainHash: header.nonceDomainHash,
  };
}
