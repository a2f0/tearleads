import type { BlobBytesResponse } from "@tearleads/api-client";

/** Cancel even a custom/native response stream that ignores fetch's signal. */
export async function readAttachmentTransfer(
  blob: BlobBytesResponse,
  signal: AbortSignal,
  progress: () => void,
  maxEncryptedBytes?: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = blob.encryptedBytes.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    const declaredLength = blob.byteLength;
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0)
      throw new Error("Invalid declared blob length");
    const limit = Math.min(maxEncryptedBytes ?? declaredLength, declaredLength);
    if (signal.aborted) abort();
    signal.throwIfAborted();
    for (;;) {
      const result = await reader.read();
      signal.throwIfAborted();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > limit)
        throw new Error("Blob stream exceeds its declared length");
      chunks.push(result.value);
      progress();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (error) {
    abort();
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
