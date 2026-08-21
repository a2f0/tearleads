import { bytesToHex, createIncrementalSha256 } from "@symcrypt/crypto";
import type { BlobByteSource, BlobBytes } from "../../../blobContracts";
import { asWebCryptoBytes } from "../../shared/readers";
import {
  blobChunkPlaintextByteLength,
  computeBlobChunkCount,
  normalizeBlobChunkSize,
} from "./blobEnvelopeV2";
import type { BlobSourceSnapshot } from "./types";

export type { BlobSourceSnapshot } from "./types";

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", asWebCryptoBytes(bytes)),
    ),
  );
}

function assertSourceByteLength(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new Error(
      "Blob source byte length must be a non-negative safe integer",
    );
  }
}

async function readExactSourceBytes(input: {
  readonly byteLength: number;
  readonly offset: number;
  readonly source: BlobByteSource;
}): Promise<BlobBytes> {
  const bytes = await input.source.read(input.offset, input.byteLength);
  if (bytes.byteLength !== input.byteLength) {
    throw new Error("Blob source returned an unexpected byte length");
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export async function inspectBlobSource(
  source: BlobByteSource,
  chunkSize: number,
): Promise<BlobSourceSnapshot> {
  assertSourceByteLength(source.byteLength);
  normalizeBlobChunkSize(chunkSize);
  const chunkCount = computeBlobChunkCount(source.byteLength, chunkSize);
  const chunkSha256: string[] = [];
  const objectHash = createIncrementalSha256();

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const byteLength = blobChunkPlaintextByteLength({
      chunkCount,
      chunkIndex,
      chunkSize,
      plaintextByteLength: source.byteLength,
    });
    const bytes = await readExactSourceBytes({
      byteLength,
      offset: chunkIndex * chunkSize,
      source,
    });
    objectHash.update(bytes);
    chunkSha256.push(await sha256Hex(bytes));
  }

  return {
    byteLength: source.byteLength,
    chunkSha256,
    chunkSize,
    sha256: bytesToHex(objectHash.digest()),
  };
}

export async function readVerifiedBlobSourceChunk(input: {
  readonly chunkIndex: number;
  readonly snapshot: BlobSourceSnapshot;
  readonly source: BlobByteSource;
}): Promise<BlobBytes> {
  const { chunkIndex, snapshot, source } = input;
  if (source.byteLength !== snapshot.byteLength) {
    throw new Error("Blob source byte length changed after inspection");
  }
  const chunkCount = computeBlobChunkCount(
    snapshot.byteLength,
    snapshot.chunkSize,
  );
  const byteLength = blobChunkPlaintextByteLength({
    chunkCount,
    chunkIndex,
    chunkSize: snapshot.chunkSize,
    plaintextByteLength: snapshot.byteLength,
  });
  const bytes = await readExactSourceBytes({
    byteLength,
    offset: chunkIndex * snapshot.chunkSize,
    source,
  });
  if ((await sha256Hex(bytes)) !== snapshot.chunkSha256[chunkIndex]) {
    throw new Error(
      `Blob plaintext chunk ${chunkIndex} changed after source inspection`,
    );
  }
  return bytes;
}
