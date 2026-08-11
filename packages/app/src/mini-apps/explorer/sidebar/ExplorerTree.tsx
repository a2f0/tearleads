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
} from "../../../components/mini-app/MiniAppLayout";
import { useRegisteredWindowSidebar } from "../../../components/window/WindowSidebarContext";
import type { AvatarUrlByContactId } from "../../../document-types/contact/useContactAvatarUrls";
import { isExplorerOrphanedDocumentsId } from "../../../stores/explorer/orphanedDocuments";
import { ExplorerDatabaseErrorStatus } from "../shared/ExplorerDatabaseErrorStatus";
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
  // Monotonic link-projection version. Increments schedule a coalesced,
  // non-destructive sidebar reload pass across the expanded containers (see
  // useExplorerSidebarWindows — stale rows stay rendered and swap in place).
  // Stamped on the viewport purely so an integration canary can bound it after
  // bootstrap settles — the cold-bootstrap flicker was this counter climbing
  // ~once per sync tick. Not read by runtime code.
  documentLinkProjectionVersion: number;
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
        data-document-link-projection-version={
          props.documentLinkProjectionVersion
        }
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
            contactAvatarUrlByLocalId={props.contactAvatarUrlByLocalId}
            currentSigningFingerprint={props.currentSigningFingerprint}
            currentSelfContactLocalId={props.currentSelfContactLocalId}
            currentUserId={props.currentUserId}
            depth={0}
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
  contactAvatarUrlByLocalId: AvatarUrlByContactId;
  currentSigningFingerprint: string | null | undefined;
  currentSelfContactLocalId: string | null | undefined;
  currentUserId: string | null | undefined;
  currentOrganizationId: string | null;
  // Surfaces a failed SQLite boot (with Retry) in the sidebar tree's gate.
  databaseError: boolean;
  onRetryDatabase: () => void;
  documentLinkProjectionVersion: number;
  documentLinkProjectionVersionByContainerId: ReadonlyMap<string, number>;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  handleContainerContextMenu: (
    event: MouseEvent<HTMLElement>,
    nodeId: string,
  ) => void;
  handleSidebarDocumentContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    localId: string,
    containerId: string,
  ) => void;
  nodes: ReadonlyArray<ContainerNode>;
  organizationNamesById: ReadonlyMap<string, string>;
  primaryOrganizationId: string | null;
  ready: boolean;
  selectedId: string | null;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
  setSidebar: (sidebar: ReactNode | null) => void;
  toggleCollapsed: (nodeId: string) => void;
  treeEntries: ReadonlyArray<ExplorerTreeEntry>;
}

export function getExplorerSidebarBlankContextMenuContainerId(
  treeEntries: ReadonlyArray<ExplorerTreeEntry>,
  primaryOrganizationId: string | null,
): string | null {
  const ownedRoot = treeEntries.find(
    (entry) =>
      !isExplorerOrphanedDocumentsId(entry.node.id) &&
      (primaryOrganizationId === null ||
        entry.node.organizationId === primaryOrganizationId),
  );
  return (
    ownedRoot?.node.id ??
    treeEntries.find((entry) => !isExplorerOrphanedDocumentsId(entry.node.id))
      ?.node.id ??
    null
  );
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
    organizationNamesById: props.organizationNamesById,
    primaryOrganizationId: props.primaryOrganizationId,
    treeEntries: props.treeEntries,
  });
  const blankContextMenuContainerId = useMemo(
    () =>
      getExplorerSidebarBlankContextMenuContainerId(
        props.treeEntries,
        props.primaryOrganizationId,
      ),
    [props.primaryOrganizationId, props.treeEntries],
  );
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
      contactAvatarUrlByLocalId={props.contactAvatarUrlByLocalId}
      currentSigningFingerprint={props.currentSigningFingerprint}
      currentSelfContactLocalId={props.currentSelfContactLocalId}
      currentUserId={props.currentUserId}
      databaseError={props.databaseError}
      depth={0}
      documentLinkProjectionVersion={props.documentLinkProjectionVersion}
      frameRef={frameRef}
      nodesLength={props.nodes.length}
      offset={sidebarOffset}
      onContextMenu={props.handleContainerContextMenu}
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
      params.contactAvatarUrlByLocalId,
      params.currentSigningFingerprint,
      params.currentSelfContactLocalId,
      params.currentUserId,
      params.currentOrganizationId,
      params.databaseError,
      params.documentLinkProjectionVersion,
      params.documentLinkProjectionVersionByContainerId,
      params.documentListRevision,
      params.documentQueries,
      params.handleContainerContextMenu,
      params.handleSidebarDocumentContextMenu,
      params.nodes,
      params.onRetryDatabase,
      params.organizationNamesById,
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

  // Explorer's sidebar is always the folder tree, in every layout. The
  // diagnostics hub lives full-screen in the main pane (opened from the
  // Sync toolbar action), not in the sidebar.
  useRegisteredWindowSidebar({
    enabled: true,
    setSidebar: params.setSidebar,
    sidebar,
  });
}
