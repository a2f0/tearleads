import type { DocumentSummary } from "../../../data/documentSummary";
import type { StoredDocumentKind } from "../../../data/documents/documentKinds";
import type {
  ExplorerContainerInfo,
  ExplorerContainerShareAccessLevel,
} from "../../../stores/explorer/containerInfo";
import type { ExplorerDocumentReadModel } from "../../../stores/explorer/documentReadModel";
import type { ContainerNode } from "../../../stores/explorer/types";
import type { ImportExplorerDroppedFiles } from "../../../stores/explorer/useExplorerDroppedFileImport";
import type { MiniAppWindowPosition } from "../../bus";
import type { ExplorerRoute } from "../routes";
import { ExplorerContainerDetail } from "./ExplorerContainerDetail";
import { ExplorerContainerInfoPanel } from "./ExplorerContainerInfoPanel";
import { ExplorerDocumentDetail } from "./ExplorerDocumentDetail";

function ExplorerEmptyDetail(params: {
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
}) {
  const { nodes, ready } = params;

  return (
    <div className="explorer-hint">
      {ready && nodes.length > 0
        ? "Select a container."
        : !ready
          ? "Loading..."
          : "No containers."}
    </div>
  );
}

export function ExplorerDetailPanel(params: {
  activateLinkedContainer: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  canActivateSelectedDocument: boolean;
  canLinkSelectedDocument: boolean;
  canMoveSelectedDocument: boolean;
  canUnlinkSelectedDocument: boolean;
  documentListRevision: number;
  documentReadModel: ExplorerDocumentReadModel;
  importDroppedFiles: ImportExplorerDroppedFiles;
  linkedContainerIds: ReadonlyArray<string>;
  loadContainerInfo: (containerId: string) => Promise<ExplorerContainerInfo>;
  nodes: ReadonlyArray<ContainerNode>;
  onBackToSelectionRoute: () => void;
  onOpenGrantGroup: (groupId: string, position?: MiniAppWindowPosition) => void;
  openInlineDocument: (
    containerId: string,
    documentKind: StoredDocumentKind,
    localId?: string,
  ) => void;
  openLinkDocumentModal: (noteId: string) => void;
  openMoveDocumentModal: (noteId: string) => void;
  peerUserId: string | null;
  ready: boolean;
  refreshError: string | null;
  route: ExplorerRoute;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
  selectedDocument: DocumentSummary | undefined;
  selectedNode: ContainerNode | undefined;
  setSelectedId: (id: string | null) => void;
  shareWithGroup: (
    containerId: string,
    groupId: string,
    accessLevel: ExplorerContainerShareAccessLevel,
  ) => Promise<boolean>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
  unlinkDocument: (
    noteId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}) {
  const { route, selectedDocument, selectedNode } = params;

  if (route.view === "container-info") {
    const infoNode = params.nodes.find((node) => node.id === route.containerId);
    return (
      <ExplorerContainerInfoPanel
        containerId={route.containerId}
        containerName={infoNode?.name}
        loadContainerInfo={params.loadContainerInfo}
        onBackToContainer={params.onBackToSelectionRoute}
        onOpenGrantGroup={params.onOpenGrantGroup}
        peerUserId={params.peerUserId}
        shareWithGroup={params.shareWithGroup}
        shareWithUser={params.shareWithUser}
      />
    );
  }

  if (selectedDocument) {
    return (
      <ExplorerDocumentDetail
        activateLinkedContainer={params.activateLinkedContainer}
        canActivateSelectedDocument={params.canActivateSelectedDocument}
        canLinkSelectedDocument={params.canLinkSelectedDocument}
        canMoveSelectedDocument={params.canMoveSelectedDocument}
        canUnlinkSelectedDocument={params.canUnlinkSelectedDocument}
        linkedContainerIds={params.linkedContainerIds}
        nodes={params.nodes}
        openLinkDocumentModal={params.openLinkDocumentModal}
        openMoveDocumentModal={params.openMoveDocumentModal}
        refreshError={params.refreshError}
        selectedDocument={selectedDocument}
        setSelectedId={params.setSelectedId}
        unlinkDocument={params.unlinkDocument}
      />
    );
  }

  if (selectedNode) {
    return (
      <ExplorerContainerDetail
        documentListRevision={params.documentListRevision}
        documentReadModel={params.documentReadModel}
        importDroppedFiles={params.importDroppedFiles}
        openInlineDocument={params.openInlineDocument}
        refreshError={params.refreshError}
        selectedNode={selectedNode}
        selectDocumentProjection={params.selectDocumentProjection}
        setSelectedId={params.setSelectedId}
      />
    );
  }

  return <ExplorerEmptyDetail nodes={params.nodes} ready={params.ready} />;
}
