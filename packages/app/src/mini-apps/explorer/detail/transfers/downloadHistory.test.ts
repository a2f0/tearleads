import { expect, test } from "bun:test";
import type {
  CompletedDownloadItem,
  PendingDownloadQueueItem,
} from "@tearleads/client-sdk";
import { mergeDownloadHistory } from "./downloadHistory";

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
    containerId: "root",
    documentId: `remote-${localId}`,
    localId,
    objectKind: "document",
    title: `Title ${localId}`,
  };
}

function rows(
  pendingItems: ReadonlyArray<PendingDownloadQueueItem>,
  completedItems: ReadonlyArray<CompletedDownloadItem>,
) {
  return mergeDownloadHistory(pendingItems, completedItems).map(
    (entry) => `${entry.status}:${entry.item.localId}`,
  );
}

test("pending rows come first in queue order, then finished ones", () => {
  expect(
    rows([pending("b"), pending("a")], [completed("d"), completed("c")]),
  ).toEqual(["pending:b", "pending:a", "complete:d", "complete:c"]);
});

test("a finished download back in the queue is listed once, as pending", () => {
  expect(rows([pending("a")], [completed("a"), completed("b")])).toEqual([
    "pending:a",
    "complete:b",
  ]);
});

test("file downloads are keyed per slot", () => {
  const file = (slotId: string): PendingDownloadQueueItem => ({
    documentId: "remote-drill",
    fileName: `${slotId}.png`,
    lastError: null,
    localId: "drill",
    objectKind: "attachment",
    reason: "initial",
    slotId,
    title: "Drill",
  });
  const front: CompletedDownloadItem = {
    blobId: "front-blob",
    containerId: "tools",
    documentId: "remote-drill",
    fileName: "front.png",
    localId: "drill",
    objectKind: "attachment",
    slotId: "front",
    storageKey: "blob-front",
    title: "Drill",
  };
  expect(mergeDownloadHistory([file("side")], [front])).toEqual([
    { item: file("side"), status: "pending" },
    { item: front, status: "complete" },
  ]);
  // The finished document itself is a different row from its files.
  expect(rows([file("side")], [completed("drill")])).toEqual([
    "pending:drill",
    "complete:drill",
  ]);
});
