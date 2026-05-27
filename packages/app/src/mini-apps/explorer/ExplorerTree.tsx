import type {
  ContainerDocumentReadModel,
  ContainerDocumentSidebarRow,
  ContainerNode,
} from "@tearleads/client-sdk";
import {
  Fragment,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MiniAppSidebar,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import {
  MiniAppRowButton,
  MiniAppRowText,
} from "../../components/shared/MiniAppRow";
import { useRegisteredWindowSidebar } from "../../components/window/WindowSidebarContext";
import { ExplorerSyncStateBadge } from "./ExplorerSyncStateBadge";

const EXPLORER_SIDEBAR_DOCUMENT_PAGE_SIZE = 50;

export interface ExplorerTreeEntry {
  children: ExplorerTreeEntry[];
  node: ContainerNode;
}

export function buildExplorerTree(
  nodes: ReadonlyArray<ContainerNode>,
): ExplorerTreeEntry[] {
  const entriesById = new Map<string, ExplorerTreeEntry>();
  for (const node of nodes) {
    entriesById.set(node.id, { children: [], node });
  }

  const roots: ExplorerTreeEntry[] = [];
  for (const entry of entriesById.values()) {
    if (entry.node.parentId && entriesById.has(entry.node.parentId)) {
      entriesById.get(entry.node.parentId)?.children.push(entry);
      continue;
    }

    roots.push(entry);
  }

  function sortEntries(entries: ExplorerTreeEntry[]) {
    entries.sort((left, right) =>
      left.node.name.localeCompare(right.node.name, undefined, {
        sensitivity: "base",
      }),
    );

    for (const entry of entries) {
      sortEntries(entry.children);
    }
  }

  sortEntries(roots);
  return roots;
}

interface ExplorerTreeEntriesProps {
  activeContainerId: string | null;
  collapsedIds: ReadonlySet<string>;
  depth: number;
  documentWindowsByContainerId: ReadonlyMap<
    string,
    ExplorerSidebarDocumentWindowState
  >;
  entries: ReadonlyArray<ExplorerTreeEntry>;
  onLoadMoreDocuments: (containerId: string) => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>, id: string) => void;
  onDocumentContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    localId: string,
    containerId: string,
  ) => void;
  onSelectContainer: (id: string) => void;
  onSelectDocument: (documentId: string, containerId: string) => void;
  onToggleCollapsed: (id: string) => void;
  online: boolean;
  selectedId: string | null;
}

function ExplorerTreeEntries(props: ExplorerTreeEntriesProps): ReactNode {
  return props.entries.map((entry) => (
    <ExplorerTreeEntryNode key={entry.node.id} {...props} entry={entry} />
  ));
}

function ExplorerSidebarItemLabel(params: {
  children: string;
  online: boolean;
  syncState: ContainerNode["syncState"];
}) {
  const showStatusBadge = params.syncState.status !== "synced";

  return (
    <>
      <MiniAppRowText>{params.children}</MiniAppRowText>
      <ExplorerSyncStateBadge
        online={params.online}
        reserveSpace={showStatusBadge}
        syncState={params.syncState}
      />
    </>
  );
}

function ExplorerTreeDocumentRows(
  props: Omit<ExplorerTreeEntriesProps, "entries"> & {
    depth: number;
    rows: ReadonlyArray<ContainerDocumentSidebarRow>;
  },
) {
  return props.rows.map(({ containerId, localId, syncState, title }) => (
    <div
      className="explorer-sidebar-row"
      key={`${localId}:${containerId}`}
      style={{
        paddingLeft: `calc(var(--padding) / 2 + (var(--padding) * ${props.depth}))`,
      }}
    >
      <span className="explorer-node-spacer" aria-hidden="true" />
      <MiniAppRowButton
        data-document-local-id={localId}
        className="explorer-sidebar-item explorer-sidebar-item--note"
        onClick={() => props.onSelectDocument(localId, containerId)}
        onContextMenu={(event) =>
          props.onDocumentContextMenu(event, localId, containerId)
        }
        selected={
          props.selectedId === localId &&
          props.activeContainerId === containerId
        }
      >
        <ExplorerSidebarItemLabel online={props.online} syncState={syncState}>
          {title}
        </ExplorerSidebarItemLabel>
      </MiniAppRowButton>
    </div>
  ));
}

