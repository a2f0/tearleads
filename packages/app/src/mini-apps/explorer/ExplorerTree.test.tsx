import { afterEach, beforeEach, expect, test } from "bun:test";
import type {
  ContainerDocumentQueries,
  ContainerNode,
  ContainerDocumentSidebarRow as Row,
} from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState as syncedState } from "@tearleads/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import { WindowStateProvider } from "../../components/window/WindowStateProvider";
import { AppNavigationProvider } from "../../navigation/AppNavigationProvider";
import type { MiniAppDefinition, MiniAppId } from "../types";
import { useExplorerSidebarPanel } from "./ExplorerTree";
import {
  buildExplorerTree,
  getExplorerSidebarWindowRange,
} from "./explorerTreeModel";

const resizeObserverGlobal = globalThis as unknown as {
  ResizeObserver?: unknown;
};
const originalResizeObserver = resizeObserverGlobal.ResizeObserver;

beforeEach(() => {
  resizeObserverGlobal.ResizeObserver = undefined;
});

afterEach(() => {
  cleanup();
  resizeObserverGlobal.ResizeObserver = originalResizeObserver;
});
const defaultNodes: ContainerNode[] = [
  {
    id: "root-container",
    kind: "container",
    name: "Root",
    organizationId: "org-1",
    parentId: null,
    syncState: syncedState,
  },
];
interface WindowCall {
  containerId: string;
  limit: number;
  offset: number;
}

function createSidebarRows(
  count: number,
  containerId = "root-container",
): Row[] {
  return Array.from({ length: count }, (_, index) => {
    const rowNumber = index + 1;
    return {
      containerId,
      documentId: `remote-${containerId}-document-${rowNumber}`,
      documentKind: "note",
      localId: `${containerId}-document-${rowNumber}`,
      syncState: syncedState,
      title: `Document ${rowNumber}`,
      updatedAt: `2026-05-17T00:${String(index).padStart(2, "0")}:00.000Z`,
    };
  });
}

function createDocumentQueries(
  rowsByContainerId: ReadonlyMap<string, ReadonlyArray<Row>>,
  calls: WindowCall[],
): ContainerDocumentQueries {
  return {
    applyContainerDocumentTombstones: async () => [],
    listContainerDocumentSidebarWindow: async ({
      containerId,
      limit,
      offset,
    }) => {
      calls.push({ containerId, limit, offset });
      const rows = rowsByContainerId.get(containerId) ?? [];
      return {
        rows: rows.slice(offset, offset + limit),
        totalCount: rows.length,
      };
    },
    listContainerItemWindow: async () => ({ rows: [], totalCount: 0 }),
    listPendingWrites: async () => [],
    retryPendingWriteItem: async () => undefined,
    loadContainerDocumentWatermark: async () => null,
    loadDocumentSyncState: async () => null,
    loadDocumentSummary: async () => null,
    listLinkedContainerIdsByDocumentIds: async () => new Map(),
    replaceDocumentLinksBatch: async () => undefined,
    saveContainerDocumentWatermark: async () => undefined,
    upsertDiscoveredDocuments: async () => [],
  };
}

function createRowsByContainerId(rows: Row[]) {
  return new Map([["root-container", rows]]);
}

const NO_ORGANIZATION_NAMES: ReadonlyMap<string, string> = new Map();
const NO_CONTAINER_VERSIONS: ReadonlyMap<string, number> = new Map();
// Stable identity, for the same reason as NO_CONTAINER_VERSIONS: the sidebar
// memoizes on this prop, so an inline literal would loop the registration.
const NO_CONTACT_AVATAR_URLS: Readonly<Record<string, string>> = {};
const TEST_MINI_APPS = {} as Readonly<Record<MiniAppId, MiniAppDefinition>>;

