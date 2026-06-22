import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import type {
  ContainerDocumentQueries,
  ContainerDocumentSidebarRow,
  ContainerNode,
} from "@tearleads/client-sdk";
import {
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
  MiniAppRow,
  MiniAppRowButton,
  MiniAppRowText,
} from "../../components/shared/MiniAppRow";
import {
  getMiniAppVirtualWindowRange,
  MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT,
  MiniAppVirtualBlockSpacer,
  useMiniAppVirtualWindow,
} from "../../components/shared/MiniAppVirtual";
import { useRegisteredWindowSidebar } from "../../components/window/WindowSidebarContext";
import { getViewerRelativeContactDocumentLabel } from "../../stores/contacts/contactLabels";
import { ExplorerDatabaseErrorStatus } from "./ExplorerDatabaseErrorStatus";
import {
  buildExplorerSidebarSections,
  countExplorerSidebarRows,
  EXPLORER_SIDEBAR_MIN_WINDOW_ROWS,
  type ExplorerSidebarDocumentWindowState,
  type ExplorerSidebarTreeEntry,
  type ExplorerSidebarVirtualRow,
  getExplorerSidebarDocumentWindowRequests,
  getExplorerSidebarRowsInRange,
  getLoadedExplorerSidebarDocumentRow,
} from "./ExplorerSidebarRows";
import { ExplorerSyncStateBadge } from "./ExplorerSyncStateBadge";

const EXPLORER_SIDEBAR_ROW_HEIGHT = MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT;

export type ExplorerTreeEntry = ExplorerSidebarTreeEntry;

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

interface ExplorerSidebarRowProps {
  activeContainerId: string | null;
  currentSigningFingerprint: string | null | undefined;
  currentUserId: string | null | undefined;
  depth: number;
  documentWindowsByContainerId: ReadonlyMap<
    string,
    ExplorerSidebarDocumentWindowState
  >;
  onContextMenu: (event: MouseEvent<HTMLElement>, id: string) => void;
  onDocumentContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    localId: string,
    containerId: string,
  ) => void;
  onSelectContainer: (id: string) => void;
  onSelectDocument: (documentId: string, containerId: string) => void;
  onRetryDocumentWindow: (containerId: string, offset: number) => void;
  onToggleCollapsed: (id: string) => void;
  online: boolean;
  selectedId: string | null;
}

function ExplorerSidebarItemLabel(params: {
  children: string;
  online: boolean;
  syncState: ContainerNode["syncState"];
}) {
  return (
    <>
      <MiniAppRowText>{params.children}</MiniAppRowText>
      <ExplorerSyncStateBadge
        online={params.online}
        syncState={params.syncState}
      />
    </>
  );
}

function getExplorerSidebarRowStyle(depth: number): {
  paddingLeft: string;
} {
  return {
    paddingLeft: `calc(var(--padding) / 2 + (var(--padding) * ${depth}))`,
  };
}

function getExplorerFolderIcon(params: {
  icon: string | null | undefined;
  isOpen: boolean;
}) {
  const iconName = params.isOpen ? "folder-open" : "folder";

  return {
    Component: params.isOpen ? FolderOpenIcon : FolderIcon,
    containerIcon: params.icon?.trim() || "folder",
    name: iconName,
  };
}

function ExplorerTreeDocumentRow(
  props: Omit<
    ExplorerSidebarRowProps,
    "onContextMenu" | "onToggleCollapsed"
  > & {
    row: ContainerDocumentSidebarRow;
  },
) {
  const { row } = props;
  const title = getViewerRelativeContactDocumentLabel({
    currentSigningFingerprint: props.currentSigningFingerprint,
    currentUserId: props.currentUserId,
    documentKind: row.documentKind,
    fallbackLabel: row.title,
    localId: row.localId,
  });

  return (
    <div
      className="explorer-sidebar-row"
      style={getExplorerSidebarRowStyle(props.depth)}
    >
      <span className="explorer-node-spacer" aria-hidden="true" />
      <MiniAppRowButton
        data-document-local-id={row.localId}
        className="explorer-sidebar-item explorer-sidebar-item--note"
        onClick={() => props.onSelectDocument(row.localId, row.containerId)}
        onContextMenu={(event) =>
          props.onDocumentContextMenu(event, row.localId, row.containerId)
        }
        selected={
          props.selectedId === row.localId &&
          props.activeContainerId === row.containerId
        }
      >
        <ExplorerSidebarItemLabel
          online={props.online}
          syncState={row.syncState}
        >
          {title}
        </ExplorerSidebarItemLabel>
      </MiniAppRowButton>
    </div>
  );
}

