import { expect, test } from "bun:test";
import type { BlobByteSource } from "../../data/blobs/blobContracts";
import { createMemoryBlobStore } from "../../data/blobs/memoryBlobStore";
import { createSessionBlobStore } from "./sessionBlobStore";

test("aborting an open releases its session queue before the host returns", async () => {
  const host = createMemoryBlobStore();
  const reached = Promise.withResolvers<void>();
  const pending = Promise.withResolvers<BlobByteSource | null>();
  const source = { byteLength: 1, read: async () => new Uint8Array([2]) };
  let opens = 0;
  host.openByteSource = async () => {
    if (++opens > 1) return source;
    reached.resolve();
    return pending.promise;
  };
  const store = createSessionBlobStore(host, () => {});
  const abort = new AbortController();
  const first = store.openByteSource("same", abort.signal);
  await reached.promise;
  abort.abort();
  try {
    await expect(first).rejects.toThrow();
    const second = await store.openByteSource("same");
    expect(await second?.read(0, 1)).toEqual(new Uint8Array([2]));
    pending.resolve({ byteLength: 1, read: async () => new Uint8Array([1]) });
    expect(await second?.read(0, 1)).toEqual(new Uint8Array([2]));
  } finally {
    pending.resolve(null);
  }
});