function ExplorerSidebarHarness(params: {
  collapsedIds?: ReadonlySet<string>;
  documentListRevision?: number;
  documentQueries: ContainerDocumentQueries;
  nodes?: ReadonlyArray<ContainerNode>;
  onDocumentContextMenu?: (localId: string, containerId: string) => void;
}) {
  const {
    collapsedIds: collapsedIdsParam,
    documentListRevision = 0,
    documentQueries,
    nodes = defaultNodes,
    onDocumentContextMenu,
  } = params;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState<ReactNode>(null);
  const collapsedIds = useMemo(
    () => collapsedIdsParam ?? new Set<string>(),
    [collapsedIdsParam],
  );
  const handleSidebarContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => event.preventDefault(),
    [],
  );
  const handleSidebarDocumentContextMenu = useCallback(
    (
      event: ReactMouseEvent<HTMLButtonElement>,
      localId: string,
      containerId: string,
    ) => {
      event.preventDefault();
      onDocumentContextMenu?.(localId, containerId);
    },
    [onDocumentContextMenu],
  );
  const selectDocumentProjection = useCallback((localId: string) => {
    setSelectedId(localId);
  }, []);
  const toggleCollapsed = useCallback(() => undefined, []);
  const onRetryDatabase = useCallback(() => undefined, []);
  const treeEntries = useMemo(() => buildExplorerTree(nodes), [nodes]);

  useExplorerSidebarPanel({
    activeContainerId: "root-container",
    collapsedIds,
    contactAvatarUrlByLocalId: NO_CONTACT_AVATAR_URLS,
    currentSigningFingerprint: null,
    currentSelfContactLocalId: null,
    currentUserId: null,
    databaseError: false,
    onRetryDatabase,
    documentLinkProjectionVersion: 0,
    documentLinkProjectionVersionByContainerId: NO_CONTAINER_VERSIONS,
    documentListRevision,
    documentQueries,
    handleSidebarContextMenu,
    handleSidebarDocumentContextMenu,
    nodes,
    ready: true,
    organizationNamesById: NO_ORGANIZATION_NAMES,
    primaryOrganizationId: "org-1",
    selectedId,
    selectDocumentProjection,
    setSelectedId,
    setSidebar,
    toggleCollapsed,
    treeEntries,
  });

  return <div>{sidebar}</div>;
}

type ExplorerSidebarHarnessParams = Parameters<
  typeof ExplorerSidebarHarness
>[0];

function explorerSidebarElement(params: ExplorerSidebarHarnessParams) {
  return (
    <WindowStateProvider>
      <AppNavigationProvider mode="windowed" miniApps={TEST_MINI_APPS}>
        <ExplorerSidebarHarness {...params} />
      </AppNavigationProvider>
    </WindowStateProvider>
  );
}

function renderExplorerSidebar(params: ExplorerSidebarHarnessParams) {
  return render(explorerSidebarElement(params));
}

function getSidebarViewport(view: { container: HTMLElement }) {
  const sidebarViewport = view.container.querySelector<HTMLDivElement>(
    ".explorer-sidebar-viewport",
  );
  if (!sidebarViewport) {
    throw new Error("Explorer sidebar viewport was not rendered.");
  }
  return sidebarViewport;
}

test("explorer sidebar requests new document windows as the sidebar scrolls", async () => {
  const calls: WindowCall[] = [];
  const documentQueries = createDocumentQueries(
    createRowsByContainerId(createSidebarRows(80)),
    calls,
  );
  const view = renderExplorerSidebar({ documentQueries });

  await waitFor(() => {
    expect(calls).toContainEqual({
      containerId: "root-container",
      limit: 24,
      offset: 0,
    });
  });
  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Document 25" })).toBeNull();

  const sidebarViewport = getSidebarViewport(view);

  sidebarViewport.scrollTop = 840;
  fireEvent.scroll(sidebarViewport);

  await waitFor(() => {
    expect(calls).toContainEqual({
      containerId: "root-container",
      limit: 24,
      offset: 21,
    });
  });
  expect(await view.findByRole("button", { name: "Document 22" })).toBeTruthy();
});

