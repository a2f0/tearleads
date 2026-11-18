import type { BlobByteSource, BlobStore } from "../../data/blobs/blobContracts";
import { createKeyedQueue } from "../../data/shared/keyedQueue";

const queues = new WeakMap<BlobStore, ReturnType<typeof createKeyedQueue>>();

/** Keep already dispatched host writes in order across sign-ins. A retired
 * snapshot cannot begin a new write or supply another chunk for a stream. */
export function createSessionBlobStore(
  store: BlobStore,
  assertCurrent: () => void,
): BlobStore {
  const queue = queues.get(store) ?? createKeyedQueue();
  queues.set(store, queue);

  async function guarded<T>(work: () => Promise<T>): Promise<T> {
    assertCurrent();
    const result = await work();
    assertCurrent();
    return result;
  }

  function currentSource(source: BlobByteSource): BlobByteSource {
    return {
      byteLength: source.byteLength,
      read: (offset, length) => guarded(() => source.read(offset, length)),
    };
  }

  return {
    deleteBytes: (key) =>
      queue(key, () => guarded(() => store.deleteBytes(key))),
    openByteSource: (key) =>
      queue(key, async () => {
        const source = await guarded(() => store.openByteSource(key));
        return source && currentSource(source);
      }),
    readBytes: (key) => queue(key, () => guarded(() => store.readBytes(key))),
    writeByteSource: (key, source) =>
      queue(key, () =>
        guarded(() => store.writeByteSource(key, currentSource(source))),
      ),
    writeBytes: (key, bytes) =>
      queue(key, () => guarded(() => store.writeBytes(key, bytes))),
  };
}