function ExplorerTreeEntryNode(
  props: Omit<ExplorerTreeEntriesProps, "entries"> & {
    entry: ExplorerTreeEntry;
  },
) {
  const {
    collapsedIds,
    depth,
    documentWindowsByContainerId,
    entry,
    onLoadMoreDocuments,
    onContextMenu,
    onSelectContainer,
    onToggleCollapsed,
    online,
    selectedId,
  } = props;
  const hasChildren = entry.children.length > 0;
  const isCollapsed = collapsedIds.has(entry.node.id);
  const isSelected = selectedId === entry.node.id;

  return (
    <Fragment>
      <div
        className="explorer-sidebar-row"
        style={{
          paddingLeft: `calc(var(--padding) / 2 + (var(--padding) * ${depth}))`,
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="explorer-node-toggle"
            aria-label={isCollapsed ? "Expand container" : "Collapse container"}
            aria-expanded={!isCollapsed}
            onClick={() => onToggleCollapsed(entry.node.id)}
          >
            <span
              className={
                "explorer-node-icon" +
                (!isCollapsed ? " explorer-node-icon--expanded" : "")
              }
            >
              {"\u25B6"}
            </span>
          </button>
        ) : (
          <span className="explorer-node-spacer" aria-hidden="true" />
        )}
        <MiniAppRowButton
          className="explorer-sidebar-item"
          onClick={() => onSelectContainer(entry.node.id)}
          onContextMenu={(event) => onContextMenu(event, entry.node.id)}
          selected={isSelected}
        >
          <ExplorerSidebarItemLabel
            online={online}
            syncState={entry.node.syncState}
          >
            {entry.node.name}
          </ExplorerSidebarItemLabel>
        </MiniAppRowButton>
      </div>
      {!isCollapsed && (
        <ExplorerTreeEntries
          {...props}
          depth={depth + 1}
          entries={entry.children}
        />
      )}
      {!isCollapsed ? (
        <ExplorerTreeDocumentRows
          {...props}
          depth={depth + 1}
          rows={documentWindowsByContainerId.get(entry.node.id)?.rows ?? []}
        />
      ) : null}
      {!isCollapsed ? (
        <ExplorerTreeEntryDocumentMoreRow
          depth={depth + 1}
          onLoadMore={() => onLoadMoreDocuments(entry.node.id)}
          state={documentWindowsByContainerId.get(entry.node.id)}
        />
      ) : null}
    </Fragment>
  );
}

interface ExplorerSidebarDocumentWindowState {
  error: string | null;
  isLoading: boolean;
  rows: ReadonlyArray<ContainerDocumentSidebarRow>;
  totalCount: number;
}

function ExplorerTreeEntryDocumentMoreRow(params: {
  depth: number;
  onLoadMore: () => void;
  state: ExplorerSidebarDocumentWindowState | undefined;
}) {
  const { depth, onLoadMore, state } = params;
  if (!state) {
    return null;
  }

  const remainingCount = Math.max(0, state.totalCount - state.rows.length);
  if (!state.isLoading && !state.error && remainingCount === 0) {
    return null;
  }

  const label = state.error
    ? "Retry"
    : state.isLoading
      ? "Loading..."
      : `Load ${Math.min(remainingCount, EXPLORER_SIDEBAR_DOCUMENT_PAGE_SIZE)} more`;

  return (
    <div
      className="explorer-sidebar-row"
      style={{
        paddingLeft: `calc(var(--padding) / 2 + (var(--padding) * ${depth}))`,
      }}
    >
      <span className="explorer-node-spacer" aria-hidden="true" />
      <MiniAppRowButton
        className="explorer-sidebar-item explorer-sidebar-item--more"
        disabled={state.isLoading}
        onClick={onLoadMore}
      >
        <MiniAppRowText>{label}</MiniAppRowText>
      </MiniAppRowButton>
    </div>
  );
}

function listExpandedExplorerTreeContainerIds(
  entries: ReadonlyArray<ExplorerTreeEntry>,
  collapsedIds: ReadonlySet<string>,
): ReadonlyArray<string> {
  const expandedContainerIds: string[] = [];

  function visit(entry: ExplorerTreeEntry) {
    if (collapsedIds.has(entry.node.id)) {
      return;
    }

    expandedContainerIds.push(entry.node.id);
    for (const child of entry.children) {
      visit(child);
    }
  }

  for (const entry of entries) {
    visit(entry);
  }

  return expandedContainerIds;
}

