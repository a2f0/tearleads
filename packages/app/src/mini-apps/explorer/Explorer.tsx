import { usePeerUserId } from "../../components/pane/DualPaneProvider";
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

  return (
    <div className="explorer">
      <ExplorerDetailPanel
        activateLinkedContainer={model.activateLinkedContainer}
        canActivateSelectedDocument={model.canActivateSelectedDocument}
        canLinkSelectedDocument={model.canLinkSelectedDocument}
        canMoveSelectedDocument={model.canMoveSelectedDocument}
        canUnlinkSelectedDocument={model.canUnlinkSelectedDocument}
        documentsByContainerId={model.documentsByContainerId}
        handleRefresh={model.handleRefresh}
        isRefreshing={model.isRefreshing}
        linkedContainerIds={model.linkedContainerIds}
        nodes={model.explorer.nodes}
        openInlineDocument={model.openInlineDocument}
        openLinkDocumentModal={model.modalState.openLinkDocumentModal}
        openMoveDocumentModal={model.modalState.openMoveDocumentModal}
        ready={model.explorer.ready}
        refreshError={model.refreshError}
        selectDocumentProjection={model.selectDocumentProjection}
        selectedNode={model.selection.selectedNode}
        selectedDocument={model.selection.selectedDocument}
        setSelectedId={model.selection.setSelectedId}
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
        openContainerInfoModal={model.modalState.openContainerInfoModal}
        openCreateChildModal={model.modalState.openCreateChildModal}
        openDeleteModal={model.modalState.openDeleteModal}
        openInlineDocument={model.openInlineDocument}
        openMoveModal={model.modalState.openMoveModal}
        openRenameModal={model.modalState.openRenameModal}
      />
      <ExplorerModalLayer
        closeModal={model.modalState.closeModal}
        containerInfo={model.modalState.containerInfo}
        containerInfoError={model.modalState.containerInfoError}
        draftName={model.modalState.draftName}
        draftShareAccessLevel={model.modalState.draftShareAccessLevel}
        draftShareGroupId={model.modalState.draftShareGroupId}
        draftTargetContainerId={model.modalState.draftTargetContainerId}
        handleContainerInfoPeerShare={
          model.modalState.handleContainerInfoPeerShare
        }
        handleModalSubmit={model.modalState.handleModalSubmit}
        isLoadingContainerInfo={model.modalState.isLoadingContainerInfo}
        isSubmittingModal={model.modalState.isSubmittingModal}
        modalError={model.modalState.modalError}
        modalState={model.modalState.modalState}
        moveTargetOptions={model.modalState.moveTargetOptions}
        nameInputRef={model.modalState.nameInputRef}
        peerUserId={model.peerUserId}
        setDraftName={model.modalState.setDraftName}
        setDraftShareAccessLevel={model.modalState.setDraftShareAccessLevel}
        setDraftShareGroupId={model.modalState.setDraftShareGroupId}
        setModalError={model.modalState.setModalError}
        setDraftTargetContainerId={model.modalState.setDraftTargetContainerId}
        targetSelectRef={model.modalState.targetSelectRef}
      />
    </div>
  );
}
