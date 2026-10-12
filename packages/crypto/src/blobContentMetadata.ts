import {
  BLOB_ENCRYPTED_BYTES_FORMAT,
  BLOB_ENCRYPTED_BYTES_VERSION,
} from "./blobEnvelopeV2";
import { toFingerprint } from "./fingerprint";
import { serializeKeyingCanonicalJson } from "./keying/canonical";

const TEXT_ENCODER = new TextEncoder();
const BLOB_CONTENT_RECORD_METADATA_HASH_DOMAIN =
  "tearleads.blob.content-record-metadata";

export async function blobContentMetadataHash(input: {
  blobId: string;
  byteLength: number;
  chunkCount: number;
  chunkSize: number;
  contentKeyEpoch: number;
}): Promise<string> {
  return toFingerprint(
    TEXT_ENCODER.encode(
      serializeKeyingCanonicalJson({
        domain: BLOB_CONTENT_RECORD_METADATA_HASH_DOMAIN,
        payload: {
          version: BLOB_ENCRYPTED_BYTES_VERSION,
          recordKind: "blob_bytes",
          blobId: input.blobId,
          byteLength: input.byteLength,
          chunkCount: input.chunkCount,
          chunkSize: input.chunkSize,
          contentKeyEpoch: input.contentKeyEpoch,
          format: BLOB_ENCRYPTED_BYTES_FORMAT,
        },
      }),
    ),
  );
}