function getExplorerTreeIdSetKey(ids: ReadonlySet<string>): string {
  return Array.from(ids).sort().join("\u0000");
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The sidebar window hook owns paging, reload, and pruning state for a single UI surface.
function useExplorerSidebarDocumentWindows(params: {
  collapsedIds: ReadonlySet<string>;
  documentLinkProjectionVersion: number;
  documentListRevision: number;
  documentReadModel: ContainerDocumentReadModel;
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
  treeEntries: ReadonlyArray<ExplorerTreeEntry>;
}) {
  const {
    collapsedIds,
    documentLinkProjectionVersion,
    documentListRevision,
    documentReadModel,
    nodes,
    ready,
    treeEntries,
  } = params;
  const loadGenerationRef = useRef(0);
  const pendingWindowLoadKeysRef = useRef(new Set<string>());
  const [documentWindowsByContainerId, setDocumentWindowsByContainerId] =
    useState<ReadonlyMap<string, ExplorerSidebarDocumentWindowState>>(
      () => new Map(),
    );
  const collapsedIdsKey = useMemo(
    () => getExplorerTreeIdSetKey(collapsedIds),
    [collapsedIds],
  );
  const expandedContainerIds = useMemo(
    () => listExpandedExplorerTreeContainerIds(treeEntries, collapsedIds),
    [collapsedIds, collapsedIdsKey, treeEntries],
  );
  const expandedContainerIdsKey = expandedContainerIds.join("\u0000");
  const expandedContainerIdsRef = useRef(expandedContainerIds);
  expandedContainerIdsRef.current = expandedContainerIds;
  const validContainerIdsKey = useMemo(
    () => nodes.map((node) => node.id).join("\u0000"),
    [nodes],
  );

  const loadDocumentWindow = useCallback(
    (containerId: string, offset: number) => {
      const generation = loadGenerationRef.current;
      const loadKey = `${generation}\u0000${containerId}\u0000${offset}`;
      if (pendingWindowLoadKeysRef.current.has(loadKey)) {
        return;
      }

      pendingWindowLoadKeysRef.current.add(loadKey);
      setDocumentWindowsByContainerId((currentWindows) => {
        const currentWindow = currentWindows.get(containerId);
        const nextWindows = new Map(currentWindows);
        nextWindows.set(containerId, {
          error: null,
          isLoading: true,
          rows: currentWindow?.rows ?? [],
          totalCount: currentWindow?.totalCount ?? 0,
        });
        return nextWindows;
      });

      void documentReadModel
        .listContainerDocumentSidebarWindow({
          containerId,
          limit: EXPLORER_SIDEBAR_DOCUMENT_PAGE_SIZE,
          offset,
        })
        .then((documentWindow) => {
          pendingWindowLoadKeysRef.current.delete(loadKey);
          if (loadGenerationRef.current !== generation) {
            return;
          }

          setDocumentWindowsByContainerId((currentWindows) => {
            const currentWindow = currentWindows.get(containerId);
            const nextRows =
              offset === 0
                ? documentWindow.rows
                : [...(currentWindow?.rows ?? []), ...documentWindow.rows];
            const nextWindows = new Map(currentWindows);
            nextWindows.set(containerId, {
              error: null,
              isLoading: false,
              rows: nextRows,
              totalCount: documentWindow.totalCount,
            });
            return nextWindows;
          });
        })
        .catch((error: unknown) => {
          pendingWindowLoadKeysRef.current.delete(loadKey);
          if (loadGenerationRef.current !== generation) {
            return;
          }

          setDocumentWindowsByContainerId((currentWindows) => {
            const currentWindow = currentWindows.get(containerId);
            const nextWindows = new Map(currentWindows);
            nextWindows.set(containerId, {
              error: error instanceof Error ? error.message : String(error),
              isLoading: false,
              rows: currentWindow?.rows ?? [],
              totalCount: currentWindow?.totalCount ?? 0,
            });
            return nextWindows;
          });
        });
    },
    [documentReadModel],
  );

  useEffect(() => {
    loadGenerationRef.current += 1;
    pendingWindowLoadKeysRef.current.clear();
    setDocumentWindowsByContainerId((currentWindows) =>
      currentWindows.size === 0 ? currentWindows : new Map(),
    );
  }, [documentReadModel]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    loadGenerationRef.current += 1;
    pendingWindowLoadKeysRef.current.clear();
    for (const containerId of expandedContainerIdsRef.current) {
      loadDocumentWindow(containerId, 0);
    }
  }, [
    documentLinkProjectionVersion,
    documentListRevision,
    loadDocumentWindow,
    ready,
  ]);

  useEffect(() => {
    if (!ready) {
      loadGenerationRef.current += 1;
      pendingWindowLoadKeysRef.current.clear();
      setDocumentWindowsByContainerId((currentWindows) =>
        currentWindows.size === 0 ? currentWindows : new Map(),
      );
      return;
    }

    const validContainerIds = new Set(nodes.map((node) => node.id));
    setDocumentWindowsByContainerId((currentWindows) => {
      let changed = false;
      const nextWindows = new Map<string, ExplorerSidebarDocumentWindowState>();
      for (const [containerId, state] of currentWindows.entries()) {
        if (validContainerIds.has(containerId)) {
          nextWindows.set(containerId, state);
        } else {
          changed = true;
        }
      }

      return changed ? nextWindows : currentWindows;
    });
  }, [nodes, ready, validContainerIdsKey]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    for (const containerId of expandedContainerIds) {
      if (!documentWindowsByContainerId.has(containerId)) {
        loadDocumentWindow(containerId, 0);
      }
    }
  }, [
    documentWindowsByContainerId,
    expandedContainerIds,
    expandedContainerIdsKey,
    loadDocumentWindow,
    ready,
  ]);

  const loadMoreDocuments = useCallback(
    (containerId: string) => {
      const currentWindow = documentWindowsByContainerId.get(containerId);
      if (!currentWindow || currentWindow.isLoading) {
        return;
      }

      if (currentWindow.error) {
        loadDocumentWindow(containerId, currentWindow.rows.length);
        return;
      }

      if (currentWindow.rows.length >= currentWindow.totalCount) {
        return;
      }

      loadDocumentWindow(containerId, currentWindow.rows.length);
    },
    [documentWindowsByContainerId, loadDocumentWindow],
  );

  return {
    documentWindowsByContainerId,
    loadMoreDocuments,
  };
}

