import { afterEach, expect, jest, test } from "bun:test";
import {
  type ContainerDocumentQueries,
  createDomainScope,
  type DomainScope,
  getOrCreateDomainSyncCoordinator,
  type PendingDownloadQueueItem,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { getOrCreateExplorerUploadHistory } from "../../stores/explorer/explorerUploadHistory";
import type {
  ExplorerUploadItem,
  ExplorerUploadItemStatus,
} from "../../stores/explorer/explorerUploadItemMachine";
import { usePopoverTransfers } from "./usePopoverTransfers";

const scopes: DomainScope[] = [];

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  for (const scope of scopes.splice(0))
    getOrCreateDomainSyncCoordinator(scope).dispose();
});

function createScope(): DomainScope {
  const scope = createDomainScope();
  scopes.push(scope);
  return scope;
}

const DOWNLOAD: PendingDownloadQueueItem = {
  documentId: "remote-note",
  lastError: null,
  localId: "note",
  objectKind: "document",
  reason: "initial",
  title: "Note",
};

function countingQueries() {
  const counter = { reads: 0 };
  const queries = {
    listPendingDownloads: async () => {
      counter.reads += 1;
      return [DOWNLOAD];
    },
  } as unknown as ContainerDocumentQueries;
  return { counter, queries };
}

function upload(id: string, status: ExplorerUploadItemStatus) {
  const item: ExplorerUploadItem = {
    containerId: "folder",
    error: null,
    fileName: `${id}.txt`,
    fileSize: 1,
    id,
    localId: null,
    status,
    storageKeys: [],
  };
  return item;
}

async function settle() {
  await act(async () => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
  });
}

// Fake time well past the download queue's 300 ms coalescing delay, letting
// the lane run and the read it triggers settle along the way.
async function elapse(ms: number) {
  await act(async () => {
    for (let step = 0; step < 10; step += 1) {
      jest.advanceTimersByTime(ms / 10);
      for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
    }
  });
}

test("the download queue is read while the popover is open, and only then", async () => {
  jest.useFakeTimers();
  const domainScope = createScope();
  const { counter, queries } = countingQueries();
  const popover = renderHook(() =>
    usePopoverTransfers({
      dbReady: true,
      documentQueries: queries,
      domainScope,
    }),
  );
  await settle();
  expect(counter.reads).toBe(1);
  expect(popover.result.current.downloads).toEqual({
    failed: 0,
    firstError: null,
    pending: 1,
    status: "read",
  });

  // A lane run while the popover is open re-reads the queue...
  const lane = getOrCreateDomainSyncCoordinator(domainScope).registerLane(
    "documents:folder",
    { run: async () => undefined },
  );
  lane.requestSync();
  await elapse(1000);
  expect(counter.reads).toBe(2);

  // ...and the same signal after it closes reads nothing.
  popover.unmount();
  lane.requestSync();
  await elapse(1000);
  expect(counter.reads).toBe(2);
});

test("a closed database reads nothing and shows downloads as loading", async () => {
  const { counter, queries } = countingQueries();
  const { result } = renderHook(() =>
    usePopoverTransfers({
      dbReady: false,
      documentQueries: queries,
      domainScope: createScope(),
    }),
  );
  await settle();
  expect(counter.reads).toBe(0);
  expect(result.current.downloads).toEqual({ status: "loading" });
});

test("files still on their way to the server count as uploading", async () => {
  const domainScope = createScope();
  getOrCreateExplorerUploadHistory(domainScope).add([
    upload("queued", "queued"),
    upload("importing", "importing"),
    upload("imported", "imported"),
    upload("uploaded", "uploaded"),
    upload("failed", "failed"),
    upload("cancelled", "cancelled"),
  ]);
  const { result } = renderHook(() =>
    usePopoverTransfers({
      dbReady: false,
      documentQueries: countingQueries().queries,
      domainScope,
    }),
  );
  expect(result.current.uploadingFileCount).toBe(3);
});
