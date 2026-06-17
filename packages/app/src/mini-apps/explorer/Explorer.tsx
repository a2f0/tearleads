import { useCallback } from "react";
import { usePeerUserId } from "../../components/pane/DualPaneProvider";
import { MiniAppRoot } from "../../components/shared/MiniAppLayout";
import {
  useWindowFileMenuItem,
  useWindowRefreshMenuItem,
} from "../../components/window/WindowMenuContext";
import { useWindowSidebar } from "../../components/window/WindowSidebarContext";
import { useDatabase } from "../../providers/db/DatabaseProvider";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { useExplorer } from "../../stores/explorer/ExplorerProvider";
import { useMiniAppBusActions } from "../bus";
import { ExplorerContextMenuLayer } from "./context-menu/ExplorerContextMenu";
import { ExplorerDetailPanel } from "./detail/ExplorerDetailPanel";
import { useExplorerModel } from "./hooks/useExplorerModel";
import { EXPLORER_LABELS } from "./labels";
import { ExplorerModalLayer } from "./modal/view";
import type { MiniAppWindowPosition } from "./types";
import "./Explorer.css";

function useOpenGrantGroupInOrgManager() {
  const { openMiniApp } = useMiniAppBusActions();

  return useCallback(
    (groupId: string, position?: MiniAppWindowPosition) => {
      openMiniApp({
        appId: "org-manager",
        message: {
          appId: "org-manager",
          groupId,
          type: "open-group",
        },
        pathSegments: ["groups", groupId],
        ...(position ? { position } : {}),
      });
    },
    [openMiniApp],
  );
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Explorer composes the mini-app shell from model state.
export function Explorer() {
  const appData = useTearleadsRuntime();
  const explorer = useExplorer();
  const { setSidebar } = useWindowSidebar();
  const peerUserId = usePeerUserId();
  // Surface a failed SQLite boot (e.g. an offline reload where the worker/wasm
  // could not load) as an explicit error + Retry in Explorer's gates, rather than
  // an indistinguishable "Loading...". appData.infra.dbStatus mirrors the worker
  // status (workflowRuntime sets it from database.status); "error" = boot failed.
  const { clearWorker } = useDatabase();
  const databaseError = appData.infra.dbStatus === "error";
  const retryDatabaseBoot = useCallback(() => {
    // A failed boot leaves the database at the terminal "error" status with the
    // worker handle still set, so re-spawning directly would no-op. clearWorker
    // resets it to "idle", from which DatabaseProvider's identity effect
    // re-spawns the worker and re-attempts the boot.
    clearWorker();
  }, [clearWorker]);
  const model = useExplorerModel(
    appData,
    explorer,
    setSidebar,
    peerUserId,
    retryDatabaseBoot,
  );
  const openGrantGroupInOrgManager = useOpenGrantGroupInOrgManager();
  const activeContainerId = model.selection.activeContainerId;
  const openStructuredDocumentGrid = useCallback(() => {
    if (activeContainerId) {
      model.routeState.openNewStructuredDocumentRoute(activeContainerId);
    }
  }, [activeContainerId, model.routeState.openNewStructuredDocumentRoute]);
  const openBlobBrowser = useCallback(() => {
    model.routeState.openBlobBrowserRoute();
  }, [model.routeState.openBlobBrowserRoute]);
  const openSyncLanes = useCallback(() => {
    model.routeState.openSyncLanesRoute();
  }, [model.routeState.openSyncLanesRoute]);
  useWindowFileMenuItem({
    disabled: !model.explorer.ready || !activeContainerId,
    id: "explorer-new-structured-document",
    label: EXPLORER_LABELS.newStructuredDocumentAction,
    onClick: openStructuredDocumentGrid,
    priority: 100,
  });
  useWindowFileMenuItem({
    disabled: !model.explorer.ready,
    id: "explorer-blob-browser",
    label: EXPLORER_LABELS.blobBrowserAction,
    onClick: openBlobBrowser,
    priority: 110,
  });
  useWindowFileMenuItem({
    id: "explorer-sync-lanes",
    label: EXPLORER_LABELS.syncLanesAction,
    onClick: openSyncLanes,
    priority: 120,
  });
  useWindowRefreshMenuItem({
    disabled: !model.explorer.ready || model.isRefreshing,
    onRefresh: model.handleRefresh,
    priority: 100,
    refreshing: model.isRefreshing,
  });

  return (
    <MiniAppRoot className="explorer">
      <ExplorerDetailPanel
        activateLinkedContainer={model.activateLinkedContainer}
        blobStore={appData.infra.blobStore}
        databaseError={databaseError}
        onRetryDatabase={retryDatabaseBoot}
        canActivateSelectedDocument={model.canActivateSelectedDocument}
        canLinkSelectedDocument={model.canLinkSelectedDocument}
        canMoveSelectedDocument={model.canMoveSelectedDocument}
        canUnlinkSelectedDocument={model.canUnlinkSelectedDocument}
        documentListRevision={model.documentListRevision}
        documentQueries={model.documentQueries}
        domainScope={appData.state.domainScope}
        importDroppedFiles={model.importDroppedFiles}
        linkedContainerIds={model.linkedContainerIds}
        loadBlobInfo={model.loadBlobInfo}
        loadContainerInfo={model.loadContainerInfo}
        loadDocumentInfo={model.loadDocumentInfo}
        nodes={model.explorer.nodes}
        online={appData.state.online}
        onContainerContextMenu={
          model.contextMenuState.handleContainerContextMenu
        }
        onBackToSelectionRoute={model.routeState.showSelectionRoute}
        onOpenGrantGroup={openGrantGroupInOrgManager}
        openInlineDocument={model.openInlineDocument}
        openBlobBrowserRoute={model.routeState.openBlobBrowserRoute}
        openDocumentInfoRoute={model.routeState.openDocumentInfoRoute}
        openLinkDocumentModal={model.modalState.openLinkDocumentModal}
        openMoveDocumentModal={model.modalState.openMoveDocumentModal}
        peerUserId={model.peerUserId}
        ready={model.explorer.ready}
        refreshError={model.refreshError}
        route={model.routeState.route}
        selectDocumentProjection={model.selectDocumentProjection}
        selectedNode={model.selection.selectedNode}
        selectedDocument={model.selection.selectedDocument}
        setSelectedId={model.routeState.selectExplorerItem}
        shareWithGroup={model.explorer.shareWithGroup}
        shareWithUser={model.explorer.shareWithUser}
        unlinkDocument={model.unlinkDocument}
        visibleSystemSlots={model.explorer.visibleSystemSlots}
      />
      <ExplorerContextMenuLayer
        canDeleteSelectedDocument={model.canDeleteSelectedDocument}
        canLinkSelectedDocument={model.canLinkSelectedDocument}
        canDeleteContextMenuNode={
          model.contextMenuState.canDeleteContextMenuNode
        }
        canMoveContextMenuNode={model.contextMenuState.canMoveContextMenuNode}
        canMoveSelectedDocument={model.canMoveSelectedDocument}
        closeContextMenu={model.contextMenuState.closeContextMenu}
        contextMenu={model.contextMenuState.contextMenu}
        deleteDocument={model.deleteDocument}
        importDroppedFiles={model.importDroppedFiles}
        openDocumentInfoRoute={model.routeState.openDocumentInfoRoute}
        openContainerInfoRoute={model.routeState.openContainerInfoRoute}
        openCreateChildModal={model.modalState.openCreateChildModal}
        openDeleteModal={model.modalState.openDeleteModal}
        openLinkDocumentModal={model.modalState.openLinkDocumentModal}
        openMoveModal={model.modalState.openMoveModal}
        openMoveDocumentModal={model.modalState.openMoveDocumentModal}
        openRenameModal={model.modalState.openRenameModal}
        selectContainer={model.routeState.selectExplorerItem}
      />
      <ExplorerModalLayer
        closeModal={model.modalState.closeModal}
        draftName={model.modalState.draftName}
        draftTargetContainerId={model.modalState.draftTargetContainerId}
        handleModalSubmit={model.modalState.handleModalSubmit}
        isSubmittingModal={model.modalState.isSubmittingModal}
        modalError={model.modalState.modalError}
        modalState={model.modalState.modalState}
        moveTargetOptions={model.modalState.moveTargetOptions}
        nameInputRef={model.modalState.nameInputRef}
        peerUserId={model.peerUserId}
        setDraftName={model.modalState.setDraftName}
        setModalError={model.modalState.setModalError}
        setDraftTargetContainerId={model.modalState.setDraftTargetContainerId}
        targetSelectRef={model.modalState.targetSelectRef}
      />
    </MiniAppRoot>
  );
}
