import { createHash } from "node:crypto";

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Reads with `getReader()` rather than piping: a stream from another realm,
 * such as a DOM test environment's, is not accepted by this realm's
 * `pipeThrough`. `observe` sees each chunk before it is hashed; if it throws,
 * the stream is cancelled and the error propagates.
 */
export async function summarizeSha256Stream(
  stream: ReadableStream<Uint8Array>,
  observe?: (chunk: Uint8Array) => void,
): Promise<{ readonly byteLength: number; readonly sha256: string }> {
  const hash = createHash("sha256");
  const reader = stream.getReader();
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return {
          byteLength,
          sha256: hash.digest("hex"),
        };
      }

      observe?.(value);
      byteLength += value.byteLength;
      hash.update(value);
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // Preserve the original stream error.
    }

    throw error;
  } finally {
    reader.releaseLock();
  }
}
