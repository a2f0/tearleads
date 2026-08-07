import { createHash } from "node:crypto";

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function summarizeSha256Stream(
  stream: ReadableStream<Uint8Array>,
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
