import type { BlobEnvelopeHeaderRecord } from "@tearleads/crypto";
import {
  BLOB_ENVELOPE_PREFIX_BYTES,
  BlobEnvelopeError,
  MAX_BLOB_ENVELOPE_HEADER_BYTES,
  parseBlobEnvelopeV2Header,
  readBlobEnvelopeHeaderByteLength,
} from "@tearleads/crypto";
import { summarizeSha256Stream } from "../../utils/sha256";
import { BlobMutationError } from "../../workflows/blobs/mutations";

/** Hash the complete object while retaining at most its bounded public header. */
export async function summarizeBlobEnvelopeStage(
  stream: ReadableStream<Uint8Array>,
) {
  const prefix = new Uint8Array(
    BLOB_ENVELOPE_PREFIX_BYTES + MAX_BLOB_ENVELOPE_HEADER_BYTES,
  );
  let retainedBytes = 0;
  let headerByteLength: number | null = null;
  const parsed: { header: BlobEnvelopeHeaderRecord | null } = { header: null };
  // Parsing as soon as the header is buffered lets a malformed one cancel the
  // upload stream, rather than hashing the whole object first to reject it.
  const observed = stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const copied = Math.min(
          chunk.byteLength,
          prefix.byteLength - retainedBytes,
        );
        prefix.set(chunk.subarray(0, copied), retainedBytes);
        retainedBytes += copied;
        if (
          headerByteLength === null &&
          retainedBytes >= BLOB_ENVELOPE_PREFIX_BYTES
        ) {
          try {
            headerByteLength = readBlobEnvelopeHeaderByteLength(prefix);
          } catch (error) {
            throw invalidEnvelope(error);
          }
        }
        if (
          parsed.header === null &&
          headerByteLength !== null &&
          retainedBytes >= headerByteLength
        ) {
          try {
            // `headerByteLength` already spans the prefix and the payload.
            parsed.header = parseBlobEnvelopeV2Header(
              prefix.subarray(0, headerByteLength),
            );
          } catch (error) {
            throw invalidEnvelope(error);
          }
        }
        controller.enqueue(chunk);
      },
    }),
  );
  const summary = await summarizeSha256Stream(observed);
  const envelopeHeader = parsed.header;
  if (envelopeHeader === null) {
    throw new BlobMutationError(
      "Blob encrypted envelope is truncated before its header",
      400,
    );
  }
  if (summary.byteLength !== envelopeHeader.encryptedByteLength) {
    throw new BlobMutationError(
      "Blob encrypted envelope length is invalid",
      400,
    );
  }
  return { ...summary, envelopeHeader };
}

/**
 * Only a structural rejection is the submitter's fault. Anything else — a
 * stream failure, or a bug here — propagates as itself rather than being
 * reported to the client as a malformed upload.
 */
function invalidEnvelope(error: unknown): unknown {
  return error instanceof BlobEnvelopeError
    ? new BlobMutationError(error.message, 400)
    : error;
}
