const MEBIBYTE = 1024 * 1024;
const LINE_BYTES = 64;
const LINES_PER_SLAB = 1024;
const BYTES_PER_SLAB = LINES_PER_SLAB * LINE_BYTES;

/**
 * Generates `byteCount` bytes (rounded up to 64-byte lines) of incompressible
 * random hex text, matching `packages/bob-and-alice`'s `largeText` shape so
 * compression cannot collapse multi-segment rotation baselines.
 */
export function incompressibleText(byteCount: number): string {
  const slab = new Uint8Array(LINES_PER_SLAB * 32);
  const parts: string[] = [];
  let remaining = Math.ceil(byteCount / LINE_BYTES) * LINE_BYTES;
  while (remaining > 0) {
    const chunkBytes = Math.min(remaining, BYTES_PER_SLAB);
    const lineCount = chunkBytes / LINE_BYTES;
    crypto.getRandomValues(slab);
    const hex = Buffer.from(slab).toString("hex");
    const lines: string[] = [];
    for (let i = 0; i < lineCount; i += 1) {
      const start = i * 64;
      lines.push(hex.slice(start, start + 63));
    }
    parts.push(`${lines.join("\n")}\n`);
    remaining -= chunkBytes;
  }
  return parts.join("");
}

/**
 * Splits `totalMiB` of incompressible text into writes of at most
 * `maxChunkMiB` MiB each so every seeding write fits comfortably within a
 * single sync request.
 */
export function generateIncompressibleChunks(
  totalMiB: number,
  maxChunkMiB: number,
): string[] {
  if (totalMiB <= 0 || maxChunkMiB <= 0) {
    throw new Error("totalMiB and maxChunkMiB must be positive.");
  }
  const chunks: string[] = [];
  let remainingMiB = totalMiB;
  while (remainingMiB > 0) {
    const chunkMiB = Math.min(remainingMiB, maxChunkMiB);
    chunks.push(incompressibleText(chunkMiB * MEBIBYTE));
    remainingMiB -= chunkMiB;
  }
  return chunks;
}
