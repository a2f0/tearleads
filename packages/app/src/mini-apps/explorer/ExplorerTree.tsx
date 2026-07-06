import type {
  ContainerDocumentQueries,
  ContainerNode,
} from "@tearleads/client-sdk";
import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  MiniAppSidebar,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import { useRegisteredWindowSidebar } from "../../components/window/WindowSidebarContext";
import { ExplorerDatabaseErrorStatus } from "./ExplorerDatabaseErrorStatus";
import type { ExplorerSidebarVirtualRow } from "./ExplorerSidebarRows";
import {
  type ExplorerSidebarRowProps,
  ExplorerSidebarVirtualTree,
} from "./ExplorerSidebarRowViews";
import type { ExplorerTreeEntry } from "./explorerTreeModel";
import {
  useExplorerSidebarDocumentWindowLoader,
  useExplorerSidebarDocumentWindows,
  useExplorerSidebarVisibleRows,
} from "./useExplorerSidebarWindows";

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
  primaryOrganizationId: string | null;
  ready: boolean;
  selectedId: string | null;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
  setSidebar: (sidebar: ReactNode | null) => void;
  toggleCollapsed: (nodeId: string) => void;
  treeEntries: ReadonlyArray<ExplorerTreeEntry>;
}

function ExplorerSidebar(props: ExplorerSidebarPanelParams) {
  const { documentWindowsByContainerId, requestDocumentWindow } =
    useExplorerSidebarDocumentWindows(props);
  const {
    frameRef,
    offset: sidebarOffset,
    rows: visibleSidebarRows,
    totalRows: totalSidebarRows,
  } = useExplorerSidebarVisibleRows({
    collapsedIds: props.collapsedIds,
    documentWindowsByContainerId,
    primaryOrganizationId: props.primaryOrganizationId,
    treeEntries: props.treeEntries,
  });
  const blankContextMenuContainerId = useMemo(() => {
    const ownedRoot = props.treeEntries.find(
      (entry) =>
        props.primaryOrganizationId === null ||
        entry.node.organizationId === props.primaryOrganizationId,
    );
    return ownedRoot?.node.id ?? props.treeEntries[0]?.node.id ?? null;
  }, [props.primaryOrganizationId, props.treeEntries]);
  const retryDocumentWindow = useExplorerSidebarDocumentWindowLoader({
    documentWindowsByContainerId,
    ready: props.ready,
    requestDocumentWindow,
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
      documentWindowsByContainerId={documentWindowsByContainerId}
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
      ready={props.ready}
      rows={visibleSidebarRows}
      selectedId={props.selectedId}
      totalRows={totalSidebarRows}
    />
  );
}

export function useExplorerSidebarPanel(params: ExplorerSidebarPanelParams) {
  const sidebar = useMemo(
    () => <ExplorerSidebar {...params} />,
    [
      params.activeContainerId,
      params.collapsedIds,
      params.currentSigningFingerprint,
      params.currentUserId,
      params.databaseError,
      params.documentLinkProjectionVersion,
      params.documentListRevision,
      params.documentQueries,
      params.handleSidebarContextMenu,
      params.handleSidebarDocumentContextMenu,
      params.nodes,
      params.onRetryDatabase,
      params.primaryOrganizationId,
      params.ready,
      params.selectedId,
      params.selectDocumentProjection,
      params.setSelectedId,
      params.setSidebar,
      params.toggleCollapsed,
      params.treeEntries,
    ],
  );

  useRegisteredWindowSidebar({ setSidebar: params.setSidebar, sidebar });
}
