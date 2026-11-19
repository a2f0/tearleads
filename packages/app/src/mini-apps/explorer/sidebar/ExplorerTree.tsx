import { useRegisteredWindowSidebar } from "@tearleads/windowing";
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
import { useMiniAppVirtualWindow } from "../../../components/mini-app/virtual/MiniAppVirtual";
import { isExplorerOrphanedDocumentsId } from "../../../stores/explorer/orphanedDocuments";
import { ExplorerDatabaseErrorStatus } from "../shared/ExplorerDatabaseErrorStatus";
import type { ExplorerSidebarVirtualRow } from "./ExplorerSidebarRows";
import { buildExplorerSidebarRows } from "./ExplorerSidebarRows";
import {
  type ExplorerSidebarRowProps,
  ExplorerSidebarVirtualTree,
} from "./ExplorerSidebarRowViews";
import type { ExplorerTreeEntry } from "./explorerTreeModel";
import { EXPLORER_SIDEBAR_ROW_HEIGHT } from "./explorerTreeModel";

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
            offset={props.offset}
            onContextMenu={props.onContextMenu}
            onSelectContainer={props.onSelectContainer}
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
  // Surfaces a failed SQLite boot (with Retry) in the sidebar tree's gate.
  databaseError: boolean;
  onRetryDatabase: () => void;
  handleContainerContextMenu: (
    event: MouseEvent<HTMLElement>,
    nodeId: string,
  ) => void;
  organizationNamesById: ReadonlyMap<string, string>;
  primaryOrganizationId: string | null;
  ready: boolean;
  selectedId: string | null;
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
  const {
    collapsedIds,
    organizationNamesById,
    primaryOrganizationId,
    treeEntries,
  } = props;
  const rows = useMemo(
    () =>
      buildExplorerSidebarRows({
        collapsedIds,
        entries: treeEntries,
        organizationNamesById,
        primaryOrganizationId,
      }),
    [collapsedIds, treeEntries, organizationNamesById, primaryOrganizationId],
  );
  const { frameRef, offset, limit } = useMiniAppVirtualWindow({
    rowHeight: EXPLORER_SIDEBAR_ROW_HEIGHT,
  });
  const sidebarOffset = Math.min(offset, Math.max(0, rows.length - limit));
  const blankContextMenuContainerId = useMemo(
    () =>
      getExplorerSidebarBlankContextMenuContainerId(
        props.treeEntries,
        props.primaryOrganizationId,
      ),
    [props.primaryOrganizationId, props.treeEntries],
  );
  return (
    <ExplorerSidebarContent
      activeContainerId={props.activeContainerId}
      blankContextMenuContainerId={blankContextMenuContainerId}
      databaseError={props.databaseError}
      frameRef={frameRef}
      nodesLength={props.treeEntries.length}
      offset={sidebarOffset}
      onContextMenu={props.handleContainerContextMenu}
      onRetryDatabase={props.onRetryDatabase}
      onSelectContainer={props.setSelectedId}
      onToggleCollapsed={props.toggleCollapsed}
      ready={props.ready}
      rows={rows.slice(sidebarOffset, sidebarOffset + limit)}
      selectedId={props.selectedId}
      totalRows={rows.length}
    />
  );
}

// The panel's caller builds a new params object each render; the sidebar is
// rebuilt only when one of its fields changes.
function useExplorerSidebarProps(
  params: ExplorerSidebarPanelParams,
): ExplorerSidebarPanelParams {
  return useMemo(
    () => ({
      activeContainerId: params.activeContainerId,
      collapsedIds: params.collapsedIds,
      databaseError: params.databaseError,
      handleContainerContextMenu: params.handleContainerContextMenu,
      onRetryDatabase: params.onRetryDatabase,
      organizationNamesById: params.organizationNamesById,
      primaryOrganizationId: params.primaryOrganizationId,
      ready: params.ready,
      selectedId: params.selectedId,
      setSelectedId: params.setSelectedId,
      setSidebar: params.setSidebar,
      toggleCollapsed: params.toggleCollapsed,
      treeEntries: params.treeEntries,
    }),
    [
      params.activeContainerId,
      params.collapsedIds,
      params.databaseError,
      params.handleContainerContextMenu,
      params.onRetryDatabase,
      params.organizationNamesById,
      params.primaryOrganizationId,
      params.ready,
      params.selectedId,
      params.setSelectedId,
      params.setSidebar,
      params.toggleCollapsed,
      params.treeEntries,
    ],
  );
}

export function useExplorerSidebarPanel(params: ExplorerSidebarPanelParams) {
  const sidebarProps = useExplorerSidebarProps(params);
  const sidebar = useMemo(
    () => <ExplorerSidebar {...sidebarProps} />,
    [sidebarProps],
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
