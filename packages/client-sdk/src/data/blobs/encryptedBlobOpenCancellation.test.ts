import { expect, test } from "bun:test";
import { wrapEncryptedBlobStore } from "./encryptedBlobStore";
import { createMemoryBlobStore } from "./memoryBlobStore";

test("aborting an encrypted open releases a stalled envelope header read", async () => {
  const host = createMemoryBlobStore();
  const entered = Promise.withResolvers<void>();
  const bytes = Promise.withResolvers<Uint8Array<ArrayBuffer>>();
  host.openByteSource = async () => ({
    byteLength: 256,
    read: () => {
      entered.resolve();
      return bytes.promise;
    },
  });
  const store = wrapEncryptedBlobStore(host, {
    namespace: "identity",
    key: "test-key",
    kdfIterations: 1,
  });
  const abort = new AbortController();
  const opening = store.openByteSource("file", abort.signal);
  await entered.promise;
  abort.abort();
  try {
    await expect(opening).rejects.toThrow();
  } finally {
    bytes.resolve(new Uint8Array(256));
  }
});
