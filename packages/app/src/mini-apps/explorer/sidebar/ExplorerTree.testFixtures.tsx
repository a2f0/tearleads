import type {
  ContainerDocumentQueries,
  ContainerDocumentSidebarRow,
  ContainerNode,
} from "@tearleads/client-sdk";
import {
  syncedContainerDocumentObjectSyncState,
  syncedContainerDocumentObjectSyncState as syncedState,
} from "@tearleads/client-sdk";
import { WindowStateProvider } from "@tearleads/windowing";
import { type RenderResult, render } from "@testing-library/react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import { AppNavigationProvider } from "../../../navigation/AppNavigationProvider";
import type { MiniAppDefinition, MiniAppId } from "../../types";
import { useExplorerSidebarPanel } from "./ExplorerTree";
import { buildExplorerTree } from "./explorerTreeModel";

export interface ExplorerSidebarWindowCall {
  containerId: string | null;
  limit: number;
  offset: number;
}

export function createExplorerSidebarRows(
  count: number,
  containerId = "root-container",
): ContainerDocumentSidebarRow[] {
  return Array.from({ length: count }, (_, index) => {
    const rowNumber = index + 1;
    return {
      containerId,
      documentId: `remote-${containerId}-document-${rowNumber}`,
      documentKind: "note",
      localId: `${containerId}-document-${rowNumber}`,
      syncState: syncedContainerDocumentObjectSyncState,
      title: `Document ${rowNumber}`,
      updatedAt: `2026-05-17T00:${String(index).padStart(2, "0")}:00.000Z`,
    };
  });
}

export function createExplorerDocumentQueries(
  rowsByContainerId: ReadonlyMap<
    string | null,
    ReadonlyArray<ContainerDocumentSidebarRow>
  >,
  calls: ExplorerSidebarWindowCall[],
): ContainerDocumentQueries {
  return {
    applyContainerDocumentTombstones: async () => [],
    hasOrphanedDocuments: async () => false,
    listRecoveryFolderMoveIds: async () => [],
    listRecoveryFolders: async () => [],
    discardRecoveryFolder: async () => false,
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
    listPendingDownloads: async () => [],
    listPendingWrites: async () => [],
    retryPendingWriteItem: async () => undefined,
    loadContainerDocumentWatermark: async () => null,
    loadDocumentSyncState: async () => null,
    loadDocumentSummary: async () => null,
    loadContainerDocumentSummary: async () => null,
    loadOrphanedDocumentSummary: async () => null,
    listLinkedContainerIdsByDocumentIds: async () => new Map(),
    replaceDocumentLinksBatch: async () => undefined,
    saveContainerDocumentWatermark: async () => undefined,
    upsertDiscoveredDocuments: async () => [],
  };
}

export function createExplorerRowsByContainerId(
  rows: ReadonlyArray<ContainerDocumentSidebarRow>,
) {
  return new Map([["root-container", rows]]);
}

export const defaultNodes: ContainerNode[] = [
  {
    id: "root-container",
    kind: "container",
    name: "Root",
    organizationId: "org-1",
    parentId: null,
    syncState: syncedState,
  },
];

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
  const handleContainerContextMenu = useCallback(
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
    currentOrganizationId: "org-1",
    databaseError: false,
    onRetryDatabase,
    documentLinkProjectionVersion: 0,
    documentLinkProjectionVersionByContainerId: NO_CONTAINER_VERSIONS,
    documentListRevision,
    documentQueries,
    handleContainerContextMenu,
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

export function explorerSidebarElement(params: ExplorerSidebarHarnessParams) {
  return (
    <WindowStateProvider>
      <AppNavigationProvider
        mode="windowed"
        launcher={{ apps: TEST_MINI_APPS }}
      >
        <ExplorerSidebarHarness {...params} />
      </AppNavigationProvider>
    </WindowStateProvider>
  );
}

export function renderExplorerSidebar(
  params: ExplorerSidebarHarnessParams,
): RenderResult {
  return render(explorerSidebarElement(params));
}

export function getSidebarViewport(view: { container: HTMLElement }) {
  const sidebarViewport = view.container.querySelector<HTMLDivElement>(
    ".explorer-sidebar-viewport",
  );
  if (!sidebarViewport) {
    throw new Error("Explorer sidebar viewport was not rendered.");
  }
  return sidebarViewport;
}
