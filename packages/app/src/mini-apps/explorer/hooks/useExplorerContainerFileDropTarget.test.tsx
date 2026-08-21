import { afterEach, expect, test } from "bun:test";
import type { ContainerNode } from "@symcrypt/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@symcrypt/client-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { EXPLORER_LABELS } from "../labels";
import type { ExplorerFileImportRunState } from "./explorerUploadState";
import { useExplorerContainerFileDropTarget } from "./useExplorerContainerFileDropTarget";
import type { ExplorerUploadManager } from "./useExplorerUploadManager";

afterEach(() => cleanup());

function node(id: string): ContainerNode {
  return {
    id,
    kind: "container",
    name: id,
    organizationId: "org-1",
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
  };
}

function runningRun(containerId: string): ExplorerFileImportRunState {
  return {
    containerId,
    error: null,
    progress: {
      completedCount: 0,
      failedCount: 0,
      importedCount: 0,
      totalCount: 2,
    },
    status: "running",
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

function renderDropTarget(
  uploadManager: ExplorerUploadManager,
  selectedNode: ContainerNode,
) {
  return renderHook(() =>
    useExplorerContainerFileDropTarget({ selectedNode, uploadManager }),
  );
}

test("status, importing, and cancel affordance scope to the selected container", () => {
  const uploadManager = manager({
    isImporting: true,
    run: runningRun("folder-2"),
  });

  // Viewing a folder the run does not target: nothing surfaces.
  const other = renderDropTarget(uploadManager, node("folder-1"));
  expect(other.result.current.importStatus).toBeNull();
  expect(other.result.current.isImporting).toBe(false);
  expect(other.result.current.canCancelImport).toBe(false);

  // Viewing the run's own folder: everything surfaces.
  const target = renderDropTarget(uploadManager, node("folder-2"));
  expect(target.result.current.importStatus).toBe("Importing 0/2 files...");
  expect(target.result.current.isImporting).toBe(true);
  expect(target.result.current.canCancelImport).toBe(true);
});

test("a folder queued behind another run reports it and cancels only itself", () => {
  const cancelledContainerIds: string[] = [];
  const uploadManager = manager({
    cancelForContainer: (containerId) => {
      cancelledContainerIds.push(containerId);
    },
    isImporting: true,
    queuedFileCount: 3,
    queuedFileCounts: new Map([["folder-1", 3]]),
    run: runningRun("folder-2"),
  });
  const { result } = renderDropTarget(uploadManager, node("folder-1"));

  expect(result.current.importStatus).toBe("3 files waiting to upload.");
  expect(result.current.isImporting).toBe(false);
  expect(result.current.canCancelImport).toBe(true);

  act(() => result.current.cancelImport());
  expect(cancelledContainerIds).toEqual(["folder-1"]);
});

test("the queued suffix counts only this container's files", () => {
  const uploadManager = manager({
    isImporting: true,
    queuedFileCount: 7,
    queuedFileCounts: new Map([
      ["folder-1", 2],
      ["folder-2", 5],
    ]),
    run: runningRun("folder-1"),
  });
  const { result } = renderDropTarget(uploadManager, node("folder-1"));

  expect(result.current.importStatus).toBe(
    "Importing 0/2 files... 2 more files queued.",
  );
});

test("dragging over shows the drop hint over any status", () => {
  const uploadManager = manager({
    isImporting: true,
    run: runningRun("folder-1"),
  });
  const { result } = renderDropTarget(uploadManager, node("folder-1"));

  const dragEvent = {
    dataTransfer: { types: ["Files"] },
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  } as unknown as Parameters<typeof result.current.handleDragEnter>[0];
  act(() => result.current.handleDragEnter(dragEvent));

  expect(result.current.importStatus).toBe(EXPLORER_LABELS.fileDropHint);
});