export function useExplorerSidebarPanel(params: {
  activeContainerId: string | null;
  collapsedIds: ReadonlySet<string>;
  documentLinkProjectionVersion: number;
  documentListRevision: number;
  documentReadModel: ContainerDocumentReadModel;
  handleSidebarContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    nodeId: string,
  ) => void;
  handleSidebarDocumentContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    localId: string,
    containerId: string,
  ) => void;
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
  selectedId: string | null;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
  setSidebar: (sidebar: ReactNode | null) => void;
  online: boolean;
  toggleCollapsed: (nodeId: string) => void;
  treeEntries: ReadonlyArray<ExplorerTreeEntry>;
}) {
  const {
    activeContainerId,
    collapsedIds,
    documentLinkProjectionVersion,
    documentListRevision,
    documentReadModel,
    handleSidebarContextMenu,
    handleSidebarDocumentContextMenu,
    nodes,
    ready,
    selectedId,
    selectDocumentProjection,
    setSelectedId,
    setSidebar,
    online,
    toggleCollapsed,
    treeEntries,
  } = params;
  const { documentWindowsByContainerId, loadMoreDocuments } =
    useExplorerSidebarDocumentWindows({
      collapsedIds,
      documentLinkProjectionVersion,
      documentListRevision,
      documentReadModel,
      nodes,
      ready,
      treeEntries,
    });
  const collapsedIdsKey = useMemo(
    () => getExplorerTreeIdSetKey(collapsedIds),
    [collapsedIds],
  );

  const sidebar = useMemo(
    () => (
      <MiniAppSidebar>
        {!ready ? (
          <MiniAppStatus>Loading...</MiniAppStatus>
        ) : nodes.length === 0 ? (
          <MiniAppStatus>No containers.</MiniAppStatus>
        ) : (
          <ExplorerTreeEntries
            activeContainerId={activeContainerId}
            collapsedIds={collapsedIds}
            depth={0}
            documentWindowsByContainerId={documentWindowsByContainerId}
            entries={treeEntries}
            onContextMenu={handleSidebarContextMenu}
            onDocumentContextMenu={handleSidebarDocumentContextMenu}
            onLoadMoreDocuments={loadMoreDocuments}
            onSelectContainer={setSelectedId}
            onSelectDocument={selectDocumentProjection}
            onToggleCollapsed={toggleCollapsed}
            online={online}
            selectedId={selectedId}
          />
        )}
      </MiniAppSidebar>
    ),
    [
      activeContainerId,
      collapsedIds,
      collapsedIdsKey,
      documentWindowsByContainerId,
      handleSidebarContextMenu,
      handleSidebarDocumentContextMenu,
      nodes.length,
      loadMoreDocuments,
      online,
      ready,
      selectedId,
      selectDocumentProjection,
      setSelectedId,
      toggleCollapsed,
      treeEntries,
    ],
  );

  useRegisteredWindowSidebar({ setSidebar, sidebar });
}
