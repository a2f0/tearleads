import { expect, test } from "bun:test";
import {
  type ContainerDocumentQueries,
  createDomainScope,
  type PendingDownloadQueueItem,
} from "@tearleads/client-sdk";
import { getDownloadHistoryEntries } from "./downloadHistoryMachine";
import { getOrCreateDownloadHistoryStore } from "./downloadHistoryStore";

function pending(localId: string): PendingDownloadQueueItem {
  return {
    documentId: `remote-${localId}`,
    lastError: null,
    localId,
    objectKind: "document",
    reason: "initial",
    title: localId,
  };
}

interface HeldRead {
  fail: (error: Error) => void;
  release: (items: ReadonlyArray<PendingDownloadQueueItem>) => void;
}

// Queries whose pending reads stay open until the test releases them.
function heldQueries(reads: HeldRead[]): ContainerDocumentQueries {
  return {
    listCompletedDownloads: async () => [],
    listPendingDownloads: () =>
      new Promise<ReadonlyArray<PendingDownloadQueueItem>>(
        (resolve, reject) => {
          reads.push({ fail: reject, release: resolve });
        },
      ),
  } as unknown as ContainerDocumentQueries;
}

async function flush() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function localIds(
  store: ReturnType<typeof getOrCreateDownloadHistoryStore>,
): string[] {
  return getDownloadHistoryEntries(store.getSnapshot()).map(
    (entry) => entry.item.localId,
  );
}

test("an immediate request during a read gets its read straight after", async () => {
  const store = getOrCreateDownloadHistoryStore(createDomainScope());
  const unsubscribe = store.subscribe(() => undefined);
  const reads: HeldRead[] = [];
  const queries = heldQueries(reads);
  store.requestRead(queries, { immediate: true });
  store.requestRead(queries, { immediate: true });
  expect(reads).toHaveLength(1);
  reads[0]?.release([pending("a")]);
  await flush();
  // No coalescing delay: the second read is already in flight.
  expect(reads).toHaveLength(2);
  reads[1]?.release([pending("a"), pending("b")]);
  await flush();
  expect(localIds(store)).toEqual(["a", "b"]);
  unsubscribe();
});

test("a failure from replaced queries is dropped and the replacement reads next", async () => {
  const store = getOrCreateDownloadHistoryStore(createDomainScope());
  const unsubscribe = store.subscribe(() => undefined);
  const oldReads: HeldRead[] = [];
  const newReads: HeldRead[] = [];
  store.requestRead(heldQueries(oldReads), { immediate: true });
  // The database reopens mid-read, so the view's new queries read at once.
  store.requestRead(heldQueries(newReads), { immediate: true });
  oldReads[0]?.fail(new Error("database closed"));
  await flush();
  expect(store.getSnapshot().status).toBe("loading");
  expect(newReads).toHaveLength(1);
  newReads[0]?.release([pending("fresh")]);
  await flush();
  expect(store.getSnapshot().status).toBe("ready");
  expect(localIds(store)).toEqual(["fresh"]);
  unsubscribe();
});

test("another view's read is kept, and its change signal waits for the delay", async () => {
  const store = getOrCreateDownloadHistoryStore(createDomainScope());
  const unsubscribe = store.subscribe(() => undefined);
  const firstWindow: HeldRead[] = [];
  const secondWindow: HeldRead[] = [];
  store.requestRead(heldQueries(firstWindow), { immediate: true });
  // A second Explorer window has its own queries for the same scope.
  store.requestRead(heldQueries(secondWindow), { immediate: false });
  firstWindow[0]?.release([pending("a")]);
  await flush();
  expect(localIds(store)).toEqual(["a"]);
  expect(secondWindow).toHaveLength(0);
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(secondWindow).toHaveLength(1);
  secondWindow[0]?.release([pending("a"), pending("b")]);
  await flush();
  expect(localIds(store)).toEqual(["a", "b"]);
  unsubscribe();
});

test("a change signal on an idle view reads after the coalescing delay", async () => {
  const store = getOrCreateDownloadHistoryStore(createDomainScope());
  const unsubscribe = store.subscribe(() => undefined);
  const reads: HeldRead[] = [];
  const queries = heldQueries(reads);
  store.requestRead(queries, { immediate: false });
  store.requestRead(queries, { immediate: false });
  expect(reads).toHaveLength(0);
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(reads).toHaveLength(1);
  unsubscribe();
});

test("closing the last view mid-read finishes the read without a follow-up", async () => {
  const store = getOrCreateDownloadHistoryStore(createDomainScope());
  const unsubscribe = store.subscribe(() => undefined);
  const reads: HeldRead[] = [];
  const queries = heldQueries(reads);
  store.requestRead(queries, { immediate: true });
  store.requestRead(queries, { immediate: false });
  unsubscribe();
  reads[0]?.release([pending("a")]);
  await flush();
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(reads).toHaveLength(1);
  // The rows stay for the next view, which reads at once.
  expect(localIds(store)).toEqual(["a"]);
  store.requestRead(queries, { immediate: true });
  expect(reads).toHaveLength(2);
});

test("a read starting does not notify views", async () => {
  const store = getOrCreateDownloadHistoryStore(createDomainScope());
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });
  const reads: HeldRead[] = [];
  store.requestRead(heldQueries(reads), { immediate: true });
  expect(notifications).toBe(0);
  reads[0]?.release([]);
  await flush();
  expect(notifications).toBe(1);
  unsubscribe();
});