test("explorer sidebar window range follows row height with overscan", () => {
  expect(
    getExplorerSidebarWindowRange({ scrollTop: -100, viewportHeight: 0 }),
  ).toEqual({ limit: 24, offset: 0 });
  expect(
    getExplorerSidebarWindowRange({ scrollTop: 840, viewportHeight: 280 }),
  ).toEqual({ limit: 26, offset: 22 });
});

test("explorer sidebar scroll requests windows for each folder independently", async () => {
  const childNodes: ContainerNode[] = [
    ...defaultNodes,
    {
      id: "child-container",
      kind: "container",
      name: "Child",
      organizationId: "org-1",
      parentId: "root-container",
      syncState: syncedState,
    },
  ];
  const calls: WindowCall[] = [];
  const documentQueries = createDocumentQueries(
    new Map([
      ["child-container", createSidebarRows(80, "child-container")],
      ["root-container", createSidebarRows(5)],
    ]),
    calls,
  );
  const view = renderExplorerSidebar({ documentQueries, nodes: childNodes });

  await waitFor(() => {
    expect(calls).toContainEqual({
      containerId: "child-container",
      limit: 24,
      offset: 0,
    });
  });

  const sidebarViewport = getSidebarViewport(view);

  sidebarViewport.scrollTop = 840;
  fireEvent.scroll(sidebarViewport);

  await waitFor(() => {
    expect(calls).toContainEqual({
      containerId: "child-container",
      limit: 24,
      offset: 20,
    });
  });
  expect(
    calls.some(
      (call) => call.containerId === "root-container" && call.offset === 20,
    ),
  ).toBe(false);
});

test("explorer sidebar renders configured Phosphor icons for containers", async () => {
  const childNodes: ContainerNode[] = [
    ...defaultNodes,
    {
      id: "child-container",
      icon: "folder",
      kind: "container",
      name: "Child",
      organizationId: "org-1",
      parentId: "root-container",
      syncState: syncedState,
    },
    {
      id: "trash-container",
      icon: "trash",
      kind: "container",
      name: "Trash",
      organizationId: "org-1",
      parentId: "root-container",
      syncState: syncedState,
    },
  ];
  const documentQueries = createDocumentQueries(
    new Map([
      ["child-container", []],
      ["root-container", []],
      ["trash-container", []],
    ]),
    [],
  );
  const view = renderExplorerSidebar({ documentQueries, nodes: childNodes });

  const rootButton = await view.findByRole("button", { name: "Root" });
  const rootIcon = rootButton.querySelector(".explorer-folder-icon");
  expect(rootIcon?.getAttribute("data-icon")).toBe("folder-open");

  const childButton = await view.findByRole("button", { name: "Child" });
  const childIcon = childButton.querySelector(".explorer-folder-icon");
  expect(childIcon?.getAttribute("data-container-icon")).toBe("folder");
  expect(childIcon?.getAttribute("data-icon")).toBe("folder");

  const trashButton = await view.findByRole("button", { name: "Trash" });
  const trashIcon = trashButton.querySelector(".explorer-folder-icon");
  expect(trashIcon?.getAttribute("data-container-icon")).toBe("trash");
  expect(trashIcon?.getAttribute("data-icon")).toBe("trash");

  view.unmount();

  const collapsedView = renderExplorerSidebar({
    collapsedIds: new Set(["root-container"]),
    documentQueries,
    nodes: childNodes,
  });
  const collapsedRootButton = await collapsedView.findByRole("button", {
    name: "Root",
  });
  const collapsedRootIcon = collapsedRootButton.querySelector(
    ".explorer-folder-icon",
  );
  expect(collapsedRootIcon?.getAttribute("data-icon")).toBe("folder");
});

test("explorer sidebar renders document type icons for documents", async () => {
  const documentQueries = createDocumentQueries(
    createRowsByContainerId(createSidebarRows(1)),
    [],
  );
  const view = renderExplorerSidebar({ documentQueries });

  const documentButton = await view.findByRole("button", {
    name: "Document 1",
  });
  const documentIcon = documentButton.querySelector(".explorer-document-icon");
  expect(documentIcon?.getAttribute("data-icon")).toBe("note");
});

