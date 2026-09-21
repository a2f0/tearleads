import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { parseBlobEnvelopeV2Header } from "./blobEnvelopeReader";
import {
  BLOB_CHUNK_SIZE_BYTES,
  BLOB_ENCRYPTED_BYTES_FORMAT,
  BLOB_ENCRYPTED_BYTES_VERSION,
  BLOB_ENVELOPE_MAGIC_BYTES,
  BLOB_ENVELOPE_PREFIX_BYTES,
  type BlobEnvelopeV2Header,
  encodeBlobEnvelopeV2Header,
} from "./blobEnvelopeV2";
import { CONTENT_RECORD_ENCRYPTION_SUITE } from "./keying/types";
import { AES_GCM_IV_BYTES } from "./symmetric";

const IV = new Uint8Array(AES_GCM_IV_BYTES).fill(7);

function header(
  overrides: Partial<BlobEnvelopeV2Header> = {},
): BlobEnvelopeV2Header {
  return {
    blobId: "11111111-1111-4111-8111-111111111111",
    byteLength: 32,
    chunkCount: 1,
    chunkSize: BLOB_CHUNK_SIZE_BYTES,
    contentKeyEpoch: 1,
    contentRecordId: "22222222-2222-4222-8222-222222222222",
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    format: BLOB_ENCRYPTED_BYTES_FORMAT,
    iv: bytesToBase64(IV),
    metadataHash: "a".repeat(64),
    nonceDomainHash: "b".repeat(64),
    version: BLOB_ENCRYPTED_BYTES_VERSION,
    ...overrides,
  };
}

/** Re-frames an arbitrary JSON body under a correct magic and length prefix. */
function frame(body: string): Uint8Array<ArrayBuffer> {
  const payload = new TextEncoder().encode(body);
  const framed = new Uint8Array(
    BLOB_ENVELOPE_PREFIX_BYTES + payload.byteLength,
  );
  framed.set(BLOB_ENVELOPE_MAGIC_BYTES);
  new DataView(framed.buffer).setUint32(
    BLOB_ENVELOPE_MAGIC_BYTES.byteLength,
    payload.byteLength,
  );
  framed.set(payload, BLOB_ENVELOPE_PREFIX_BYTES);
  return framed;
}

test("a canonical header parses to its declared identity and length", () => {
  const encoded = encodeBlobEnvelopeV2Header(header());
  const parsed = parseBlobEnvelopeV2Header(encoded);
  expect({
    blobId: parsed.blobId,
    byteLength: parsed.byteLength,
    contentKeyEpoch: parsed.contentKeyEpoch,
    contentRecordId: parsed.contentRecordId,
    metadataHash: parsed.metadataHash,
    nonceDomainHash: parsed.nonceDomainHash,
  }).toEqual({
    blobId: header().blobId,
    byteLength: 32,
    contentKeyEpoch: 1,
    contentRecordId: header().contentRecordId,
    metadataHash: header().metadataHash,
    nonceDomainHash: header().nonceDomainHash,
  });
  expect(parsed.iv).toEqual(IV);
  // header + plaintext + one AES-GCM tag
  expect(parsed.encryptedByteLength).toBe(encoded.byteLength + 32 + 16);
});

test("a non-canonical base64 IV is refused", () => {
  // `base64ToBytes` tolerates whitespace, so this still decodes to the same 12
  // bytes; only re-encoding and comparing catches it. Without that rule the
  // header is accepted and the IV silently differs from what was written.
  const encoded = encodeBlobEnvelopeV2Header(
    header({ iv: `${bytesToBase64(IV)}\n` }),
  );
  expect(() => parseBlobEnvelopeV2Header(encoded)).toThrow(
    "Blob encrypted bytes IV is not canonical base64",
  );
});

test("a header carrying an unexpected key is refused", () => {
  const body = new TextDecoder().decode(
    encodeBlobEnvelopeV2Header(header()).subarray(BLOB_ENVELOPE_PREFIX_BYTES),
  );
  const withExtra = `${body.slice(0, -1)},"unexpected":"x"}`;
  expect(() => parseBlobEnvelopeV2Header(frame(withExtra))).toThrow(
    "unexpected keys",
  );
});

test("a non-canonical header ordering is refused", () => {
  const parsed = JSON.parse(
    new TextDecoder().decode(
      encodeBlobEnvelopeV2Header(header()).subarray(BLOB_ENVELOPE_PREFIX_BYTES),
    ),
  );
  // Same fields and values, emitted in reverse key order.
  const reordered = `{${Object.keys(parsed)
    .reverse()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(parsed[key])}`)
    .join(",")}}`;
  expect(() => parseBlobEnvelopeV2Header(frame(reordered))).toThrow(
    "Blob encrypted bytes header is not canonical",
  );
});

test("an unknown encryption suite is refused", () => {
  const encoded = encodeBlobEnvelopeV2Header(
    header({ encryptionSuite: "not-a-suite" }),
  );
  expect(() => parseBlobEnvelopeV2Header(encoded)).toThrow(
    "Blob encrypted bytes suite is invalid",
  );
});
