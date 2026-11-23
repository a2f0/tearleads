import { expect, test } from "bun:test";
import type { PendingDownloadQueueItem } from "@tearleads/client-sdk";
import {
  getQueueItems,
  INITIAL_QUEUE_READ,
  type QueueReadState,
  transitionQueueRead,
} from "./queueReadMachine";

function pending(localId: string): PendingDownloadQueueItem {
  return {
    documentId: `remote-${localId}`,
    lastError: null,
    localId,
    objectKind: "document",
    reason: "initial",
    title: null,
  };
}

function settle(
  state: QueueReadState<PendingDownloadQueueItem>,
  rows: ReadonlyArray<PendingDownloadQueueItem>,
): QueueReadState<PendingDownloadQueueItem> {
  const read = state.read + 1;
  const started = transitionQueueRead(state, {
    read,
    type: "read-started",
  });
  return transitionQueueRead(started, {
    items: rows,
    read,
    type: "read-finished",
  });
}

function ids(state: QueueReadState<PendingDownloadQueueItem>) {
  return getQueueItems(state).map((item) => item.localId);
}

test("each read replaces the pending rows", () => {
  const first = settle(INITIAL_QUEUE_READ, [pending("a"), pending("b")]);
  expect(first.status).toBe("ready");
  expect(ids(first)).toEqual(["a", "b"]);
  expect(ids(settle(first, [pending("b")]))).toEqual(["b"]);
});

test("a read starting only retags the state", () => {
  const ready = settle(INITIAL_QUEUE_READ, [pending("a")]);
  const started = transitionQueueRead(ready, {
    read: ready.read + 1,
    type: "read-started",
  });
  expect(started).toEqual({ ...ready, read: ready.read + 1 });
});

test("only the newest read settles, and a failed read keeps the rows", () => {
  const ready = settle(INITIAL_QUEUE_READ, [pending("a")]);
  const older = transitionQueueRead(ready, {
    read: ready.read + 1,
    type: "read-started",
  });
  const newer = transitionQueueRead(older, {
    read: ready.read + 2,
    type: "read-started",
  });
  expect(
    transitionQueueRead(newer, {
      items: [],
      read: ready.read + 1,
      type: "read-finished",
    }),
  ).toBe(newer);
  expect(
    transitionQueueRead(newer, {
      message: "late",
      read: ready.read + 1,
      type: "read-failed",
    }),
  ).toBe(newer);
  // A read cannot start behind the newest one.
  expect(
    transitionQueueRead(newer, { read: ready.read, type: "read-started" }),
  ).toBe(newer);

  const failed = transitionQueueRead(newer, {
    message: "Storage unavailable",
    read: newer.read,
    type: "read-failed",
  });
  expect(failed).toMatchObject({
    message: "Storage unavailable",
    status: "failed",
  });
  expect(ids(failed)).toEqual(["a"]);
  expect(ids(settle(failed, []))).toEqual([]);

  const neverRead = transitionQueueRead(
    transitionQueueRead(INITIAL_QUEUE_READ, {
      read: 1,
      type: "read-started",
    }),
    { message: "Storage unavailable", read: 1, type: "read-failed" },
  );
  expect(neverRead).toMatchObject({ items: [], status: "failed" });
});
