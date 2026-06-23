import { afterEach, beforeEach, expect, test } from "bun:test";
import type {
  ContainerDocumentQueries,
  ContainerNode,
  ContainerDocumentSidebarRow as SidebarRow,
} from "@tearleads/client-sdk";
import {
  createContainerDocumentObjectSyncState,
  syncedContainerDocumentObjectSyncState as syncedState,
} from "@tearleads/client-sdk";
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
import {
  buildExplorerTree,
  getExplorerSidebarWindowRange,
  useExplorerSidebarPanel,
} from "./ExplorerTree";

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
): SidebarRow[] {
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
  rowsByContainerId: ReadonlyMap<string, ReadonlyArray<SidebarRow>>,
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
    loadContainerDocumentWatermark: async () => null,
    loadDocumentSyncState: async () => null,
    loadDocumentSummary: async () => null,
    listLinkedContainerIdsByDocumentIds: async () => new Map(),
    replaceDocumentLinksBatch: async () => undefined,
    saveContainerDocumentWatermark: async () => undefined,
    upsertDiscoveredDocuments: async () => [],
  };
}

function createRowsByContainerId(rows: SidebarRow[]) {
  return new Map([["root-container", rows]]);
}

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
  // Stable identity prevents render loops in useRegisteredWindowSidebar.
  const onRetryDatabase = useCallback(() => undefined, []);
  const treeEntries = useMemo(() => buildExplorerTree(nodes), [nodes]);

  useExplorerSidebarPanel({
    activeContainerId: "root-container",
    collapsedIds,
    currentOrganizationId: "org-1",
    currentSigningFingerprint: null,
    currentUserId: null,
    databaseError: false,
    onRetryDatabase,
    documentLinkProjectionVersion: 0,
    documentListRevision,
    documentQueries,
    handleSidebarContextMenu,
    handleSidebarDocumentContextMenu,
    nodes,
    online: true,
    ready: true,
    selectedId,
    selectDocumentProjection,
    setSelectedId,
    setSidebar,
    toggleCollapsed,
    treeEntries,
  });

  return <div>{sidebar}</div>;
}

