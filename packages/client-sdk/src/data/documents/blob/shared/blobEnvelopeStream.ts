import {
  BLOB_ENVELOPE_PREFIX_BYTES,
  createIncrementalSha256,
  parseBlobEnvelopeV2Header,
  readBlobEnvelopeHeaderByteLength,
} from "@tearleads/crypto";
import type { BlobBytes } from "../../../blobContracts";

/** Reads exactly one bounded envelope part without retaining previous parts. */
export function createBlobEnvelopeStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const hash = createIncrementalSha256();
  let pending: Uint8Array = new Uint8Array(0);
  const read = async (length: number): Promise<BlobBytes> => {
    const bytes = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      if (pending.byteLength === 0) {
        const chunk = await reader.read();
        if (chunk.done)
          throw new Error("Blob encrypted bytes envelope is truncated");
        pending = chunk.value;
        continue;
      }
      const count = Math.min(length - offset, pending.byteLength);
      bytes.set(pending.subarray(0, count), offset);
      pending = pending.subarray(count);
      offset += count;
    }
    hash.update(bytes);
    return bytes;
  };
  return {
    read,
    async readHeader() {
      const prefix = await read(BLOB_ENVELOPE_PREFIX_BYTES);
      const headerByteLength = readBlobEnvelopeHeaderByteLength(prefix);
      const bytes = new Uint8Array(headerByteLength);
      bytes.set(prefix);
      bytes.set(
        await read(headerByteLength - prefix.byteLength),
        prefix.byteLength,
      );
      return parseBlobEnvelopeV2Header(bytes);
    },
    async finish() {
      if (pending.byteLength > 0)
        throw new Error("Blob encrypted bytes length is invalid");
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) return hash.digest();
        if (chunk.value.byteLength > 0)
          throw new Error("Blob encrypted bytes length is invalid");
      }
    },
    async close() {
      try {
        await reader.cancel();
      } catch {
        /* Preserve the verification or transport failure. */
      }
      reader.releaseLock();
    },
  };
}
