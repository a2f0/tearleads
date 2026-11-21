import { expect, test } from "bun:test";
import type {
  CompletedDownloadItem,
  PendingDownloadQueueItem,
} from "@tearleads/client-sdk";
import {
  type DownloadHistoryState,
  getDepartedDownloads,
  INITIAL_DOWNLOAD_HISTORY,
  transitionDownloadHistory,
} from "./downloadHistoryMachine";

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

function completed(localId: string): CompletedDownloadItem {
  return {
    documentId: `remote-${localId}`,
    localId,
    objectKind: "document",
    title: `Title ${localId}`,
  };
}

function settle(
  state: DownloadHistoryState,
  input: {
    completed?: ReadonlyArray<CompletedDownloadItem>;
    pending: ReadonlyArray<PendingDownloadQueueItem>;
  },
): DownloadHistoryState {
  const read = state.read + 1;
  const started = transitionDownloadHistory(state, {
    read,
    type: "read-started",
  });
  return transitionDownloadHistory(started, {
    completed: input.completed ?? [],
    pending: input.pending,
    read,
    type: "read-finished",
  });
}

function rows(state: DownloadHistoryState) {
  return state.status === "loading"
    ? []
    : state.entries.map((entry) => `${entry.status}:${entry.item.localId}`);
}

test("a confirmed departure becomes complete and an unconfirmed one is dropped", () => {
  const first = settle(INITIAL_DOWNLOAD_HISTORY, {
    pending: [pending("a"), pending("b"), pending("c")],
  });
  expect(rows(first)).toEqual(["pending:a", "pending:b", "pending:c"]);
  expect(getDepartedDownloads(first, [pending("b")])).toEqual([
    { localId: "a", objectKind: "document" },
    { localId: "c", objectKind: "document" },
  ]);

  const second = settle(first, {
    completed: [completed("a")],
    pending: [pending("b")],
  });
  expect(rows(second)).toEqual(["pending:b", "complete:a"]);
  expect(second.status === "ready" && second.entries[1]?.item.title).toBe(
    "Title a",
  );

  // Completed rows stay, newest first, and only pending rows can depart.
  const third = settle(second, { completed: [completed("b")], pending: [] });
  expect(rows(third)).toEqual(["complete:b", "complete:a"]);
  expect(getDepartedDownloads(third, [])).toEqual([]);
});

test("a confirmation for a row this history never saw pending is ignored", () => {
  const state = settle(INITIAL_DOWNLOAD_HISTORY, {
    completed: [completed("elsewhere")],
    pending: [],
  });
  expect(rows(state)).toEqual([]);
});

test("a completed row that re-enters the queue is listed once, as pending", () => {
  const done = settle(
    settle(INITIAL_DOWNLOAD_HISTORY, { pending: [pending("a")] }),
    { completed: [completed("a")], pending: [] },
  );
  expect(rows(done)).toEqual(["complete:a"]);
  const again = settle(done, { pending: [pending("a")] });
  expect(rows(again)).toEqual(["pending:a"]);
  expect(
    rows(settle(again, { completed: [completed("a")], pending: [] })),
  ).toEqual(["complete:a"]);
});

test("only the newest read settles, and a failed read keeps the rows", () => {
  const ready = settle(INITIAL_DOWNLOAD_HISTORY, { pending: [pending("a")] });
  const older = transitionDownloadHistory(ready, {
    read: ready.read + 1,
    type: "read-started",
  });
  const newer = transitionDownloadHistory(older, {
    read: ready.read + 2,
    type: "read-started",
  });
  expect(
    transitionDownloadHistory(newer, {
      completed: [completed("a")],
      pending: [],
      read: ready.read + 1,
      type: "read-finished",
    }),
  ).toBe(newer);
  expect(
    transitionDownloadHistory(newer, {
      message: "late",
      read: ready.read + 1,
      type: "read-failed",
    }),
  ).toBe(newer);
  // A read cannot start behind the newest one.
  expect(
    transitionDownloadHistory(newer, {
      read: ready.read,
      type: "read-started",
    }),
  ).toBe(newer);

  const failed = transitionDownloadHistory(newer, {
    message: "Storage unavailable",
    read: newer.read,
    type: "read-failed",
  });
  expect(failed).toMatchObject({
    message: "Storage unavailable",
    status: "failed",
  });
  expect(rows(failed)).toEqual(["pending:a"]);
  expect(rows(settle(failed, { pending: [] }))).toEqual([]);

  const neverRead = transitionDownloadHistory(
    transitionDownloadHistory(INITIAL_DOWNLOAD_HISTORY, {
      read: 1,
      type: "read-started",
    }),
    { message: "Storage unavailable", read: 1, type: "read-failed" },
  );
  expect(neverRead).toMatchObject({ entries: [], status: "failed" });
});

test("only the newest 2000 completed rows are kept", () => {
  const ids = Array.from({ length: 2_001 }, (_, index) => `item-${index}`);
  const queued = settle(INITIAL_DOWNLOAD_HISTORY, {
    pending: ids.map(pending),
  });
  const first = settle(queued, {
    completed: [completed("item-0")],
    pending: ids.slice(1).map(pending),
  });
  const all = settle(first, {
    completed: ids.slice(1).map(completed),
    pending: [],
  });
  const kept = rows(all);
  expect(kept).toHaveLength(2_000);
  // The oldest completion is the one dropped.
  expect(kept).not.toContain("complete:item-0");
  expect(kept[0]).toBe("complete:item-1");
});
