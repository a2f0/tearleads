import { expect, mock, test } from "bun:test";
import type {
  PendingWriteQueueItem,
  PendingWriteQueueOperation,
} from "@tearleads/client-sdk";
import { createPendingWriteWatcher } from "./pendingWriteWatcher";

type WatchedItems = ReadonlyArray<PendingWriteQueueItem>;

const THROTTLE_MS = 5;

// One queued item carrying a single operation of the given count, so a list of
// them sums (via countPendingWrites) to a predictable total.
function item(count: number): PendingWriteQueueItem {
  const operation: PendingWriteQueueOperation = {
    byteLength: 0,
    count,
    createdAt: null,
    kind: "update",
    lastAttemptedAt: null,
    lastError: null,
    status: "pending",
    targetContainerId: null,
    updatedAt: null,
  };
  return {
    containerId: null,
    createdAt: null,
    localId: "local",
    name: null,
    namespace: null,
    objectKind: "document",
    operations: [operation],
    organizationId: null,
    remoteId: null,
    status: "pending",
    updatedAt: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Wait past the throttle window so a scheduled re-read has a chance to run.
const settle = () =>
  new Promise((resolve) => setTimeout(resolve, THROTTLE_MS * 4));

test("reads once immediately and reports the items verbatim", async () => {
  const onSnapshot = mock((_items: WatchedItems) => {});
  const items = [item(2), item(3)];
  const watcher = createPendingWriteWatcher({
    listPendingWrites: async () => items,
    subscribe: () => () => {},
    onSnapshot,
    throttleMs: THROTTLE_MS,
  });

  await settle();
  expect(onSnapshot).toHaveBeenCalledTimes(1);
  // The watcher hands the raw items to the caller, which projects them.
  expect(onSnapshot.mock.calls[0]?.[0]).toEqual(items);
  watcher.stop();
});

test("re-reads once when a subscribed change fires", async () => {
  let notify = () => {};
  let reads = 0;
  const watcher = createPendingWriteWatcher({
    listPendingWrites: async () => {
      reads += 1;
      return [];
    },
    subscribe: (onChange) => {
      notify = onChange;
      return () => {};
    },
    onSnapshot: () => {},
    throttleMs: THROTTLE_MS,
  });

  await settle();
  expect(reads).toBe(1);
  notify();
  await settle();
  expect(reads).toBe(2);
  watcher.stop();
});

test("coalesces a burst of changes into a single re-read", async () => {
  let notify = () => {};
  let reads = 0;
  const watcher = createPendingWriteWatcher({
    listPendingWrites: async () => {
      reads += 1;
      return [];
    },
    subscribe: (onChange) => {
      notify = onChange;
      return () => {};
    },
    onSnapshot: () => {},
    throttleMs: THROTTLE_MS,
  });

  await settle();
  expect(reads).toBe(1);
  notify();
  notify();
  notify();
  await settle();
  expect(reads).toBe(2);
  watcher.stop();
});

test("serializes: a change mid-read queues exactly one follow-up", async () => {
  const gates = [
    deferred<PendingWriteQueueItem[]>(),
    deferred<PendingWriteQueueItem[]>(),
  ];
  let index = 0;
  let notify = () => {};
  let reads = 0;
  const watcher = createPendingWriteWatcher({
    listPendingWrites: () => {
      reads += 1;
      return gates[index++]?.promise ?? Promise.resolve([]);
    },
    subscribe: (onChange) => {
      notify = onChange;
      return () => {};
    },
    onSnapshot: () => {},
    throttleMs: THROTTLE_MS,
  });

  // Initial read is in flight (pending on the first gate).
  expect(reads).toBe(1);
  // Two changes arrive during that read: no overlapping scan starts.
  notify();
  notify();
  await settle();
  expect(reads).toBe(1);
  // When the in-flight read resolves, exactly one throttled follow-up runs.
  gates[0]?.resolve([]);
  await settle();
  expect(reads).toBe(2);
  // The follow-up drains the queue; nothing more is scheduled.
  gates[1]?.resolve([]);
  await settle();
  expect(reads).toBe(2);
  watcher.stop();
});

test("reports nothing after stop(), even for an in-flight read", async () => {
  const gate = deferred<PendingWriteQueueItem[]>();
  const onSnapshot = mock((_items: WatchedItems) => {});
  const watcher = createPendingWriteWatcher({
    listPendingWrites: () => gate.promise,
    subscribe: () => () => {},
    onSnapshot,
    throttleMs: THROTTLE_MS,
  });

  watcher.stop();
  gate.resolve([item(1)]);
  await settle();
  expect(onSnapshot).not.toHaveBeenCalled();
});

test("a failed read reports nothing and a later change still reads", async () => {
  let calls = 0;
  let notify = () => {};
  const onSnapshot = mock((_items: WatchedItems) => {});
  const watcher = createPendingWriteWatcher({
    listPendingWrites: () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("read failed"))
        : Promise.resolve([item(4)]);
    },
    subscribe: (onChange) => {
      notify = onChange;
      return () => {};
    },
    onSnapshot,
    throttleMs: THROTTLE_MS,
  });

  await settle();
  expect(onSnapshot).not.toHaveBeenCalled();
  notify();
  await settle();
  expect(onSnapshot).toHaveBeenCalledTimes(1);
  expect(onSnapshot.mock.calls[0]?.[0]?.[0]?.operations[0]?.count).toBe(4);
  watcher.stop();
});

test("stop() unsubscribes from the change source", () => {
  let unsubscribed = false;
  const watcher = createPendingWriteWatcher({
    listPendingWrites: async () => [],
    subscribe: () => () => {
      unsubscribed = true;
    },
    onSnapshot: () => {},
    throttleMs: THROTTLE_MS,
  });

  watcher.stop();
  expect(unsubscribed).toBe(true);
});
