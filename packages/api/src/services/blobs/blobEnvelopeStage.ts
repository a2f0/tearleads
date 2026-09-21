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

/**
 * Hash the complete object while retaining at most its bounded public header.
 *
 * The envelope is judged before the caller compares length and hash against
 * the stage row, so a stored object that is both malformed and mismatched is
 * reported as malformed (400) rather than as a storage conflict (409). That is
 * deliberate: multipart completion has already verified the declared length
 * and hash, so a mismatch here means storage changed after completion, and
 * waiting to find out would mean reading every malformed upload to the end.
 */
export async function summarizeBlobEnvelopeStage(
  stream: ReadableStream<Uint8Array>,
) {
  const header = createEnvelopeHeaderObserver();
  // Parsing as soon as the header is buffered lets a malformed one cancel the
  // upload stream, rather than hashing the whole object first to reject it.
  const summary = await summarizeSha256Stream(stream, header.observe);
  const envelopeHeader = header.parsed();
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

/** Buffers at most the bounded header and parses it as soon as it is whole. */
function createEnvelopeHeaderObserver() {
  const headerBuffer = new Uint8Array(
    BLOB_ENVELOPE_PREFIX_BYTES + MAX_BLOB_ENVELOPE_HEADER_BYTES,
  );
  let retainedBytes = 0;
  let headerByteLength: number | null = null;
  let parsed: BlobEnvelopeHeaderRecord | null = null;
  return {
    observe(chunk: Uint8Array): void {
      // Once the header is parsed, the rest is ciphertext: hash it, don't keep it.
      if (parsed !== null) return;
      const copied = Math.min(
        chunk.byteLength,
        headerBuffer.byteLength - retainedBytes,
      );
      headerBuffer.set(chunk.subarray(0, copied), retainedBytes);
      retainedBytes += copied;
      try {
        if (
          headerByteLength === null &&
          retainedBytes >= BLOB_ENVELOPE_PREFIX_BYTES
        ) {
          headerByteLength = readBlobEnvelopeHeaderByteLength(headerBuffer);
        }
        if (headerByteLength !== null && retainedBytes >= headerByteLength) {
          // `headerByteLength` already spans the framing prefix and the payload.
          parsed = parseBlobEnvelopeV2Header(
            headerBuffer.subarray(0, headerByteLength),
          );
        }
      } catch (error) {
        throw invalidEnvelope(error);
      }
    },
    parsed: (): BlobEnvelopeHeaderRecord | null => parsed,
  };
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
