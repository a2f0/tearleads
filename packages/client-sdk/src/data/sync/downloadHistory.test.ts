import { expect, test } from "bun:test";
import { createDomainScope } from "../shared/domainScope";
import {
  type CompletedDownloadItem,
  getDomainDownloadHistorySnapshot,
  recordDomainCompletedDownload,
  subscribeToDomainDownloadHistory,
} from "./downloadHistory";

function document(localId: string, title = localId): CompletedDownloadItem {
  return {
    containerId: "root",
    documentId: `remote-${localId}`,
    localId,
    objectKind: "document",
    title,
  };
}

function file(localId: string, slotId: string): CompletedDownloadItem {
  return {
    blobId: null,
    containerId: "root",
    documentId: `remote-${localId}`,
    fileName: `${slotId}.pdf`,
    localId,
    objectKind: "attachment",
    slotId,
    storageKey: `blob-${localId}-${slotId}`,
    title: localId,
  };
}

test("lists completions newest first and notifies on each", () => {
  const scope = createDomainScope();
  let notifications = 0;
  subscribeToDomainDownloadHistory(scope, () => {
    notifications += 1;
  });

  recordDomainCompletedDownload(scope, document("alpha"));
  recordDomainCompletedDownload(scope, document("beta"));

  expect(
    getDomainDownloadHistorySnapshot(scope).completed.map(
      (item) => item.localId,
    ),
  ).toEqual(["beta", "alpha"]);
  expect(notifications).toBe(2);
});

test("records a completion with no host subscribed", () => {
  const scope = createDomainScope();
  recordDomainCompletedDownload(scope, document("alpha"));

  expect(getDomainDownloadHistorySnapshot(scope).completed).toEqual([
    document("alpha"),
  ]);
});

test("a repeated download moves to the front with its newest details", () => {
  const scope = createDomainScope();
  recordDomainCompletedDownload(scope, document("alpha", "Old"));
  recordDomainCompletedDownload(scope, document("beta"));
  recordDomainCompletedDownload(scope, document("alpha", "New"));

  expect(getDomainDownloadHistorySnapshot(scope).completed).toEqual([
    document("alpha", "New"),
    document("beta"),
  ]);
});

test("each file slot and object kind is its own entry", () => {
  const scope = createDomainScope();
  recordDomainCompletedDownload(scope, document("alpha"));
  recordDomainCompletedDownload(scope, file("alpha", "photo"));
  recordDomainCompletedDownload(scope, file("alpha", "scan"));
  recordDomainCompletedDownload(scope, {
    documentId: "remote-folder",
    localId: "alpha",
    objectKind: "container",
    title: "Folder",
  });

  expect(getDomainDownloadHistorySnapshot(scope).completed).toHaveLength(4);
});

test("keeps only the newest 2,000 completions", () => {
  const scope = createDomainScope();
  for (let index = 0; index < 2001; index += 1)
    recordDomainCompletedDownload(scope, document(`doc-${index}`));

  const { completed } = getDomainDownloadHistorySnapshot(scope);
  expect(completed).toHaveLength(2000);
  expect(completed[0]?.localId).toBe("doc-2000");
  expect(completed.at(-1)?.localId).toBe("doc-1");
});

test("history is isolated per domain scope", () => {
  const scopeA = createDomainScope();
  const scopeB = createDomainScope();
  recordDomainCompletedDownload(scopeA, document("alpha"));

  expect(getDomainDownloadHistorySnapshot(scopeB).completed).toEqual([]);
});

test("an unchanged history keeps its snapshot reference", () => {
  const scope = createDomainScope();
  recordDomainCompletedDownload(scope, document("alpha"));
  const first = getDomainDownloadHistorySnapshot(scope);

  expect(getDomainDownloadHistorySnapshot(scope)).toBe(first);
});
