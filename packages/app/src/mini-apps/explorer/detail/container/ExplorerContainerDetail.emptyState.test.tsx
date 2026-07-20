import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  type ContainerDocumentQueries,
  type ContainerItemRow,
  type ContainerNode,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ExplorerUploadManager } from "../../hooks/useExplorerUploadManager";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerContainerDetail } from "./ExplorerContainerDetail";

const resizeObserverGlobal = globalThis as unknown as {
  ResizeObserver?: unknown;
};
const originalResizeObserver = resizeObserverGlobal.ResizeObserver;

// Without a ResizeObserver the virtual window's limit stays fixed, keeping the
// fetch sequence deterministic (one listContainerItemWindow call per trigger).
beforeEach(() => {
  resizeObserverGlobal.ResizeObserver = undefined;
});

afterEach(() => {
  cleanup();
  resizeObserverGlobal.ResizeObserver = originalResizeObserver;
});

const containerA: ContainerNode = {
  id: "container-a",
  kind: "container",
  name: "Container A",
  organizationId: "org-1",
  parentId: null,
  syncState: syncedContainerDocumentObjectSyncState,
};

const containerB: ContainerNode = {
  id: "container-b",
  kind: "container",
  name: "Container B",
  organizationId: "org-1",
  parentId: null,
  syncState: syncedContainerDocumentObjectSyncState,
};

const alphaNoteRow: ContainerItemRow = {
  containerId: containerA.id,
  createdAt: null,
  documentId: "alpha-doc",
  documentKind: "note",
  itemKind: "document",
  localId: "alpha-local",
  name: "Alpha Note",
  syncState: syncedContainerDocumentObjectSyncState,
  updatedAt: null,
};

type ContainerItemWindow = Awaited<
  ReturnType<ContainerDocumentQueries["listContainerItemWindow"]>
>;

interface DeferredItemWindow {
  reject: (error: Error) => void;
  resolve: (window: ContainerItemWindow) => void;
}

function createDeferredDocumentQueries() {
  const pending: DeferredItemWindow[] = [];
  const documentQueries = {
    listContainerItemWindow: () =>
      new Promise<ContainerItemWindow>((resolve, reject) => {
        pending.push({ reject, resolve });
      }),
  } as unknown as ContainerDocumentQueries;
  return { documentQueries, pending };
}

const idleUploadManager: ExplorerUploadManager = {
  cancel: () => undefined,
  cancelForContainer: () => undefined,
  isImporting: false,
  items: [],
  queuedFileCount: 0,
  queuedFileCounts: new Map(),
  run: null,
  startImport: () => undefined,
};

function renderContainerDetail(params: {
  documentQueries: ContainerDocumentQueries;
  documentListRevision?: number;
  selectedNode?: ContainerNode;
}) {
  return {
    documentListRevision: params.documentListRevision ?? 0,
    documentQueries: params.documentQueries,
    selectedNode: params.selectedNode ?? containerA,
  };
}

function containerDetailElement(props: {
  documentQueries: ContainerDocumentQueries;
  documentListRevision: number;
  selectedNode: ContainerNode;
  uploadManager?: ExplorerUploadManager;
}) {
  return (
    <ExplorerContainerDetail
      containerNodes={[containerA, containerB]}
      contactAvatarUrlByLocalId={{}}
      contextTarget={null}
      currentOrganizationId="org-1"
      currentSigningFingerprint={null}
      currentSelfContactLocalId={null}
      currentUserId={null}
      documentListRevision={props.documentListRevision}
      documentQueries={props.documentQueries}
      uploadManager={props.uploadManager ?? idleUploadManager}
      online
      onContainerContextMenu={() => undefined}
      onItemContextMenu={() => undefined}
      refreshError={null}
      selectDocumentProjection={() => undefined}
      selectedNode={props.selectedNode}
      setSelectedId={() => undefined}
      visibleSystemSlots={new Set()}
    />
  );
}

async function settlePendingItemWindow(
  pending: DeferredItemWindow[],
  window: ContainerItemWindow,
) {
  const deferred = pending.shift();
  if (!deferred) {
    throw new Error("Expected a pending listContainerItemWindow call.");
  }

  await act(async () => {
    deferred.resolve(window);
  });
}

