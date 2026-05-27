import { useCallback } from "react";
import { usePeerUserId } from "../../components/pane/DualPaneProvider";
import { MiniAppRoot } from "../../components/shared/MiniAppLayout";
import {
  useWindowFileMenuItem,
  useWindowRefreshMenuItem,
} from "../../components/window/WindowMenuContext";
import { useWindowSidebar } from "../../components/window/WindowSidebarContext";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { useExplorer } from "../../stores/explorer/ExplorerProvider";
import { type MiniAppWindowPosition, useMiniAppBusActions } from "../bus";
import { ExplorerContextMenuLayer } from "./context-menu/ExplorerContextMenu";
import { ExplorerDetailPanel } from "./detail/ExplorerDetailPanel";
import { useExplorerModel } from "./hooks/useExplorerModel";
import { ExplorerModalLayer } from "./modal/view";
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
  const model = useExplorerModel(appData, explorer, setSidebar, peerUserId);
  const openGrantGroupInOrgManager = useOpenGrantGroupInOrgManager();
  const activeContainerId = model.selection.activeContainerId;
  const openStructuredDocumentGrid = useCallback(() => {
    if (activeContainerId) {
      model.routeState.selectExplorerItem(activeContainerId);
    }
  }, [activeContainerId, model.routeState.selectExplorerItem]);
  useWindowFileMenuItem({
    disabled: !model.explorer.ready || activeContainerId === null,
    id: "explorer-new-structured-document",
    label: "New Structured Document",
    onClick: openStructuredDocumentGrid,
    priority: 100,
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
        canActivateSelectedDocument={model.canActivateSelectedDocument}
        canLinkSelectedDocument={model.canLinkSelectedDocument}
        canMoveSelectedDocument={model.canMoveSelectedDocument}
        canUnlinkSelectedDocument={model.canUnlinkSelectedDocument}
        documentListRevision={model.documentListRevision}
        documentReadModel={model.documentReadModel}
        importDroppedFiles={model.importDroppedFiles}
        linkedContainerIds={model.linkedContainerIds}
        loadContainerInfo={model.loadContainerInfo}
        loadDocumentInfo={model.loadDocumentInfo}
        nodes={model.explorer.nodes}
        online={appData.state.online}
        onBackToSelectionRoute={model.routeState.showSelectionRoute}
        onOpenGrantGroup={openGrantGroupInOrgManager}
        openInlineDocument={model.openInlineDocument}
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
      />
      <ExplorerContextMenuLayer
        canLinkSelectedDocument={model.canLinkSelectedDocument}
        canDeleteContextMenuNode={
          model.contextMenuState.canDeleteContextMenuNode
        }
        canMoveContextMenuNode={model.contextMenuState.canMoveContextMenuNode}
        canMoveSelectedDocument={model.canMoveSelectedDocument}
        closeContextMenu={model.contextMenuState.closeContextMenu}
        contextMenu={model.contextMenuState.contextMenu}
        contextMenuNode={model.contextMenuState.contextMenuNode}
        openDocumentInfoRoute={model.routeState.openDocumentInfoRoute}
        openContainerInfoRoute={model.routeState.openContainerInfoRoute}
        openCreateChildModal={model.modalState.openCreateChildModal}
        openDeleteModal={model.modalState.openDeleteModal}
        openInlineDocument={model.openInlineDocument}
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
