import type { BlobBytes } from "../blobContracts";

/** Repartition the envelope without changing its encryption or buffering the file. */
export function createEncryptedUploadParts(input: {
  readonly byteLength: number;
  readonly chunkSize: number;
  readonly header: BlobBytes;
  readonly encryptChunk: (index: number) => Promise<BlobBytes>;
}) {
  // Including the header in the fixed transport size keeps even a maximum-size
  // envelope within 10,000 parts. R2 requires equal sizes for all nonfinal parts.
  const partSize = input.chunkSize + input.header.byteLength;
  const partCount = Math.ceil(input.byteLength / partSize);
  function getPartByteLength(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= partCount) {
      throw new Error("Blob encryption part index is out of range");
    }
    return Math.min(partSize, input.byteLength - index * partSize);
  }
  return {
    partCount,
    getPartByteLength,
    async encryptPart(index: number): Promise<BlobBytes> {
      const output = new Uint8Array(getPartByteLength(index));
      const start = index * partSize;
      const end = start + output.byteLength;
      if (start < input.header.byteLength) {
        output.set(
          input.header.subarray(start, Math.min(end, input.header.byteLength)),
        );
      }
      let position = Math.max(start, input.header.byteLength);
      while (position < end) {
        const chunkIndex = Math.floor(
          (position - input.header.byteLength) / input.chunkSize,
        );
        const chunkStart =
          input.header.byteLength + chunkIndex * input.chunkSize;
        // Adjacent transport parts can re-read and re-encrypt a shared chunk.
        // Independent calls keep memory bounded during concurrent upload/resume;
        // the tradeoff is up to two encryptions per chunk in this upload pass.
        const chunk = await input.encryptChunk(chunkIndex);
        const offset = position - chunkStart;
        const length = Math.min(chunk.byteLength - offset, end - position);
        if (length <= 0)
          throw new Error("Encrypted blob chunk is shorter than its layout");
        output.set(chunk.subarray(offset, offset + length), position - start);
        position += length;
      }
      return output;
    },
  };
}
