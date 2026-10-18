export type BlobBytes = Uint8Array<ArrayBuffer>;

/** A stable, replayable byte source whose reads return exactly the requested range. */
export interface BlobByteSource {
  readonly byteLength: number;
  read(offset: number, byteLength: number): Promise<BlobBytes>;
}

export type BlobByteSourceInput =
  | BlobBytes
  | BlobByteSource
  | Pick<Blob, "size" | "slice">;

export interface BlobStore {
  deleteBytes: (storageKey: string) => Promise<void>;
  openByteSource: (storageKey: string) => Promise<BlobByteSource | null>;
  readBytes: (storageKey: string) => Promise<BlobBytes | null>;
  writeByteSource: (
    storageKey: string,
    source: BlobByteSource,
  ) => Promise<void>;
  writeBytes: (storageKey: string, bytes: BlobBytes) => Promise<void>;
}

const SOURCE_READ_CHUNK_SIZE = 5 * 1024 * 1024;

function assertByteLength(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

export function assertReadRange(
  sourceByteLength: number,
  offset: number,
  byteLength: number,
): void {
  assertByteLength(offset, "Blob byte source read offset");
  assertByteLength(byteLength, "Blob byte source read length");
  if (offset + byteLength > sourceByteLength) {
    throw new Error("Blob byte source read exceeds the source length.");
  }
}

export async function readExactBlobBytes(
  source: BlobByteSource,
  offset: number,
  byteLength: number,
): Promise<BlobBytes> {
  const bytes = await source.read(offset, byteLength);
  if (bytes.byteLength !== byteLength) {
    throw new Error("Blob byte source returned an incomplete read.");
  }
  return bytes;
}

function copyBlobBytes(bytes: Uint8Array): BlobBytes {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function isBlobByteSource(input: BlobByteSourceInput): input is BlobByteSource {
  return (
    !(input instanceof Uint8Array) &&
    "byteLength" in input &&
    typeof input.byteLength === "number" &&
    "read" in input &&
    typeof input.read === "function"
  );
}

export function blobByteSourceInputLength(input: BlobByteSourceInput): number {
  const byteLength =
    isBlobByteSource(input) || input instanceof Uint8Array
      ? input.byteLength
      : input.size;
  assertByteLength(byteLength, "Blob byte source length");
  return byteLength;
}

export function createBlobByteSource(
  input: BlobByteSourceInput,
): BlobByteSource {
  if (isBlobByteSource(input)) {
    assertByteLength(input.byteLength, "Blob byte source length");
    return input;
  }

  if (input instanceof Uint8Array) {
    return {
      byteLength: input.byteLength,
      async read(offset, byteLength) {
        assertReadRange(input.byteLength, offset, byteLength);
        return copyBlobBytes(input.subarray(offset, offset + byteLength));
      },
    };
  }

  assertByteLength(input.size, "Blob size");
  return {
    byteLength: input.size,
    async read(offset, byteLength) {
      assertReadRange(input.size, offset, byteLength);
      const bytes = new Uint8Array(
        await input.slice(offset, offset + byteLength).arrayBuffer(),
      );
      if (bytes.byteLength !== byteLength) {
        throw new Error("Blob byte source returned an incomplete read.");
      }
      return bytes;
    },
  };
}

export async function readBlobByteSource(
  source: BlobByteSource,
): Promise<BlobBytes> {
  assertByteLength(source.byteLength, "Blob byte source length");
  const bytes = new Uint8Array(source.byteLength);

  if (source.byteLength === 0) {
    const empty = await source.read(0, 0);
    if (empty.byteLength !== 0) {
      throw new Error("Blob byte source returned an invalid empty read.");
    }
    return bytes;
  }

  for (let offset = 0; offset < source.byteLength; ) {
    const byteLength = Math.min(
      SOURCE_READ_CHUNK_SIZE,
      source.byteLength - offset,
    );
    const chunk = await source.read(offset, byteLength);
    if (chunk.byteLength !== byteLength) {
      throw new Error("Blob byte source returned an incomplete read.");
    }
    bytes.set(chunk, offset);
    offset += byteLength;
  }

  return bytes;
}