test("explorer sidebar ignores stale document windows during fast scrolling", async () => {
  const rows = createSidebarRows(90);
  const calls: WindowCall[] = [];
  let resolveFirstScroll:
    | ((
        value: Awaited<
          ReturnType<
            ContainerDocumentQueries["listContainerDocumentSidebarWindow"]
          >
        >,
      ) => void)
    | undefined;
  let resolveSecondScroll:
    | ((
        value: Awaited<
          ReturnType<
            ContainerDocumentQueries["listContainerDocumentSidebarWindow"]
          >
        >,
      ) => void)
    | undefined;
  const documentQueries = {
    ...createDocumentQueries(createRowsByContainerId(rows), calls),
    listContainerDocumentSidebarWindow: async ({
      containerId,
      limit,
      offset,
    }) => {
      calls.push({ containerId, limit, offset });
      if (offset === 21) {
        return new Promise((resolve) => {
          resolveFirstScroll = resolve;
        });
      }
      if (offset === 41) {
        return new Promise((resolve) => {
          resolveSecondScroll = resolve;
        });
      }

      return {
        rows: rows.slice(offset, offset + limit),
        totalCount: rows.length,
      };
    },
  } satisfies ContainerDocumentQueries;
  const view = renderExplorerSidebar({ documentQueries });

  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();
  const sidebarViewport = getSidebarViewport(view);

  sidebarViewport.scrollTop = 840;
  fireEvent.scroll(sidebarViewport);
  await waitFor(() => {
    expect(calls).toContainEqual({
      containerId: "root-container",
      limit: 24,
      offset: 21,
    });
  });

  sidebarViewport.scrollTop = 1400;
  fireEvent.scroll(sidebarViewport);
  await waitFor(() => {
    expect(calls).toContainEqual({
      containerId: "root-container",
      limit: 24,
      offset: 41,
    });
  });

  await act(async () => {
    resolveSecondScroll?.({
      rows: rows.slice(41, 65),
      totalCount: rows.length,
    });
  });
  expect(await view.findByRole("button", { name: "Document 60" })).toBeTruthy();

  await act(async () => {
    resolveFirstScroll?.({
      rows: rows.slice(21, 45),
      totalCount: rows.length,
    });
  });
  expect(view.getByRole("button", { name: "Document 60" })).toBeTruthy();
});

test("explorer sidebar shows loading feedback during the first document window request", async () => {
  const calls: WindowCall[] = [];
  const rows = createSidebarRows(1);
  let resolveWindow:
    | ((
        value: Awaited<
          ReturnType<
            ContainerDocumentQueries["listContainerDocumentSidebarWindow"]
          >
        >,
      ) => void)
    | undefined;
  const documentQueries = {
    ...createDocumentQueries(createRowsByContainerId(rows), calls),
    listContainerDocumentSidebarWindow: async ({
      containerId,
      limit,
      offset,
    }) => {
      calls.push({ containerId, limit, offset });
      return new Promise((resolve) => {
        resolveWindow = resolve;
      });
    },
  } satisfies ContainerDocumentQueries;
  const view = renderExplorerSidebar({ documentQueries });

  const loadingButton = await view.findByRole("button", { name: "Loading..." });
  expect((loadingButton as HTMLButtonElement).disabled).toBe(true);
  expect(calls).toContainEqual({
    containerId: "root-container",
    limit: 24,
    offset: 0,
  });

  await act(async () => {
    resolveWindow?.({
      rows,
      totalCount: rows.length,
    });
  });

  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();
});

