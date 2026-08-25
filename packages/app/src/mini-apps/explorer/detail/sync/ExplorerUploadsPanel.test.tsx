import { afterEach, expect, test } from "bun:test";
import type { SyncLaneSnapshot } from "@symcrypt/client-sdk";
import { createDomainScope } from "@symcrypt/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ExplorerUploadItem } from "../../hooks/explorerUploadState";
import type { ExplorerUploadManager } from "../../hooks/useExplorerUploadManager";
import { EXPLORER_LABELS } from "../../labels";
import {
  deriveExplorerUploadItemStatus,
  ExplorerUploadsPanel,
} from "./ExplorerUploadsPanel";

afterEach(cleanup);

function item(overrides: Partial<ExplorerUploadItem> = {}): ExplorerUploadItem {
  return {
    containerId: "folder-1",
    error: null,
    fileName: "a.txt",
    fileSize: 1024,
    id: "upload-1",
    localId: null,
    status: "queued",
    ...overrides,
  };
}

function manager(
  overrides: Partial<ExplorerUploadManager> = {},
): ExplorerUploadManager {
  return {
    cancel: () => undefined,
    cancelForContainer: () => undefined,
    isImporting: false,
    items: [],
    queuedFileCount: 0,
    queuedFileCounts: new Map(),
    run: null,
    startImport: () => undefined,
    ...overrides,
  };
}

function lane(status: SyncLaneSnapshot["status"]): SyncLaneSnapshot {
  return {
    blobStorageKey: null,
    errorCount: 0,
    key: "documents:local-1",
    label: "documents:local-1",
    lastAction: "registered",
    lastActionAt: "2026-07-19T12:00:00.000Z",
    lastCompletedAt: null,
    lastError: null,
    lastFailedAt: null,
    lastRequestedAt: null,
    lastStartedAt: null,
    phase: "document",
    progress: null,
    registrationIndex: 0,
    requestCount: 0,
    requested: false,
    runAbandoned: false,
    runCount: 0,
    running: status === "running",
    status,
  };
}

test("ingest statuses pass through; imported items refine by sync lane", () => {
  expect(deriveExplorerUploadItemStatus(item(), undefined)).toBe("queued");
  expect(
    deriveExplorerUploadItemStatus(item({ status: "failed" }), undefined),
  ).toBe("failed");
  const imported = item({ localId: "local-1", status: "imported" });
  expect(deriveExplorerUploadItemStatus(imported, undefined)).toBe(
    "pending-sync",
  );
  expect(deriveExplorerUploadItemStatus(imported, lane("idle"))).toBe(
    "pending-sync",
  );
  expect(deriveExplorerUploadItemStatus(imported, lane("queued"))).toBe(
    "sync-queued",
  );
  expect(deriveExplorerUploadItemStatus(imported, lane("running"))).toBe(
    "uploading",
  );
  expect(deriveExplorerUploadItemStatus(imported, lane("complete"))).toBe(
    "uploaded",
  );
  expect(deriveExplorerUploadItemStatus(imported, lane("error"))).toBe(
    "sync-failed",
  );
});

test("renders the session empty state", () => {
  const view = render(
    <ExplorerUploadsPanel
      domainScope={createDomainScope()}
      uploadManager={manager()}
    />,
  );

  expect(view.getByText(EXPLORER_LABELS.uploadsEmpty)).toBeTruthy();
});

test("lists items newest-first with per-item statuses and summary", () => {
  const view = render(
    <ExplorerUploadsPanel
      domainScope={createDomainScope()}
      uploadManager={manager({
        items: [
          item({ fileName: "first.txt", id: "upload-1", status: "cancelled" }),
          item({
            fileName: "second.txt",
            id: "upload-2",
            localId: "local-2",
            status: "imported",
          }),
          item({ fileName: "third.txt", id: "upload-3", status: "importing" }),
        ],
      })}
    />,
  );

  const cells = view
    .getAllByRole("row")
    .map((row) => row.textContent)
    .join("\n");
  // Newest (third) first.
  expect(cells.indexOf("third.txt")).toBeLessThan(cells.indexOf("second.txt"));
  expect(cells.indexOf("second.txt")).toBeLessThan(cells.indexOf("first.txt"));
  expect(view.getByText(EXPLORER_LABELS.uploadsCancelledStatus)).toBeTruthy();
  expect(view.getByText(EXPLORER_LABELS.uploadsPendingSyncStatus)).toBeTruthy();
  expect(view.getByText(EXPLORER_LABELS.uploadsImportingStatus)).toBeTruthy();
  // 3 files, 2 still moving (importing + pending-sync).
  expect(view.getByText("3 files · 2 in progress")).toBeTruthy();
});

test("an active run shows the global status line with a working cancel", () => {
  let cancelCount = 0;
  const view = render(
    <ExplorerUploadsPanel
      domainScope={createDomainScope()}
      uploadManager={manager({
        cancel: () => {
          cancelCount += 1;
        },
        isImporting: true,
        items: [item({ status: "importing" })],
        run: {
          containerId: "folder-1",
          error: null,
          progress: {
            completedCount: 0,
            failedCount: 0,
            importedCount: 0,
            totalCount: 1,
          },
          status: "running",
        },
      })}
    />,
  );

  expect(view.getByText("Importing 0/1 files...")).toBeTruthy();
  fireEvent.click(
    view.getByRole("button", { name: EXPLORER_LABELS.fileImportCancelAction }),
  );
  expect(cancelCount).toBe(1);
});

test("bounds large lists until more rows are requested", () => {
  const items = Array.from({ length: 101 }, (_, index) =>
    item({
      fileName: `file-${index}.txt`,
      id: `upload-${index}`,
      status: "cancelled",
    }),
  );
  const view = render(
    <ExplorerUploadsPanel
      domainScope={createDomainScope()}
      uploadManager={manager({ items })}
    />,
  );

  expect(view.getAllByText(/file-\d+\.txt/).length).toBe(100);
  fireEvent.click(
    view.getByRole("button", { name: EXPLORER_LABELS.uploadsShowMoreAction }),
  );
  expect(view.getAllByText(/file-\d+\.txt/).length).toBe(101);
});
