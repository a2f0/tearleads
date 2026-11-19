import { useRegisteredWindowSidebar } from "@tearleads/windowing";
import { type MouseEvent, type ReactNode, useMemo } from "react";
import { MiniAppSidebar } from "../../../components/mini-app/MiniAppLayout";
import { useMiniAppVirtualWindow } from "../../../components/mini-app/virtual/MiniAppVirtual";
import { isExplorerOrphanedDocumentsId } from "../../../stores/explorer/orphanedDocuments";
import {
  type ExplorerFolderState,
  ExplorerFolderStatus,
} from "../shared/ExplorerFolderStatus";
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
  frameRef: (nextFrame: HTMLDivElement | null) => void;
  nodesLength: number;
  offset: number;
  folderState: ExplorerFolderState;
  rows: ReadonlyArray<ExplorerSidebarVirtualRow>;
  totalRows: number;
}

function isExplorerSidebarBlankContextTarget(
  target: EventTarget | null,
): boolean {
  return target instanceof Element && !target.closest(".explorer-sidebar-row");
}

function ExplorerSidebarContent(props: ExplorerSidebarContentProps) {
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
        {props.nodesLength > 0 ? (
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
        ) : (
          <ExplorerFolderStatus state={props.folderState} />
        )}
      </section>
    </MiniAppSidebar>
  );
}

interface ExplorerSidebarPanelParams {
  activeContainerId: string | null;
  collapsedIds: ReadonlySet<string>;
  handleContainerContextMenu: (
    event: MouseEvent<HTMLElement>,
    nodeId: string,
  ) => void;
  organizationNamesById: ReadonlyMap<string, string>;
  primaryOrganizationId: string | null;
  folderState: ExplorerFolderState;
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
      frameRef={frameRef}
      nodesLength={props.treeEntries.length}
      offset={sidebarOffset}
      onContextMenu={props.handleContainerContextMenu}
      onSelectContainer={props.setSelectedId}
      onToggleCollapsed={props.toggleCollapsed}
      folderState={props.folderState}
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
      handleContainerContextMenu: params.handleContainerContextMenu,
      organizationNamesById: params.organizationNamesById,
      primaryOrganizationId: params.primaryOrganizationId,
      folderState: params.folderState,
      selectedId: params.selectedId,
      setSelectedId: params.setSelectedId,
      setSidebar: params.setSidebar,
      toggleCollapsed: params.toggleCollapsed,
      treeEntries: params.treeEntries,
    }),
    [
      params.activeContainerId,
      params.collapsedIds,
      params.handleContainerContextMenu,
      params.organizationNamesById,
      params.primaryOrganizationId,
      params.folderState,
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
