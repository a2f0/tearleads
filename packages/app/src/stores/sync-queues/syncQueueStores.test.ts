import { expect, test } from "bun:test";
import {
  type ContainerDocumentQueries,
  createDomainScope,
  type DomainScope,
  getOrCreateDomainDownloadHistory,
  getOrCreateDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import {
  getOrCreatePendingDownloadQueueStore,
  getOrCreatePendingWriteQueueStore,
} from "./syncQueueStores";

// Longer than either queue's coalescing window.
function afterCoalescing() {
  return new Promise((resolve) => setTimeout(resolve, 900));
}

function countingQueries(counter: { reads: number }): ContainerDocumentQueries {
  return {
    listPendingDownloads: async () => {
      counter.reads += 1;
      return [];
    },
    listPendingWrites: async () => {
      counter.reads += 1;
      return [];
    },
  } as unknown as ContainerDocumentQueries;
}

function syncBurst(domainScope: DomainScope, prefix: string) {
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  for (let index = 0; index < 5; index += 1) {
    coordinator
      .registerLane(`${prefix}-${index}`, { run: async () => undefined })
      .requestSync();
  }
}

test("one burst of sync activity reads the write queue once for every watcher", async () => {
  const domainScope = createDomainScope();
  const store = getOrCreatePendingWriteQueueStore(domainScope);
  expect(getOrCreatePendingWriteQueueStore(domainScope)).toBe(store);
  const counter = { reads: 0 };
  // The tray, System Monitor, and the Write Queue panel each hold their own
  // query handle for the same database.
  const stops = [
    store.watch(countingQueries(counter)),
    store.watch(countingQueries(counter)),
    store.watch(countingQueries(counter)),
  ];
  await afterCoalescing();
  const settled = counter.reads;

  syncBurst(domainScope, "write-burst");
  await afterCoalescing();
  expect(counter.reads).toBe(settled + 1);

  for (const stop of stops) stop();
  syncBurst(domainScope, "write-unwatched");
  await afterCoalescing();
  expect(counter.reads).toBe(settled + 1);
});

test("a recorded download completion re-reads the download queue", async () => {
  const domainScope = createDomainScope();
  const store = getOrCreatePendingDownloadQueueStore(domainScope);
  const counter = { reads: 0 };
  const stop = store.watch(countingQueries(counter));
  await afterCoalescing();
  expect(counter.reads).toBe(1);

  getOrCreateDomainDownloadHistory(domainScope).recordCompleted({
    containerId: null,
    documentId: "remote-note",
    localId: "note",
    objectKind: "document",
    title: "Note",
  });
  await afterCoalescing();
  expect(counter.reads).toBe(2);
  stop();
});

test("each domain scope has its own queues", () => {
  const first = createDomainScope();
  const second = createDomainScope();
  expect(getOrCreatePendingWriteQueueStore(first)).not.toBe(
    getOrCreatePendingWriteQueueStore(second),
  );
  expect(getOrCreatePendingDownloadQueueStore(first)).not.toBe(
    getOrCreatePendingWriteQueueStore(first),
  );
});