function ExplorerTreeDocumentPlaceholderRow(
  props: Pick<ExplorerSidebarRowProps, "depth" | "onRetryDocumentWindow"> & {
    containerId: string;
    error: string | null;
    isLoading: boolean;
    offset: number;
  },
) {
  const {
    containerId,
    depth,
    error,
    isLoading,
    offset,
    onRetryDocumentWindow,
  } = props;
  const label = error ? "Retry" : "Loading...";

  return (
    <div
      className="explorer-sidebar-row"
      style={getExplorerSidebarRowStyle(depth)}
    >
      <span className="explorer-node-spacer" aria-hidden="true" />
      <MiniAppRowButton
        className="explorer-sidebar-item explorer-sidebar-item--more"
        disabled={!error || isLoading}
        onClick={() => onRetryDocumentWindow(containerId, offset)}
      >
        <MiniAppRowText>{label}</MiniAppRowText>
      </MiniAppRowButton>
    </div>
  );
}

function ExplorerTreeContainerRow(
  props: Omit<ExplorerSidebarRowProps, "onDocumentContextMenu"> & {
    entry: ExplorerTreeEntry;
    isCollapsed: boolean;
  },
) {
  const {
    depth,
    entry,
    isCollapsed,
    onContextMenu,
    onSelectContainer,
    onToggleCollapsed,
    online,
    selectedId,
  } = props;
  const hasChildren = entry.children.length > 0;
  const isSelected = selectedId === entry.node.id;
  const isOpen =
    !isCollapsed &&
    (isSelected || props.activeContainerId === entry.node.id || hasChildren);
  const folderIcon = getExplorerFolderIcon({
    icon: entry.node.icon,
    isOpen,
  });
  const FolderGlyph = folderIcon.Component;

  return (
    <div
      className="explorer-sidebar-row"
      style={getExplorerSidebarRowStyle(depth)}
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
        <FolderGlyph
          aria-hidden="true"
          className="explorer-folder-icon"
          data-container-icon={folderIcon.containerIcon}
          data-icon={folderIcon.name}
          focusable="false"
          size={16}
          weight="regular"
        />
        <ExplorerSidebarItemLabel
          online={online}
          syncState={entry.node.syncState}
        >
          {entry.node.name}
        </ExplorerSidebarItemLabel>
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

export function getExplorerSidebarWindowRange(params: {
  scrollTop: number;
  viewportHeight: number;
}): { limit: number; offset: number } {
  return getMiniAppVirtualWindowRange({
    ...params,
    rowHeight: EXPLORER_SIDEBAR_ROW_HEIGHT,
  });
}

function ExplorerSidebarSectionLabelRow(props: { label: string }) {
  return (
    <div className="explorer-sidebar-row explorer-sidebar-row--section">
      <MiniAppRow
        className="explorer-sidebar-section-label"
        header
        role="heading"
        aria-level={2}
      >
        <MiniAppRowText truncate={false}>{props.label}</MiniAppRowText>
      </MiniAppRow>
    </div>
  );
}

function ExplorerSidebarVirtualRowView(
  props: ExplorerSidebarRowProps & {
    row: ExplorerSidebarVirtualRow;
  },
) {
  const { row } = props;

  if (row.kind === "section-label") {
    return <ExplorerSidebarSectionLabelRow label={row.label} />;
  }

  if (row.kind === "container") {
    return (
      <ExplorerTreeContainerRow
        {...props}
        depth={row.depth}
        entry={row.entry}
        isCollapsed={row.isCollapsed}
      />
    );
  }

  if (row.kind === "document-status") {
    return (
      <ExplorerTreeDocumentPlaceholderRow
        containerId={row.containerId}
        depth={row.depth}
        error={row.error}
        isLoading={row.isLoading}
        offset={0}
        onRetryDocumentWindow={props.onRetryDocumentWindow}
      />
    );
  }

  const documentRow = getLoadedExplorerSidebarDocumentRow(row);
  if (documentRow) {
    return (
      <ExplorerTreeDocumentRow {...props} depth={row.depth} row={documentRow} />
    );
  }

  return (
    <ExplorerTreeDocumentPlaceholderRow
      containerId={row.containerId}
      depth={row.depth}
      error={row.state.error}
      isLoading={row.state.isLoading}
      offset={row.documentIndex}
      onRetryDocumentWindow={props.onRetryDocumentWindow}
    />
  );
}

function ExplorerSidebarVirtualTree(
  props: ExplorerSidebarRowProps & {
    offset: number;
    rows: ReadonlyArray<ExplorerSidebarVirtualRow>;
    totalRows: number;
  },
) {
  const topPadding = props.offset * EXPLORER_SIDEBAR_ROW_HEIGHT;
  const bottomPadding =
    Math.max(0, props.totalRows - props.offset - props.rows.length) *
    EXPLORER_SIDEBAR_ROW_HEIGHT;

  return (
    <div className="explorer-sidebar-virtual-space">
      {topPadding > 0 ? (
        <MiniAppVirtualBlockSpacer height={topPadding} />
      ) : null}
      {props.rows.map((row) => (
        <ExplorerSidebarVirtualRowView key={row.key} {...props} row={row} />
      ))}
      {bottomPadding > 0 ? (
        <MiniAppVirtualBlockSpacer height={bottomPadding} />
      ) : null}
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The sidebar window hook owns paging, reload, and pruning state for a single UI surface.
function useExplorerSidebarDocumentWindows(params: {
  collapsedIds: ReadonlySet<string>;
  documentLinkProjectionVersion: number;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
  treeEntries: ReadonlyArray<ExplorerTreeEntry>;
}) {
  const {
    collapsedIds,
    documentLinkProjectionVersion,
    documentListRevision,
    documentQueries,
    nodes,
    ready,
    treeEntries,
  } = params;
  const loadGenerationRef = useRef(0);
  const latestWindowLoadKeyByContainerIdRef = useRef(new Map<string, string>());
  const pendingWindowLoadKeysRef = useRef(new Set<string>());
  const [documentWindowsByContainerId, setDocumentWindowsByContainerId] =
    useState<ReadonlyMap<string, ExplorerSidebarDocumentWindowState>>(
      () => new Map(),
    );
  const documentWindowsByContainerIdRef = useRef(documentWindowsByContainerId);
  documentWindowsByContainerIdRef.current = documentWindowsByContainerId;
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

  const requestDocumentWindow = useCallback(
    (containerId: string, offset: number, limit: number) => {
      const generation = loadGenerationRef.current;
      const loadKey = `${generation}\u0000${containerId}\u0000${offset}\u0000${limit}`;
      if (pendingWindowLoadKeysRef.current.has(loadKey)) {
        return;
      }

      pendingWindowLoadKeysRef.current.add(loadKey);
      if (limit > 0) {
        latestWindowLoadKeyByContainerIdRef.current.set(containerId, loadKey);
      }
      setDocumentWindowsByContainerId((currentWindows) => {
        const currentWindow = currentWindows.get(containerId);
        const nextWindows = new Map(currentWindows);
        nextWindows.set(containerId, {
          error: null,
          isLoading: true,
          offset: currentWindow?.offset ?? offset,
          rows: currentWindow?.rows ?? [],
          totalCount: currentWindow?.totalCount ?? null,
        });
        return nextWindows;
      });

      void documentQueries
        .listContainerDocumentSidebarWindow({
          containerId,
          limit,
          offset,
        })
        .then((documentWindow) => {
          pendingWindowLoadKeysRef.current.delete(loadKey);
          if (loadGenerationRef.current !== generation) {
            return;
          }
          if (
            limit > 0 &&
            latestWindowLoadKeyByContainerIdRef.current.get(containerId) !==
              loadKey
          ) {
            return;
          }

          setDocumentWindowsByContainerId((currentWindows) => {
            const currentWindow = currentWindows.get(containerId);
            const nextWindows = new Map(currentWindows);
            nextWindows.set(containerId, {
              error: null,
              isLoading: false,
              offset: limit === 0 ? (currentWindow?.offset ?? 0) : offset,
              rows:
                limit === 0 ? (currentWindow?.rows ?? []) : documentWindow.rows,
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
          if (
            limit > 0 &&
            latestWindowLoadKeyByContainerIdRef.current.get(containerId) !==
              loadKey
          ) {
            return;
          }

          setDocumentWindowsByContainerId((currentWindows) => {
            const currentWindow = currentWindows.get(containerId);
            const message =
              error instanceof Error ? error.message : String(error);
            const nextWindows = new Map(currentWindows);
            nextWindows.set(containerId, {
              error:
                limit === 0 && currentWindow?.totalCount != null
                  ? (currentWindow?.error ?? null)
                  : message,
              isLoading: false,
              offset: currentWindow?.offset ?? offset,
              rows: currentWindow?.rows ?? [],
              totalCount: currentWindow?.totalCount ?? null,
            });
            return nextWindows;
          });
        });
    },
    [documentQueries],
  );

  useEffect(() => {
    loadGenerationRef.current += 1;
    latestWindowLoadKeyByContainerIdRef.current.clear();
    pendingWindowLoadKeysRef.current.clear();
    setDocumentWindowsByContainerId((currentWindows) =>
      currentWindows.size === 0 ? currentWindows : new Map(),
    );
  }, [documentQueries]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    loadGenerationRef.current += 1;
    latestWindowLoadKeyByContainerIdRef.current.clear();
    pendingWindowLoadKeysRef.current.clear();
    for (const containerId of expandedContainerIdsRef.current) {
      const currentWindow =
        documentWindowsByContainerIdRef.current.get(containerId);
      requestDocumentWindow(
        containerId,
        currentWindow?.offset ?? 0,
        currentWindow?.rows.length ?? 0,
      );
    }
  }, [
    documentLinkProjectionVersion,
    documentListRevision,
    requestDocumentWindow,
    ready,
  ]);

  useEffect(() => {
    if (!ready) {
      loadGenerationRef.current += 1;
      latestWindowLoadKeyByContainerIdRef.current.clear();
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
        requestDocumentWindow(containerId, 0, 0);
      }
    }
  }, [
    documentWindowsByContainerId,
    expandedContainerIds,
    expandedContainerIdsKey,
    requestDocumentWindow,
    ready,
  ]);

  return {
    documentWindowsByContainerId,
    requestDocumentWindow,
  };
}

function useExplorerSidebarVisibleRows(params: {
  collapsedIds: ReadonlySet<string>;
  currentOrganizationId: string | null;
  documentWindowsByContainerId: ReadonlyMap<
    string,
    ExplorerSidebarDocumentWindowState
  >;
  treeEntries: ReadonlyArray<ExplorerTreeEntry>;
}) {
  const {
    collapsedIds,
    currentOrganizationId,
    documentWindowsByContainerId,
    treeEntries,
  } = params;
  const collapsedIdsKey = useMemo(
    () => getExplorerTreeIdSetKey(collapsedIds),
    [collapsedIds],
  );
  const {
    frameRef,
    limit: sidebarLimit,
    offset: sidebarRangeOffset,
  } = useMiniAppVirtualWindow({
    rowHeight: EXPLORER_SIDEBAR_ROW_HEIGHT,
  });
  const sidebarSections = useMemo(
    () =>
      buildExplorerSidebarSections({
        collapsedIds,
        currentOrganizationId,
        documentWindowsByContainerId,
        entries: treeEntries,
      }),
    [
      collapsedIdsKey,
      currentOrganizationId,
      documentWindowsByContainerId,
      treeEntries,
    ],
  );
  const totalRows = useMemo(
    () => countExplorerSidebarRows(sidebarSections),
    [sidebarSections],
  );
  const offset = Math.min(
    sidebarRangeOffset,
    Math.max(0, totalRows - sidebarLimit),
  );
  const rows = useMemo(
    () =>
      getExplorerSidebarRowsInRange({
        collapsedIds,
        limit: sidebarLimit,
        offset,
        sections: sidebarSections,
      }),
    [collapsedIdsKey, offset, sidebarLimit, sidebarSections],
  );

  return { frameRef, offset, rows, totalRows };
}

function useExplorerSidebarDocumentWindowLoader(params: {
  documentWindowsByContainerId: ReadonlyMap<
    string,
    ExplorerSidebarDocumentWindowState
  >;
  ready: boolean;
  requestDocumentWindow: (
    containerId: string,
    offset: number,
    limit: number,
  ) => void;
  rows: ReadonlyArray<ExplorerSidebarVirtualRow>;
}) {
  const { documentWindowsByContainerId, ready, requestDocumentWindow, rows } =
    params;
  const sidebarDocumentWindowRequests = useMemo(
    () =>
      getExplorerSidebarDocumentWindowRequests({
        documentWindowsByContainerId,
        rows,
      }),
    [documentWindowsByContainerId, rows],
  );
  const retryDocumentWindow = useCallback(
    (containerId: string, offset: number) => {
      requestDocumentWindow(
        containerId,
        offset,
        EXPLORER_SIDEBAR_MIN_WINDOW_ROWS,
      );
    },
    [requestDocumentWindow],
  );

  useEffect(() => {
    if (!ready) {
      return;
    }

    for (const request of sidebarDocumentWindowRequests) {
      if (request.limit > 0) {
        requestDocumentWindow(
          request.containerId,
          request.offset,
          request.limit,
        );
      }
    }
  }, [ready, requestDocumentWindow, sidebarDocumentWindowRequests]);

  return retryDocumentWindow;
}

interface ExplorerSidebarContentProps extends ExplorerSidebarRowProps {
  blankContextMenuContainerId: string | null;
  // True when the SQLite boot failed; surfaces the error instead of "Loading...".
  databaseError: boolean;
  frameRef: (nextFrame: HTMLDivElement | null) => void;
  nodesLength: number;
  offset: number;
  onRetryDatabase: () => void;
  ready: boolean;
  rows: ReadonlyArray<ExplorerSidebarVirtualRow>;
  totalRows: number;
}

function isExplorerSidebarBlankContextTarget(
  target: EventTarget | null,
): boolean {
  return target instanceof Element && !target.closest(".explorer-sidebar-row");
}

function ExplorerSidebarContent(props: ExplorerSidebarContentProps) {
  // The device-first store can briefly re-report `ready: false` while it
  // re-snapshots during boot, even after it has already produced the tree. Latch
  // the first time we have a real tree to show so a transient `ready` flip keeps
  // displaying the existing rows instead of unmounting them back to "Loading...",
  // which reads as the sidebar's contents appearing and then vanishing.
  const hasRenderedTreeRef = useRef(false);
  const canRenderTree = props.ready && props.nodesLength > 0;
  // Latch in an effect rather than during render to keep render pure: on the
  // first ready render `canRenderTree` already makes `shouldShowTree` true, and
  // the effect persists it so a later transient `ready` flip keeps the tree.
  useEffect(() => {
    if (canRenderTree) {
      hasRenderedTreeRef.current = true;
    }
  }, [canRenderTree]);
  const shouldShowTree = canRenderTree || hasRenderedTreeRef.current;

  return (
    <MiniAppSidebar className="explorer-sidebar explorer-sidebar--virtual">
      <section
        className="explorer-sidebar-viewport"
        aria-label="Explorer containers"
        onContextMenu={(event) => {
          if (
            isExplorerSidebarBlankContextTarget(event.target) &&
            props.blankContextMenuContainerId
          ) {
            props.onContextMenu(event, props.blankContextMenuContainerId);
          }
        }}
        ref={props.frameRef}
      >
        {props.databaseError ? (
          // A failed SQLite boot leaves `ready` false just like an in-progress
          // boot, so surface the error (matching the detail panel) rather than an
          // indistinguishable, never-ending "Loading...".
          <ExplorerDatabaseErrorStatus onRetry={props.onRetryDatabase} />
        ) : shouldShowTree ? (
          <ExplorerSidebarVirtualTree
            activeContainerId={props.activeContainerId}
            currentSigningFingerprint={props.currentSigningFingerprint}
            currentUserId={props.currentUserId}
            depth={0}
            documentWindowsByContainerId={props.documentWindowsByContainerId}
            offset={props.offset}
            onContextMenu={props.onContextMenu}
            onDocumentContextMenu={props.onDocumentContextMenu}
            onRetryDocumentWindow={props.onRetryDocumentWindow}
            onSelectContainer={props.onSelectContainer}
            onSelectDocument={props.onSelectDocument}
            onToggleCollapsed={props.onToggleCollapsed}
            online={props.online}
            rows={props.rows}
            selectedId={props.selectedId}
            totalRows={props.totalRows}
          />
        ) : props.ready ? (
          // Settled and genuinely empty (distinct from the transient flip the
          // latch above absorbs, which keeps the tree mounted).
          <MiniAppStatus>No containers.</MiniAppStatus>
        ) : (
          <MiniAppStatus>Loading...</MiniAppStatus>
        )}
      </section>
    </MiniAppSidebar>
  );
}

interface ExplorerSidebarPanelParams {
  activeContainerId: string | null;
  collapsedIds: ReadonlySet<string>;
  currentOrganizationId: string | null;
  currentSigningFingerprint: string | null | undefined;
  currentUserId: string | null | undefined;
  // Surfaces a failed SQLite boot (with Retry) in the sidebar tree's gate.
  databaseError: boolean;
  onRetryDatabase: () => void;
  documentLinkProjectionVersion: number;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  handleSidebarContextMenu: (
    event: MouseEvent<HTMLElement>,
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
  selectDocumentProjection: (documentId: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
  setSidebar: (sidebar: ReactNode | null) => void;
  online: boolean;
  toggleCollapsed: (nodeId: string) => void;
  treeEntries: ReadonlyArray<ExplorerTreeEntry>;
}

interface ExplorerSidebarProps extends ExplorerSidebarPanelParams {
  documentWindowsByContainerId: ReadonlyMap<
    string,
    ExplorerSidebarDocumentWindowState
  >;
  requestDocumentWindow: (
    containerId: string,
    offset: number,
    limit: number,
  ) => void;
}

function ExplorerSidebar(props: ExplorerSidebarProps) {
  const {
    frameRef,
    offset: sidebarOffset,
    rows: visibleSidebarRows,
    totalRows: totalSidebarRows,
  } = useExplorerSidebarVisibleRows({
    collapsedIds: props.collapsedIds,
    currentOrganizationId: props.currentOrganizationId,
    documentWindowsByContainerId: props.documentWindowsByContainerId,
    treeEntries: props.treeEntries,
  });
  const blankContextMenuContainerId = useMemo(() => {
    const ownedRoot = props.treeEntries.find(
      (entry) =>
        props.currentOrganizationId === null ||
        entry.node.organizationId === props.currentOrganizationId,
    );
    return ownedRoot?.node.id ?? props.treeEntries[0]?.node.id ?? null;
  }, [props.currentOrganizationId, props.treeEntries]);
  const retryDocumentWindow = useExplorerSidebarDocumentWindowLoader({
    documentWindowsByContainerId: props.documentWindowsByContainerId,
    ready: props.ready,
    requestDocumentWindow: props.requestDocumentWindow,
    rows: visibleSidebarRows,
  });

  return (
    <ExplorerSidebarContent
      activeContainerId={props.activeContainerId}
      blankContextMenuContainerId={blankContextMenuContainerId}
      currentSigningFingerprint={props.currentSigningFingerprint}
      currentUserId={props.currentUserId}
      databaseError={props.databaseError}
      depth={0}
      documentWindowsByContainerId={props.documentWindowsByContainerId}
      frameRef={frameRef}
      nodesLength={props.nodes.length}
      offset={sidebarOffset}
      onContextMenu={props.handleSidebarContextMenu}
      onDocumentContextMenu={props.handleSidebarDocumentContextMenu}
      onRetryDatabase={props.onRetryDatabase}
      onRetryDocumentWindow={retryDocumentWindow}
      onSelectContainer={props.setSelectedId}
      onSelectDocument={props.selectDocumentProjection}
      onToggleCollapsed={props.toggleCollapsed}
      online={props.online}
      ready={props.ready}
      rows={visibleSidebarRows}
      selectedId={props.selectedId}
      totalRows={totalSidebarRows}
    />
  );
}

export function useExplorerSidebarPanel(params: ExplorerSidebarPanelParams) {
  const { documentWindowsByContainerId, requestDocumentWindow } =
    useExplorerSidebarDocumentWindows(params);
  const sidebar = useMemo(
    () => (
      <ExplorerSidebar
        {...params}
        documentWindowsByContainerId={documentWindowsByContainerId}
        requestDocumentWindow={requestDocumentWindow}
      />
    ),
    [
      params.activeContainerId,
      params.collapsedIds,
      params.currentOrganizationId,
      params.currentSigningFingerprint,
      params.currentUserId,
      params.databaseError,
      params.documentLinkProjectionVersion,
      params.documentListRevision,
      params.documentQueries,
      params.handleSidebarContextMenu,
      params.handleSidebarDocumentContextMenu,
      params.nodes,
      params.online,
      params.onRetryDatabase,
      params.ready,
      params.selectedId,
      params.selectDocumentProjection,
      params.setSelectedId,
      params.setSidebar,
      params.toggleCollapsed,
      params.treeEntries,
      documentWindowsByContainerId,
      requestDocumentWindow,
    ],
  );

  useRegisteredWindowSidebar({ setSidebar: params.setSidebar, sidebar });
}
