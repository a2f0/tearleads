import { afterEach, expect, test } from "bun:test";
import type {
  ContainerDocumentQueries,
  ContainerNode,
} from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import { buildExplorerTree, useExplorerSidebarPanel } from "./ExplorerTree";

afterEach(() => cleanup());

const rootNode: ContainerNode = {
  id: "root-container",
  kind: "container",
  name: "Root",
  organizationId: "org-1",
  parentId: null,
  syncState: syncedContainerDocumentObjectSyncState,
};

const documentQueries: ContainerDocumentQueries = {
  applyContainerDocumentTombstones: async () => [],
  listContainerDocumentSidebarWindow: async () => ({ rows: [], totalCount: 0 }),
  listContainerItemWindow: async () => ({ rows: [], totalCount: 0 }),
  loadContainerDocumentWatermark: async () => null,
  loadDocumentSyncState: async () => null,
  loadDocumentSummary: async () => null,
  listLinkedContainerIdsByDocumentIds: async () => new Map(),
  replaceDocumentLinks: async () => undefined,
  replaceDocumentLinksBatch: async () => undefined,
  saveContainerDocumentWatermark: async () => undefined,
  upsertDiscoveredDocuments: async () => [],
};

function SidebarContextMenuHarness(params: {
  onContainerContextMenu: (containerId: string) => void;
}) {
  const nodes = useMemo(() => [rootNode], []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState<ReactNode>(null);
  const collapsedIds = useMemo(() => new Set<string>(), []);
  const treeEntries = useMemo(() => buildExplorerTree(nodes), [nodes]);
  const handleSidebarContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, containerId: string) => {
      event.preventDefault();
      params.onContainerContextMenu(containerId);
    },
    [params.onContainerContextMenu],
  );
  const handleSidebarDocumentContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
    },
    [],
  );
  const selectDocumentProjection = useCallback((localId: string) => {
    setSelectedId(localId);
  }, []);
  const toggleCollapsed = useCallback(() => undefined, []);

  useExplorerSidebarPanel({
    activeContainerId: rootNode.id,
    collapsedIds,
    currentOrganizationId: rootNode.organizationId,
    documentLinkProjectionVersion: 0,
    documentListRevision: 0,
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

test("explorer sidebar opens the root context menu from blank space", async () => {
  const containerIds: string[] = [];
  const view = render(
    <SidebarContextMenuHarness
      onContainerContextMenu={(containerId) => {
        containerIds.push(containerId);
      }}
    />,
  );

  await waitFor(() => {
    expect(view.getByRole("button", { name: "Root" })).toBeTruthy();
  });
  const sidebarViewport = view.container.querySelector(
    ".explorer-sidebar-viewport",
  );
  if (!sidebarViewport) {
    throw new Error("Expected explorer sidebar viewport.");
  }

  const defaultAllowed = fireEvent.contextMenu(sidebarViewport);

  expect(defaultAllowed).toBe(false);
  expect(containerIds).toEqual([rootNode.id]);
});
