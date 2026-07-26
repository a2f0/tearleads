import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  type ContainerDocumentQueries,
  type ContainerItemRow,
  type ContainerNode,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { MouseEvent } from "react";
import type { ExplorerUploadManager } from "../../hooks/useExplorerUploadManager";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerContainerDetail } from "./ExplorerContainerDetail";

const resizeObserverGlobal = globalThis as unknown as {
  ResizeObserver?: unknown;
};
const originalResizeObserver = resizeObserverGlobal.ResizeObserver;
const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(
  globalThis.HTMLElement?.prototype ?? {},
  "clientWidth",
);

// happy-dom has no layout engine, so every clientWidth is 0 — which the fold
// predicate reads as "not measured" and ignores. Stand in for the layout a
// browser would do. The initial measurement is a direct clientWidth read, so
// this works even with the ResizeObserver disabled above.
function mockFrameWidth(width: number) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => width,
  });
}

// Without a ResizeObserver the virtual window's limit stays fixed, keeping the
// fetch sequence deterministic (one listContainerItemWindow call per trigger).
beforeEach(() => {
  resizeObserverGlobal.ResizeObserver = undefined;
});

afterEach(() => {
  cleanup();
  resizeObserverGlobal.ResizeObserver = originalResizeObserver;
  if (originalClientWidthDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      originalClientWidthDescriptor,
    );
  }
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
  onContainerContextMenu?:
    | ((event: MouseEvent<HTMLElement>, containerId: string) => void)
    | undefined;
  selectedNode: ContainerNode;
  showHeaderSyncIndicator?: boolean | undefined;
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
      onContainerContextMenu={props.onContainerContextMenu ?? (() => undefined)}
      onItemContextMenu={() => undefined}
      refreshError={null}
      selectDocumentProjection={() => undefined}
      selectedNode={props.selectedNode}
      setSelectedId={() => undefined}
      showHeaderSyncIndicator={props.showHeaderSyncIndicator ?? false}
      visibleSystemSlots={new Set()}
    />
  );
}

function headerActionsLabel(node: ContainerNode): string {
  return `${EXPLORER_LABELS.containerHeaderActionsLabel}: ${node.name}`;
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

test("a narrow item list frame folds the rows onto two lines", async () => {
  // A wide viewport in the windowed layout: only the frame's own width is
  // narrow, which is the case a viewport media query cannot see.
  mockFrameWidth(320);
  const { documentQueries, pending } = createDeferredDocumentQueries();
  const props = renderContainerDetail({ documentQueries });
  const view = render(containerDetailElement(props));

  await settlePendingItemWindow(pending, {
    rows: [alphaNoteRow],
    totalCount: 1,
  });

  const frame = view.container.querySelector(".explorer-item-table-wrap");
  if (!(frame instanceof HTMLElement)) {
    throw new Error("Expected the explorer item table frame.");
  }

  expect(frame.classList.contains("mini-app-table-frame--two-line")).toBe(true);
  expect(frame.style.getPropertyValue("--mini-app-virtual-row-height")).toBe(
    "56px",
  );
  expect(
    view.container.querySelector("tbody .explorer-item-summary"),
  ).not.toBeNull();
  // The name button — the selector the screenshot and dual-pane suites rely on
  // — survives the fold.
  expect(view.getByRole("button", { name: alphaNoteRow.name })).toBeTruthy();
  // The kebab is the touch stand-in for right-click, so a windowed pane does
  // not gain one just by folding — it would eat width where width is scarcest.
  expect(
    view.queryByRole("button", {
      name: `${EXPLORER_LABELS.itemActionsButtonPrefix} ${alphaNoteRow.name}`,
    }),
  ).toBeNull();
  expect(view.container.querySelectorAll("thead th")).toHaveLength(1);
});

test("a wide item list frame keeps the single-line columns", async () => {
  mockFrameWidth(900);
  const { documentQueries, pending } = createDeferredDocumentQueries();
  const props = renderContainerDetail({ documentQueries });
  const view = render(containerDetailElement(props));

  await settlePendingItemWindow(pending, {
    rows: [alphaNoteRow],
    totalCount: 1,
  });

  const frame = view.container.querySelector(".explorer-item-table-wrap");
  if (!(frame instanceof HTMLElement)) {
    throw new Error("Expected the explorer item table frame.");
  }

  expect(frame.classList.contains("mini-app-table-frame--two-line")).toBe(
    false,
  );
  expect(frame.style.getPropertyValue("--mini-app-virtual-row-height")).toBe(
    "36px",
  );
  expect(
    view.container.querySelector("tbody .explorer-item-summary"),
  ).toBeNull();
});

test("an unmeasured frame leaves the pitch alone, so the window query runs once", async () => {
  // The guard that keeps this change inert wherever there is no layout: a width
  // of 0 must not fold, and must not move the pitch and re-issue the query.
  const { documentQueries, pending } = createDeferredDocumentQueries();
  const props = renderContainerDetail({ documentQueries });
  const view = render(containerDetailElement(props));

  await settlePendingItemWindow(pending, {
    rows: [alphaNoteRow],
    totalCount: 1,
  });

  expect(pending.length).toBe(0);
  const frame = view.container.querySelector(".explorer-item-table-wrap");
  if (!(frame instanceof HTMLElement)) {
    throw new Error("Expected the explorer item table frame.");
  }
  expect(frame.classList.contains("mini-app-table-frame--two-line")).toBe(
    false,
  );
});

// The folder you are inside has no row of its own in the list it renders, so the
// header's kebab is the only handle on its own actions — and on a root folder,
// the only one anywhere: a root has no parent listing to open it from.
test("the header kebab opens the actions menu for the folder you are inside", () => {
  const { documentQueries } = createDeferredDocumentQueries();
  const opened: string[] = [];
  const onContainerContextMenu = (_event: unknown, containerId: string) => {
    opened.push(containerId);
  };
  const props = renderContainerDetail({ documentQueries });
  const view = render(
    containerDetailElement({ ...props, onContainerContextMenu }),
  );

  fireEvent.click(
    view.getByRole("button", { name: headerActionsLabel(containerA) }),
  );
  expect(opened).toEqual([containerA.id]);

  // Navigating into another folder retargets the same trigger, so the menu can
  // never act on the folder you just left.
  view.rerender(
    containerDetailElement({
      ...props,
      onContainerContextMenu,
      selectedNode: containerB,
    }),
  );
  fireEvent.click(
    view.getByRole("button", { name: headerActionsLabel(containerB) }),
  );
  expect(opened).toEqual([containerA.id, containerB.id]);
  expect(
    view.queryByRole("button", { name: headerActionsLabel(containerA) }),
  ).toBeNull();
});

// The header spreads its children apart, so the kebab shares a trailing group
// with the sync badge rather than being a third child — otherwise the badge
// strands in the middle of the header instead of sitting beside the kebab.
test("the header kebab is the trailing control, after the sync indicator", () => {
  const { documentQueries } = createDeferredDocumentQueries();
  const props = renderContainerDetail({ documentQueries });
  const view = render(
    containerDetailElement({ ...props, showHeaderSyncIndicator: true }),
  );

  const header = view.container.querySelector(".mini-app-header");
  const actions = header?.querySelector(".mini-app-actions");
  if (!header || !actions) {
    throw new Error("Expected the container header and its actions group.");
  }

  expect(actions.lastElementChild).toBe(
    view.getByRole("button", { name: headerActionsLabel(containerA) }),
  );
  expect(actions.children).toHaveLength(2);
  // The identity block and that group are the header's only children, so
  // space-between still pins the folder name left and the controls right.
  expect(header.children).toHaveLength(2);
});
