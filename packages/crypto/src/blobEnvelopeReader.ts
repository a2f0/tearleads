import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import {
  assertOnlyRecordKeys,
  readRecordPositiveInteger,
  readRecordString,
} from "./blobEnvelopeFields";
import {
  BLOB_ENCRYPTED_BYTES_FORMAT,
  BLOB_ENCRYPTED_BYTES_VERSION,
  BLOB_ENVELOPE_MAGIC_BYTES,
  BLOB_ENVELOPE_PREFIX_BYTES,
  type BlobEnvelopeV2Header,
  blobChunkPlaintextByteLength,
  computeBlobChunkCount,
  computeBlobEncryptedByteLength,
  encodeBlobEnvelopeV2Header,
} from "./blobEnvelopeV2";
import { CONTENT_RECORD_ENCRYPTION_SUITE } from "./keying/types";
import { AES_GCM_TAG_BYTES, assertAesGcmIv } from "./symmetric";

export interface BlobEnvelopeRecord {
  blobId: string;
  byteLength: number;
  chunkCount: number;
  chunks: BlobEnvelopeChunk[];
  chunkSize: number;
  contentKeyEpoch: number;
  contentRecordId: string;
  encryptedByteLength: number;
  headerByteLength: number;
  iv: Uint8Array;
  metadataHash: string;
  nonceDomainHash: string;
}
interface BlobEnvelopeChunk {
  ciphertext: Uint8Array<ArrayBuffer>;
  index: number;
  plaintextByteLength: number;
}
const BLOB_ENCRYPTED_BYTES_KEYS = new Set([
  "blobId",
  "byteLength",
  "chunkCount",
  "chunkSize",
  "contentKeyEpoch",
  "contentRecordId",
  "encryptionSuite",
  "format",
  "iv",
  "metadataHash",
  "nonceDomainHash",
  "version",
]);

export const MAX_BLOB_ENVELOPE_HEADER_BYTES = 64 * 1024;
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

export function readBlobEnvelopeHeaderByteLength(
  encryptedBytes: Uint8Array<ArrayBuffer>,
): number {
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
    headerPayloadByteLength > MAX_BLOB_ENVELOPE_HEADER_BYTES
  ) {
    throw new Error("Blob encrypted bytes header length is invalid");
  }
  return BLOB_ENVELOPE_PREFIX_BYTES + headerPayloadByteLength;
}

function readHeaderValue(encryptedBytes: Uint8Array<ArrayBuffer>): {
  readonly headerByteLength: number;
  readonly value: Record<string, unknown>;
} {
  const headerByteLength = readBlobEnvelopeHeaderByteLength(encryptedBytes);
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
  if (bytesToBase64(iv) !== ivString) {
    throw new Error("Blob encrypted bytes IV is not canonical base64");
  }
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
  readonly header: Pick<
    BlobEnvelopeV2Header,
    "byteLength" | "chunkCount" | "chunkSize"
  >;
  readonly headerByteLength: number;
}): BlobEnvelopeChunk[] {
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

export function parseBlobEnvelopeV2Header(
  encryptedBytes: Uint8Array<ArrayBuffer>,
): BlobEnvelopeRecord {
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
  return {
    blobId: header.blobId,
    byteLength: header.byteLength,
    chunkCount: header.chunkCount,
    chunks: [],
    chunkSize: header.chunkSize,
    contentKeyEpoch: header.contentKeyEpoch,
    contentRecordId: header.contentRecordId,
    encryptedByteLength: expectedByteLength,
    headerByteLength,
    iv,
    metadataHash: header.metadataHash,
    nonceDomainHash: header.nonceDomainHash,
  };
}

export function parseBlobEnvelopeV2(
  encryptedBytes: Uint8Array<ArrayBuffer>,
): BlobEnvelopeRecord {
  const encrypted = parseBlobEnvelopeV2Header(encryptedBytes);
  if (encryptedBytes.byteLength !== encrypted.encryptedByteLength)
    throw new Error("Blob encrypted bytes length is invalid");
  return {
    ...encrypted,
    chunks: readEncryptedChunks({
      encryptedBytes,
      header: encrypted,
      headerByteLength: encrypted.headerByteLength,
    }),
  };
}