test("an empty container keeps No items. on refetches instead of flashing the loading row", async () => {
  const { documentQueries, pending } = createDeferredDocumentQueries();
  const props = renderContainerDetail({ documentQueries });
  const view = render(containerDetailElement(props));

  // The first load has nothing settled to show, so the loading row is right.
  expect(view.getByText("Loading...")).toBeTruthy();
  expect(view.queryByText(EXPLORER_LABELS.itemTableEmpty)).toBeNull();

  await settlePendingItemWindow(pending, { rows: [], totalCount: 0 });
  expect(view.getByText(EXPLORER_LABELS.itemTableEmpty)).toBeTruthy();

  // A convergence-driven refetch (list revision bump) starts a new fetch; the
  // settled empty state must hold on screen while it is in flight.
  view.rerender(containerDetailElement({ ...props, documentListRevision: 1 }));
  expect(pending.length).toBe(1);
  expect(view.queryByText("Loading...")).toBeNull();
  expect(view.getByText(EXPLORER_LABELS.itemTableEmpty)).toBeTruthy();

  await settlePendingItemWindow(pending, { rows: [], totalCount: 0 });
  expect(view.queryByText("Loading...")).toBeNull();
  expect(view.getByText(EXPLORER_LABELS.itemTableEmpty)).toBeTruthy();
});

test("a refetch that discovers items replaces the empty state with rows", async () => {
  const { documentQueries, pending } = createDeferredDocumentQueries();
  const props = renderContainerDetail({ documentQueries });
  const view = render(containerDetailElement(props));

  await settlePendingItemWindow(pending, { rows: [], totalCount: 0 });
  expect(view.getByText(EXPLORER_LABELS.itemTableEmpty)).toBeTruthy();

  view.rerender(containerDetailElement({ ...props, documentListRevision: 1 }));
  await settlePendingItemWindow(pending, {
    rows: [alphaNoteRow],
    totalCount: 1,
  });

  expect(view.getByRole("button", { name: alphaNoteRow.name })).toBeTruthy();
  expect(view.queryByText(EXPLORER_LABELS.itemTableEmpty)).toBeNull();
});

test("switching containers shows the loading row, not the previous container's state", async () => {
  const { documentQueries, pending } = createDeferredDocumentQueries();
  const props = renderContainerDetail({ documentQueries });
  const view = render(containerDetailElement(props));

  await settlePendingItemWindow(pending, {
    rows: [alphaNoteRow],
    totalCount: 1,
  });
  expect(view.getByRole("button", { name: alphaNoteRow.name })).toBeTruthy();

  view.rerender(containerDetailElement({ ...props, selectedNode: containerB }));
  expect(view.getByText("Loading...")).toBeTruthy();
  expect(view.queryByRole("button", { name: alphaNoteRow.name })).toBeNull();
  expect(view.queryByText(EXPLORER_LABELS.itemTableEmpty)).toBeNull();

  await settlePendingItemWindow(pending, { rows: [], totalCount: 0 });
  expect(view.getByText(EXPLORER_LABELS.itemTableEmpty)).toBeTruthy();
});

test("a failed initial load shows the error instead of a stuck loading row", async () => {
  const { documentQueries, pending } = createDeferredDocumentQueries();
  const props = renderContainerDetail({ documentQueries });
  const view = render(containerDetailElement(props));

  const deferred = pending.shift();
  if (!deferred) {
    throw new Error("Expected a pending listContainerItemWindow call.");
  }

  await act(async () => {
    deferred.reject(new Error("query exploded"));
  });

  expect(view.queryByText("Loading...")).toBeNull();
  expect(view.getByText("query exploded")).toBeTruthy();
});

test("an active import in this container shows the status line and a working cancel", async () => {
  const { documentQueries, pending } = createDeferredDocumentQueries();
  const cancelledContainerIds: string[] = [];
  const runningUploadManager: ExplorerUploadManager = {
    ...idleUploadManager,
    cancelForContainer: (containerId) => {
      cancelledContainerIds.push(containerId);
    },
    isImporting: true,
    run: {
      containerId: containerA.id,
      error: null,
      progress: {
        completedCount: 1,
        failedCount: 0,
        importedCount: 1,
        totalCount: 3,
      },
      status: "running",
    },
  };
  const props = renderContainerDetail({ documentQueries });
  const view = render(
    containerDetailElement({ ...props, uploadManager: runningUploadManager }),
  );
  await settlePendingItemWindow(pending, { rows: [], totalCount: 0 });

  expect(view.getByText("Importing 1/3 files...")).toBeTruthy();
  fireEvent.click(
    view.getByRole("button", { name: EXPLORER_LABELS.fileImportCancelAction }),
  );
  // The button cancels for THIS container, never the global queue.
  expect(cancelledContainerIds).toEqual([containerA.id]);

  // The same run must NOT surface in a different container's detail panel.
  view.rerender(
    containerDetailElement({
      ...props,
      selectedNode: containerB,
      uploadManager: runningUploadManager,
    }),
  );
  expect(view.queryByText("Importing 1/3 files...")).toBeNull();
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.fileImportCancelAction,
    }),
  ).toBeNull();
});