test("explorer sidebar forwards document context-menu events with document and container ids", async () => {
  const calls: Array<{ containerId: string; localId: string }> = [];
  const documentQueries = createDocumentQueries(
    createRowsByContainerId(createSidebarRows(1)),
    [],
  );
  const view = renderExplorerSidebar({
    documentQueries,
    onDocumentContextMenu: (localId, containerId) => {
      calls.push({ containerId, localId });
    },
  });

  fireEvent.contextMenu(
    await view.findByRole("button", { name: "Document 1" }),
  );

  expect(calls).toEqual([
    { containerId: "root-container", localId: "root-container-document-1" },
  ]);
});

test("explorer sidebar can retry a failed initial document window", async () => {
  const calls: WindowCall[] = [];
  const rows = createSidebarRows(1);
  const documentQueries = {
    ...createDocumentQueries(createRowsByContainerId(rows), calls),
    listContainerDocumentSidebarWindow: async ({
      containerId,
      limit,
      offset,
    }) => {
      calls.push({ containerId, limit, offset });
      if (calls.length <= 2) {
        throw new Error("window failed");
      }

      return {
        rows: rows.slice(offset, offset + limit),
        totalCount: rows.length,
      };
    },
  } satisfies ContainerDocumentQueries;
  const view = renderExplorerSidebar({ documentQueries });

  fireEvent.click(await view.findByRole("button", { name: "Retry" }));

  await waitFor(() => {
    expect(calls).toContainEqual({
      containerId: "root-container",
      limit: 24,
      offset: 0,
    });
  });
  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();
});

test("explorer sidebar keeps existing documents visible during document list refreshes", async () => {
  const rows = createSidebarRows(1);
  const refreshedRows = rows.map((row) => ({
    ...row,
    title: "Renamed Document",
  }));
  const calls: WindowCall[] = [];
  let resolveRefresh:
    | ((
        value: Awaited<
          ReturnType<
            ContainerDocumentQueries["listContainerDocumentSidebarWindow"]
          >
        >,
      ) => void)
    | undefined;
  const documentQueries = {
    ...createDocumentQueries(createRowsByContainerId(rows), calls),
    listContainerDocumentSidebarWindow: async ({
      containerId,
      limit,
      offset,
    }) => {
      calls.push({ containerId, limit, offset });
      if (calls.length <= 2) {
        return {
          rows: rows.slice(offset, offset + limit),
          totalCount: rows.length,
        };
      }

      return new Promise((resolve) => {
        resolveRefresh = resolve;
      });
    },
  } satisfies ContainerDocumentQueries;
  const view = renderExplorerSidebar({
    documentListRevision: 0,
    documentQueries,
  });

  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();

  view.rerender(
    explorerSidebarElement({
      documentListRevision: 1,
      documentQueries,
    }),
  );

  await waitFor(() => {
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });
  expect(view.getByRole("button", { name: "Document 1" })).toBeTruthy();

  await act(async () => {
    resolveRefresh?.({
      rows: refreshedRows,
      totalCount: rows.length,
    });
  });
  expect(
    await view.findByRole("button", { name: "Renamed Document" }),
  ).toBeTruthy();
});

test("explorer sidebar does not refresh loaded documents on collapsed state changes", async () => {
  const calls: WindowCall[] = [];
  const documentQueries = createDocumentQueries(
    createRowsByContainerId(createSidebarRows(1)),
    calls,
  );
  const view = renderExplorerSidebar({ documentQueries });

  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();
  expect(calls).toEqual([
    { containerId: "root-container", limit: 0, offset: 0 },
    { containerId: "root-container", limit: 24, offset: 0 },
  ]);

  view.rerender(
    explorerSidebarElement({
      collapsedIds: new Set(["root-container"]),
      documentQueries,
    }),
  );
  expect(view.queryByRole("button", { name: "Document 1" })).toBeNull();

  view.rerender(
    explorerSidebarElement({
      collapsedIds: new Set(),
      documentQueries,
    }),
  );

  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();
  expect(calls).toEqual([
    { containerId: "root-container", limit: 0, offset: 0 },
    { containerId: "root-container", limit: 24, offset: 0 },
  ]);
});
