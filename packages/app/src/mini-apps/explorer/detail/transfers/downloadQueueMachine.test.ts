import { expect, test } from "bun:test";
import type { PendingDownloadQueueItem } from "@tearleads/client-sdk";
import {
  type DownloadQueueState,
  getPendingDownloads,
  INITIAL_DOWNLOAD_QUEUE,
  transitionDownloadQueue,
} from "./downloadQueueMachine";

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
  state: DownloadQueueState,
  rows: ReadonlyArray<PendingDownloadQueueItem>,
): DownloadQueueState {
  const read = state.read + 1;
  const started = transitionDownloadQueue(state, {
    read,
    type: "read-started",
  });
  return transitionDownloadQueue(started, {
    pending: rows,
    read,
    type: "read-finished",
  });
}

function ids(state: DownloadQueueState) {
  return getPendingDownloads(state).map((item) => item.localId);
}

test("each read replaces the pending rows", () => {
  const first = settle(INITIAL_DOWNLOAD_QUEUE, [pending("a"), pending("b")]);
  expect(first.status).toBe("ready");
  expect(ids(first)).toEqual(["a", "b"]);
  expect(ids(settle(first, [pending("b")]))).toEqual(["b"]);
});

test("a read starting only retags the state", () => {
  const ready = settle(INITIAL_DOWNLOAD_QUEUE, [pending("a")]);
  const started = transitionDownloadQueue(ready, {
    read: ready.read + 1,
    type: "read-started",
  });
  expect(started).toEqual({ ...ready, read: ready.read + 1 });
});

test("only the newest read settles, and a failed read keeps the rows", () => {
  const ready = settle(INITIAL_DOWNLOAD_QUEUE, [pending("a")]);
  const older = transitionDownloadQueue(ready, {
    read: ready.read + 1,
    type: "read-started",
  });
  const newer = transitionDownloadQueue(older, {
    read: ready.read + 2,
    type: "read-started",
  });
  expect(
    transitionDownloadQueue(newer, {
      pending: [],
      read: ready.read + 1,
      type: "read-finished",
    }),
  ).toBe(newer);
  expect(
    transitionDownloadQueue(newer, {
      message: "late",
      read: ready.read + 1,
      type: "read-failed",
    }),
  ).toBe(newer);
  // A read cannot start behind the newest one.
  expect(
    transitionDownloadQueue(newer, { read: ready.read, type: "read-started" }),
  ).toBe(newer);

  const failed = transitionDownloadQueue(newer, {
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

  const neverRead = transitionDownloadQueue(
    transitionDownloadQueue(INITIAL_DOWNLOAD_QUEUE, {
      read: 1,
      type: "read-started",
    }),
    { message: "Storage unavailable", read: 1, type: "read-failed" },
  );
  expect(neverRead).toMatchObject({ pending: [], status: "failed" });
});
