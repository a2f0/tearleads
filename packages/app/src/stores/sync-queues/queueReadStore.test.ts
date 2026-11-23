import { expect, test } from "bun:test";
import { getQueueItems } from "./queueReadMachine";
import { createQueueReadStore, type QueueReadStore } from "./queueReadStore";

interface HeldRead {
  readonly source: string;
  fail: (error: Error) => void;
  release: (items: ReadonlyArray<string>) => void;
}

const COALESCE_MS = 20;

// A store over string sources whose reads stay open until the test releases
// them, with change signals the test fires by hand.
function heldStore() {
  const reads: HeldRead[] = [];
  const changeListeners = new Set<() => void>();
  const store = createQueueReadStore<string, string>({
    coalesceMs: COALESCE_MS,
    read: (source) =>
      new Promise((resolve, reject) => {
        reads.push({ fail: reject, release: resolve, source });
      }),
    subscribeToChanges: (onChange) => {
      changeListeners.add(onChange);
      return () => changeListeners.delete(onChange);
    },
  });
  const change = () => {
    for (const listener of changeListeners) listener();
  };
  return { change, changeListeners, reads, store };
}

async function flush() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function afterCoalescing() {
  return new Promise((resolve) => setTimeout(resolve, COALESCE_MS * 3));
}

function rows(store: QueueReadStore<string, string>): ReadonlyArray<string> {
  return getQueueItems(store.getSnapshot());
}

test("the first watch reads at once and a watch with the same source does not", async () => {
  const { reads, store } = heldStore();
  const stopFirst = store.watch("db");
  expect(reads).toHaveLength(1);
  const stopSecond = store.watch("db");
  expect(reads).toHaveLength(1);
  reads[0]?.release(["a"]);
  await flush();
  expect(store.getSnapshot().status).toBe("ready");
  expect(rows(store)).toEqual(["a"]);
  await afterCoalescing();
  expect(reads).toHaveLength(1);
  stopFirst();
  stopSecond();
});

test("a watch with another source gets its read straight after the one in flight", async () => {
  const { reads, store } = heldStore();
  const stopFirst = store.watch("first");
  const stopSecond = store.watch("second");
  expect(reads).toHaveLength(1);
  reads[0]?.release(["a"]);
  await flush();
  // Every watch reads the same database, so the first source's rows count.
  expect(rows(store)).toEqual(["a"]);
  expect(reads.map((read) => read.source)).toEqual(["first", "second"]);
  reads[1]?.release(["a", "b"]);
  await flush();
  expect(rows(store)).toEqual(["a", "b"]);
  stopFirst();
  stopSecond();
});

test("a failure from a replaced source is dropped and the replacement reads next", async () => {
  const { reads, store } = heldStore();
  const stopOld = store.watch("old");
  // The database reopens mid-read, so the new source reads at once.
  const stopNew = store.watch("new");
  reads[0]?.fail(new Error("database closed"));
  await flush();
  expect(store.getSnapshot().status).toBe("loading");
  expect(reads[1]?.source).toBe("new");
  reads[1]?.release(["fresh"]);
  await flush();
  expect(store.getSnapshot().status).toBe("ready");
  expect(rows(store)).toEqual(["fresh"]);
  stopOld();
  stopNew();
});

test("a burst of changes reads once after the coalescing delay", async () => {
  const { change, reads, store } = heldStore();
  const stop = store.watch("db");
  reads[0]?.release([]);
  await flush();
  change();
  change();
  change();
  expect(reads).toHaveLength(1);
  await afterCoalescing();
  expect(reads).toHaveLength(2);
  stop();
});

test("changes during a read queue exactly one follow-up", async () => {
  const { change, reads, store } = heldStore();
  const stop = store.watch("db");
  change();
  change();
  reads[0]?.release(["a"]);
  await flush();
  expect(reads).toHaveLength(1);
  await afterCoalescing();
  expect(reads).toHaveLength(2);
  reads[1]?.release(["a", "b"]);
  await flush();
  await afterCoalescing();
  expect(reads).toHaveLength(2);
  expect(rows(store)).toEqual(["a", "b"]);
  stop();
});

test("a failed read keeps the last rows, and a later change reads again", async () => {
  const { change, reads, store } = heldStore();
  const stop = store.watch("db");
  reads[0]?.release(["a"]);
  await flush();
  change();
  await afterCoalescing();
  reads[1]?.fail(new Error("disk I/O error"));
  await flush();
  expect(store.getSnapshot()).toMatchObject({
    items: ["a"],
    message: "disk I/O error",
    status: "failed",
  });
  change();
  await afterCoalescing();
  reads[2]?.release([]);
  await flush();
  expect(store.getSnapshot().status).toBe("ready");
  expect(rows(store)).toEqual([]);
  stop();
});

test("stopping the last watch mid-read finishes it without a follow-up", async () => {
  const { change, changeListeners, reads, store } = heldStore();
  const stop = store.watch("db");
  change();
  stop();
  expect(changeListeners.size).toBe(0);
  reads[0]?.release(["a"]);
  await flush();
  await afterCoalescing();
  expect(reads).toHaveLength(1);
  // The rows stay for the next watch, which reads at once.
  expect(rows(store)).toEqual(["a"]);
  const stopAgain = store.watch("db");
  expect(reads).toHaveLength(2);
  expect(changeListeners.size).toBe(1);
  stopAgain();
});

test("Refresh reads at once only while watched", async () => {
  const { reads, store } = heldStore();
  store.readNow();
  expect(reads).toHaveLength(0);
  const stop = store.watch("db");
  reads[0]?.release([]);
  await flush();
  store.readNow();
  expect(reads).toHaveLength(2);
  stop();
});

test("closing the newest watch reads with the one before it, without a read", async () => {
  const { change, reads, store } = heldStore();
  const stopTray = store.watch("tray");
  const stopPanel = store.watch("panel");
  reads[0]?.release([]);
  await flush();
  reads[1]?.release([]);
  await flush();
  stopPanel();
  await afterCoalescing();
  expect(reads).toHaveLength(2);
  change();
  await afterCoalescing();
  expect(reads[2]?.source).toBe("tray");
  stopTray();
});

test("a failure dropped from a closed view's read is followed by the remaining view's read", async () => {
  const { reads, store } = heldStore();
  const stopTray = store.watch("tray");
  const stopPanel = store.watch("panel");
  reads[0]?.fail(new Error("locked"));
  await flush();
  expect(reads.map((read) => read.source)).toEqual(["tray", "panel"]);
  // The panel closes while its read is in flight, and that read fails.
  stopPanel();
  reads[1]?.fail(new Error("locked"));
  await flush();
  // Without a follow-up the tray would wait at "loading" until the next
  // change signal.
  expect(store.getSnapshot().status).toBe("loading");
  expect(reads[2]?.source).toBe("tray");
  reads[2]?.release(["a"]);
  await flush();
  expect(rows(store)).toEqual(["a"]);
  stopTray();
});

test("a read starting does not notify views", async () => {
  const { reads, store } = heldStore();
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });
  const stop = store.watch("db");
  expect(notifications).toBe(0);
  reads[0]?.release([]);
  await flush();
  expect(notifications).toBe(1);
  unsubscribe();
  stop();
});
