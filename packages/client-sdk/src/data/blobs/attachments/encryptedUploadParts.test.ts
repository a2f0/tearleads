import { expect, test } from "bun:test";
import {
  AES_GCM_TAG_BYTES,
  BLOB_CHUNK_SIZE_BYTES,
  MAX_BLOB_CHUNK_COUNT,
} from "@tearleads/crypto";
import { createEncryptedUploadParts } from "./encryptedUploadParts";

test("maximum-size envelopes stay within 10,000 parts without reading the whole source", async () => {
  const chunkSize = BLOB_CHUNK_SIZE_BYTES + AES_GCM_TAG_BYTES;
  const header = new Uint8Array(500);
  const reads: number[] = [];
  const parts = createEncryptedUploadParts({
    byteLength: header.byteLength + chunkSize * MAX_BLOB_CHUNK_COUNT,
    chunkSize,
    header,
    async encryptChunk(index) {
      reads.push(index);
      return new Uint8Array(chunkSize);
    },
  });
  expect(parts.partCount).toBe(MAX_BLOB_CHUNK_COUNT);
  expect(reads).toEqual([]);
  const last = await parts.encryptPart(parts.partCount - 1);
  expect(last.byteLength).toBe(parts.getPartByteLength(parts.partCount - 1));
  expect(reads).toEqual([MAX_BLOB_CHUNK_COUNT - 1]);
  await expect(parts.encryptPart(parts.partCount)).rejects.toThrow(
    "out of range",
  );
});