test("explorer sidebar requests new document windows as the sidebar scrolls", async () => {
  const calls: WindowCall[] = [];
  const documentQueries = createDocumentQueries(
    createRowsByContainerId(createSidebarRows(80)),
    calls,
  );
  const view = render(
    <ExplorerSidebarHarness documentQueries={documentQueries} />,
  );

  await waitFor(() => {
    expect(calls).toContainEqual({
      containerId: "root-container",
      limit: 24,
      offset: 0,
    });
  });
  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Document 25" })).toBeNull();

  const sidebarViewport = view.container.querySelector<HTMLDivElement>(
    ".explorer-sidebar-viewport",
  );
  expect(sidebarViewport).toBeTruthy();
  if (!sidebarViewport) {
    throw new Error("Explorer sidebar viewport was not rendered.");
  }

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
  const view = render(
    <ExplorerSidebarHarness
      documentQueries={documentQueries}
      nodes={childNodes}
    />,
  );

  await waitFor(() => {
    expect(calls).toContainEqual({
      containerId: "child-container",
      limit: 24,
      offset: 0,
    });
  });

  const sidebarViewport = view.container.querySelector<HTMLDivElement>(
    ".explorer-sidebar-viewport",
  );
  expect(sidebarViewport).toBeTruthy();
  if (!sidebarViewport) {
    throw new Error("Explorer sidebar viewport was not rendered.");
  }

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

test("explorer sidebar renders Phosphor folder icons for containers", async () => {
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
  ];
  const documentQueries = createDocumentQueries(
    new Map([
      ["child-container", []],
      ["root-container", []],
    ]),
    [],
  );
  const view = render(
    <ExplorerSidebarHarness
      documentQueries={documentQueries}
      nodes={childNodes}
    />,
  );

  const rootButton = await view.findByRole("button", { name: "Root" });
  const rootIcon = rootButton.querySelector(".explorer-folder-icon");
  expect(rootIcon?.getAttribute("data-icon")).toBe("folder-open");

  const childButton = await view.findByRole("button", { name: "Child" });
  const childIcon = childButton.querySelector(".explorer-folder-icon");
  expect(childIcon?.getAttribute("data-container-icon")).toBe("folder");
  expect(childIcon?.getAttribute("data-icon")).toBe("folder");

  view.unmount();

  const collapsedView = render(
    <ExplorerSidebarHarness
      collapsedIds={new Set(["root-container"])}
      documentQueries={documentQueries}
      nodes={childNodes}
    />,
  );
  const collapsedRootButton = await collapsedView.findByRole("button", {
    name: "Root",
  });
  const collapsedRootIcon = collapsedRootButton.querySelector(
    ".explorer-folder-icon",
  );
  expect(collapsedRootIcon?.getAttribute("data-icon")).toBe("folder");
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
  const view = render(
    <ExplorerSidebarHarness documentQueries={documentQueries} />,
  );

  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();
  const sidebarViewport = view.container.querySelector<HTMLDivElement>(
    ".explorer-sidebar-viewport",
  );
  expect(sidebarViewport).toBeTruthy();
  if (!sidebarViewport) {
    throw new Error("Explorer sidebar viewport was not rendered.");
  }

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
  const view = render(
    <ExplorerSidebarHarness documentQueries={documentQueries} />,
  );

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
  const view = render(
    <ExplorerSidebarHarness
      documentQueries={documentQueries}
      onDocumentContextMenu={(localId, containerId) => {
        calls.push({ containerId, localId });
      }}
    />,
  );

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
  const view = render(
    <ExplorerSidebarHarness documentQueries={documentQueries} />,
  );

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
  const view = render(
    <ExplorerSidebarHarness
      documentListRevision={0}
      documentQueries={documentQueries}
    />,
  );

  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();

  view.rerender(
    <ExplorerSidebarHarness
      documentListRevision={1}
      documentQueries={documentQueries}
    />,
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
  const view = render(
    <ExplorerSidebarHarness documentQueries={documentQueries} />,
  );

  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();
  expect(calls).toEqual([
    { containerId: "root-container", limit: 0, offset: 0 },
    { containerId: "root-container", limit: 24, offset: 0 },
  ]);

  view.rerender(
    <ExplorerSidebarHarness
      collapsedIds={new Set(["root-container"])}
      documentQueries={documentQueries}
    />,
  );
  expect(view.queryByRole("button", { name: "Document 1" })).toBeNull();

  view.rerender(
    <ExplorerSidebarHarness
      collapsedIds={new Set()}
      documentQueries={documentQueries}
    />,
  );

  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();
  expect(calls).toEqual([
    { containerId: "root-container", limit: 0, offset: 0 },
    { containerId: "root-container", limit: 24, offset: 0 },
  ]);
});

test("explorer sidebar does not reserve hidden sync badge space for synced rows", async () => {
  const documentQueries = createDocumentQueries(
    createRowsByContainerId(createSidebarRows(1)),
    [],
  );
  const view = render(
    <ExplorerSidebarHarness documentQueries={documentQueries} />,
  );

  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();
  expect(
    view.container.querySelectorAll(".explorer-sync-badge--placeholder").length,
  ).toBe(0);
});

test("explorer sidebar keeps visible sync badges for unsynced rows", async () => {
  const rows = createSidebarRows(1).map((row) => ({
    ...row,
    syncState: createContainerDocumentObjectSyncState({ localOnly: true }),
  }));
  const documentQueries = createDocumentQueries(
    createRowsByContainerId(rows),
    [],
  );
  const view = render(
    <ExplorerSidebarHarness documentQueries={documentQueries} />,
  );

  await waitFor(() => {
    expect(
      view.container.querySelector<HTMLButtonElement>(
        '[data-document-local-id="root-container-document-1"]',
      ),
    ).toBeTruthy();
  });
  expect(view.getByRole("img", { name: "Local" })).toBeTruthy();
});
