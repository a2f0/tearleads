import { expect, test } from "bun:test";
import {
  type BlobByteSource,
  blobByteSourceInputLength,
  createBlobByteSource,
  readBlobByteSource,
} from "./blobContracts";

test("blob byte sources support exact replayable Blob ranges", async () => {
  const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5])]);
  const source = createBlobByteSource(blob);

  expect(blobByteSourceInputLength(blob)).toBe(5);
  expect(blobByteSourceInputLength(source)).toBe(5);
  await expect(source.read(1, 3)).resolves.toEqual(new Uint8Array([2, 3, 4]));
  await expect(source.read(1, 3)).resolves.toEqual(new Uint8Array([2, 3, 4]));
  await expect(source.read(4, 2)).rejects.toThrow("exceeds the source length");
});

test("readBlobByteSource rejects incomplete source reads", async () => {
  const source: BlobByteSource = {
    byteLength: 3,
    async read() {
      return new Uint8Array([1, 2]);
    },
  };

  await expect(readBlobByteSource(source)).rejects.toThrow("incomplete read");
});
