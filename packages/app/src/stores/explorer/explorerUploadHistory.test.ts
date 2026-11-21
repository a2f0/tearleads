import { expect, test } from "bun:test";
import {
  type ContainerDocumentQueries,
  createDomainScope,
  type DomainScope,
  getOrCreateDomainSyncCoordinator,
  waitForDomainSyncCoordinatorToSettle,
} from "@tearleads/client-sdk";
import { getOrCreateExplorerUploadHistory } from "./explorerUploadHistory";
import type { ExplorerUploadItem } from "./explorerUploadItemMachine";

type SyncStatus = "synced" | "pending" | "error";

function queriesWith(statusByLocalId: Map<string, SyncStatus>) {
  const reads: string[] = [];
  const queries = {
    loadDocumentSyncState: async (localId: string) => {
      reads.push(localId);
      const status = statusByLocalId.get(localId);
      return status === undefined
        ? null
        : {
            lastError: null,
            pendingAttachmentBytes: 0,
            pendingAttachmentCount: status === "pending" ? 1 : 0,
            pendingUpdateCount: 0,
            status,
          };
    },
  } as unknown as ContainerDocumentQueries;
  return { queries, reads };
}

function addImported(domainScope: DomainScope, localId: string): string {
  const history = getOrCreateExplorerUploadHistory(domainScope);
  const id = history.nextItemId();
  const item: ExplorerUploadItem = {
    containerId: "folder",
    error: null,
    fileName: `${localId}.txt`,
    fileSize: 1,
    id,
    localId: null,
    status: "queued",
    storageKeys: [],
  };
  history.add([item]);
  history.dispatch([id], { localId, storageKeys: [], type: "imported" });
  return id;
}

function statusOf(domainScope: DomainScope, id: string) {
  return getOrCreateExplorerUploadHistory(domainScope)
    .getSnapshot()
    .find((item) => item.id === id)?.status;
}

async function runLane(domainScope: DomainScope, localId: string) {
  getOrCreateDomainSyncCoordinator(domainScope).requestLane(
    `documents:${localId}`,
  );
  await waitForDomainSyncCoordinatorToSettle(domainScope, {
    quietMs: 0,
    timeoutMs: 1_000,
  });
  // Let the confirmation read settle.
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

test("a completed lane confirmed as synced latches the upload, with no view open", async () => {
  const domainScope = createDomainScope();
  const statuses = new Map<string, SyncStatus>([["a", "pending"]]);
  const { queries, reads } = queriesWith(statuses);
  const history = getOrCreateExplorerUploadHistory(domainScope);
  history.setDocumentQueries(queries);
  let fail = false;
  getOrCreateDomainSyncCoordinator(domainScope).registerLane("documents:a", {
    // Records the run as failed without logging the intended error.
    onUnexpectedError: () => undefined,
    run: async () => {
      if (fail) throw new Error("later edit failed");
    },
  });
  const id = addImported(domainScope, "a");

  // The lane completes but the SDK still holds the attachment.
  await runLane(domainScope, "a");
  expect(reads).toEqual(["a"]);
  expect(statusOf(domainScope, id)).toBe("imported");

  // The next completed run is checked again, and now confirms.
  statuses.set("a", "synced");
  await runLane(domainScope, "a");
  expect(reads).toEqual(["a", "a"]);
  expect(statusOf(domainScope, id)).toBe("uploaded");

  // A later failed run of the same lane does not undo the finished upload.
  fail = true;
  await runLane(domainScope, "a");
  expect(
    getOrCreateDomainSyncCoordinator(domainScope)
      .getSnapshot()
      .lanes.find((lane) => lane.key === "documents:a")?.status,
  ).toBe("error");
  expect(statusOf(domainScope, id)).toBe("uploaded");
  getOrCreateDomainSyncCoordinator(domainScope).dispose();
});

test("a file imported after its lane completed is confirmed at once", async () => {
  const domainScope = createDomainScope();
  const { queries } = queriesWith(new Map([["b", "synced"]]));
  getOrCreateExplorerUploadHistory(domainScope).setDocumentQueries(queries);
  getOrCreateDomainSyncCoordinator(domainScope).registerLane("documents:b", {
    run: async () => undefined,
  });
  await runLane(domainScope, "b");
  const id = addImported(domainScope, "b");
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
  expect(statusOf(domainScope, id)).toBe("uploaded");
});

test("item ids stay unique across managers that share a scope", () => {
  const history = getOrCreateExplorerUploadHistory(createDomainScope());
  expect([history.nextItemId(), history.nextItemId()]).toEqual([
    "upload-1",
    "upload-2",
  ]);
});
