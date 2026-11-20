import type { BlobByteSource, BlobStore } from "../../data/blobs/blobContracts";
import { createKeyedQueue } from "../../data/shared/keyedQueue";
import { waitForRead } from "../../data/shared/waitForRead";

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
      read: (offset, length, signal) =>
        guarded(() =>
          signal
            ? source.read(offset, length, signal)
            : source.read(offset, length),
        ),
    };
  }

  function commitGuard(check?: () => void) {
    return check
      ? () => {
          assertCurrent();
          check();
        }
      : assertCurrent;
  }

  return {
    deleteBytes: (key, check) =>
      queue(key, () =>
        guarded(() => store.deleteBytes(key, commitGuard(check))),
      ),
    openByteSource: (key, signal) =>
      waitForRead(
        queue(key, async () => {
          signal?.throwIfAborted();
          const source = await guarded(() =>
            signal
              ? waitForRead(store.openByteSource(key, signal), signal)
              : store.openByteSource(key),
          );
          return source && currentSource(source);
        }),
        signal,
      ),
    readBytes: (key) => queue(key, () => guarded(() => store.readBytes(key))),
    writeByteSource: (key, source, check) =>
      queue(key, () =>
        guarded(() =>
          store.writeByteSource(key, currentSource(source), commitGuard(check)),
        ),
      ),
    writeBytes: (key, bytes, check) =>
      queue(key, () =>
        guarded(() => store.writeBytes(key, bytes, commitGuard(check))),
      ),
  };
}
