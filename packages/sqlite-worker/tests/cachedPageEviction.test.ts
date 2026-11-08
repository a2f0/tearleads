import { test } from "bun:test";
import { createModuleDatabaseRuntime } from "../src/runtime";

// A page the previous deploy left in the back/forward cache must still be
// evicted by the next deploy's pages, so this name cannot change.
const CACHED_PAGE_EVICTION_CHANNEL_NAME =
  "tearleads-sqlite-cached-page-eviction";

class IdleWorker extends EventTarget {
  postMessage(): void {}
  terminate(): void {}
}

function receiveNotices(
  channel: BroadcastChannel,
  expected: number,
): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  let received = 0;
  channel.addEventListener("message", () => {
    received += 1;
    if (received === expected) {
      resolve();
    }
  });
  return promise;
}

test("every runtime a page creates evicts pages held in the back/forward cache", async () => {
  // Stands in for a page a navigation left in the cache, holding the channel
  // open; any message it receives makes Chromium evict it.
  const cachedPage = new BroadcastChannel(CACHED_PAGE_EVICTION_CHANNEL_NAME);
  const noticed = receiveNotices(cachedPage, 2);
  try {
    // The dedicated-worker path that Electrobun and Capacitor take has no other
    // channel a cached page could hear, and a boot retry creates a new runtime.
    const first = createModuleDatabaseRuntime({
      workerConstructor: IdleWorker,
    });
    const retry = createModuleDatabaseRuntime({
      workerConstructor: IdleWorker,
    });
    await noticed;
    first.terminateNow();
    retry.terminateNow();
  } finally {
    cachedPage.close();
  }
});
