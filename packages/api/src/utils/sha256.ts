import { createHash } from "node:crypto";

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));

  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
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
  } finally {
    reader.releaseLock();
  }
}
