import { usePeerUserId } from "../../components/pane/DualPaneProvider";
import { useWindowRefreshMenuItem } from "../../components/window/WindowMenuContext";
import { useWindowSidebar } from "../../components/window/WindowSidebarContext";
import { useAppData } from "../../providers/data/AppDataProvider";
import { useExplorer } from "../../stores/explorer/ExplorerProvider";
import { ExplorerContextMenuLayer } from "./context-menu/ExplorerContextMenu";
import { ExplorerDetailPanel } from "./detail/ExplorerDetailPanel";
import { useExplorerModel } from "./hooks/useExplorerModel";
import { ExplorerModalLayer } from "./modal/ExplorerModal";
import "./Explorer.css";

export { buildDocumentsByContainerId } from "./documentProjections";

export function Explorer() {
  const appData = useAppData();
  const explorer = useExplorer();
  const { setSidebar } = useWindowSidebar();
  const peerUserId = usePeerUserId();
  const model = useExplorerModel(appData, explorer, setSidebar, peerUserId);
  useWindowRefreshMenuItem({
    disabled: !model.explorer.ready || model.isRefreshing,
    onRefresh: model.handleRefresh,
    priority: 100,
    refreshing: model.isRefreshing,
  });

  return (
    <div className="explorer">
      <ExplorerDetailPanel
        activateLinkedContainer={model.activateLinkedContainer}
        canActivateSelectedDocument={model.canActivateSelectedDocument}
        canLinkSelectedDocument={model.canLinkSelectedDocument}
        canMoveSelectedDocument={model.canMoveSelectedDocument}
        canUnlinkSelectedDocument={model.canUnlinkSelectedDocument}
        documentListRevision={model.documentListRevision}
        documentReadModel={model.documentReadModel}
        linkedContainerIds={model.linkedContainerIds}
        loadContainerInfo={model.loadContainerInfo}
        nodes={model.explorer.nodes}
        onBackToSelectionRoute={model.routeState.showSelectionRoute}
        openInlineDocument={model.openInlineDocument}
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
        canDeleteContextMenuNode={
          model.contextMenuState.canDeleteContextMenuNode
        }
        canMoveContextMenuNode={model.contextMenuState.canMoveContextMenuNode}
        closeContextMenu={model.contextMenuState.closeContextMenu}
        contextMenu={model.contextMenuState.contextMenu}
        contextMenuNode={model.contextMenuState.contextMenuNode}
        openContainerInfoRoute={model.routeState.openContainerInfoRoute}
        openCreateChildModal={model.modalState.openCreateChildModal}
        openDeleteModal={model.modalState.openDeleteModal}
        openInlineDocument={model.openInlineDocument}
        openMoveModal={model.modalState.openMoveModal}
        openRenameModal={model.modalState.openRenameModal}
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
    </div>
  );
}
