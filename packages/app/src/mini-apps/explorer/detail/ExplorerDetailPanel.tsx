import type {
  BlobInfoInput,
  BlobInfoList,
  BlobStore,
  ContainerDocumentReadModel,
  ContainerInfo,
  ContainerNode,
  ContainerShareAccessLevel,
  DocumentInfo,
  DocumentSummary,
  StoredDocumentKind,
} from "@tearleads/client-sdk";
import { MiniAppStatus } from "../../../components/shared/MiniAppLayout";
import type { ImportExplorerDroppedFiles } from "../../../stores/explorer/useExplorerDroppedFileImport";
import type { MiniAppWindowPosition } from "../../bus";
import type { ExplorerRoute } from "../routes";
import { ExplorerBlobBrowserPanel } from "./ExplorerBlobBrowserPanel";
import { ExplorerContainerDetail } from "./ExplorerContainerDetail";
import { ExplorerContainerInfoPanel } from "./ExplorerContainerInfoPanel";
import { ExplorerDocumentDetail } from "./ExplorerDocumentDetail";
import { ExplorerDocumentInfoPanel } from "./ExplorerDocumentInfoPanel";
import { ExplorerNewStructuredDocumentPanel } from "./ExplorerNewStructuredDocumentPanel";

function ExplorerEmptyDetail(params: {
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
}) {
  const { nodes, ready } = params;

  return (
    <MiniAppStatus>
      {ready && nodes.length > 0
        ? "Select a container."
        : !ready
          ? "Loading..."
          : "No containers."}
    </MiniAppStatus>
  );
}

type ExplorerNewStructuredDocumentRouteState = Extract<
  ExplorerRoute,
  { view: "new-structured-document" }
>;

function ExplorerNewStructuredDocumentRoutePanel(params: {
  nodes: ReadonlyArray<ContainerNode>;
  onBackToSelectionRoute: () => void;
  openInlineDocument: (
    containerId: string,
    documentKind: StoredDocumentKind,
    localId?: string,
  ) => void;
  ready: boolean;
  route: ExplorerNewStructuredDocumentRouteState;
}) {
  const { nodes, onBackToSelectionRoute, openInlineDocument, ready, route } =
    params;
  const creationNode = nodes.find((node) => node.id === route.containerId);

  if (!creationNode) {
    return <ExplorerEmptyDetail nodes={nodes} ready={ready} />;
  }

  return (
    <ExplorerNewStructuredDocumentPanel
      onBackToContainer={onBackToSelectionRoute}
      onCreateDocument={(documentKind) => {
        onBackToSelectionRoute();
        openInlineDocument(route.containerId, documentKind);
      }}
      selectedNode={creationNode}
    />
  );
}

interface ExplorerDetailPanelProps {
  activateLinkedContainer: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  blobStore: BlobStore;
  canActivateSelectedDocument: boolean;
  canLinkSelectedDocument: boolean;
  canMoveSelectedDocument: boolean;
  canUnlinkSelectedDocument: boolean;
  documentListRevision: number;
  documentReadModel: ContainerDocumentReadModel;
  importDroppedFiles: ImportExplorerDroppedFiles;
  linkedContainerIds: ReadonlyArray<string>;
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
  loadContainerInfo: (containerId: string) => Promise<ContainerInfo>;
  loadDocumentInfo: (localId: string) => Promise<DocumentInfo>;
  nodes: ReadonlyArray<ContainerNode>;
  online: boolean;
  onBackToSelectionRoute: () => void;
  onOpenGrantGroup: (groupId: string, position?: MiniAppWindowPosition) => void;
  openInlineDocument: (
    containerId: string,
    documentKind: StoredDocumentKind,
    localId?: string,
  ) => void;
  openBlobBrowserRoute: (input?: {
    blobId?: string | null | undefined;
    storageKey?: string | null | undefined;
  }) => void;
  openLinkDocumentModal: (noteId: string) => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
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
    accessLevel: ContainerShareAccessLevel,
  ) => Promise<boolean>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
  unlinkDocument: (
    noteId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}

function renderExplorerNewStructuredDocumentRoute(
  params: ExplorerDetailPanelProps,
  route: ExplorerNewStructuredDocumentRouteState,
) {
  return (
    <ExplorerNewStructuredDocumentRoutePanel
      nodes={params.nodes}
      onBackToSelectionRoute={params.onBackToSelectionRoute}
      openInlineDocument={params.openInlineDocument}
      ready={params.ready}
      route={route}
    />
  );
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Route rendering stays explicit so each Explorer state is easy to follow.
export function ExplorerDetailPanel(params: ExplorerDetailPanelProps) {
  const { route, selectedDocument, selectedNode } = params;
  if (route.view === "blob-browser") {
    return (
      <ExplorerBlobBrowserPanel
        blobStore={params.blobStore}
        loadBlobInfo={params.loadBlobInfo}
        nodes={params.nodes}
        onBackToSelectionRoute={params.onBackToSelectionRoute}
        openDocumentInfoRoute={params.openDocumentInfoRoute}
        route={route}
        selectDocumentProjection={params.selectDocumentProjection}
      />
    );
  }

  if (route.view === "container-info") {
    const infoNode = params.nodes.find((node) => node.id === route.containerId);
    const containerNamesById = new Map(
      params.nodes.map((node) => [node.id, node.name]),
    );
    return (
      <ExplorerContainerInfoPanel
        containerId={route.containerId}
        containerName={infoNode?.name}
        containerNamesById={containerNamesById}
        loadContainerInfo={params.loadContainerInfo}
        onBackToContainer={params.onBackToSelectionRoute}
        onOpenGrantGroup={params.onOpenGrantGroup}
        peerUserId={params.peerUserId}
        shareWithGroup={params.shareWithGroup}
        shareWithUser={params.shareWithUser}
      />
    );
  }

  if (route.view === "document-info") {
    return (
      <ExplorerDocumentInfoPanel
        containerId={route.containerId}
        documentTitle={selectedDocument?.title}
        loadDocumentInfo={params.loadDocumentInfo}
        localId={route.localId}
        nodes={params.nodes}
        onBackToDocument={params.onBackToSelectionRoute}
        openBlobBrowserRoute={params.openBlobBrowserRoute}
      />
    );
  }

  if (route.view === "new-structured-document") {
    return renderExplorerNewStructuredDocumentRoute(params, route);
  }

  if (selectedDocument) {
    return (
      <ExplorerDocumentDetail
        activateLinkedContainer={params.activateLinkedContainer}
        canActivateSelectedDocument={params.canActivateSelectedDocument}
        canLinkSelectedDocument={params.canLinkSelectedDocument}
        canMoveSelectedDocument={params.canMoveSelectedDocument}
        canUnlinkSelectedDocument={params.canUnlinkSelectedDocument}
        documentListRevision={params.documentListRevision}
        documentReadModel={params.documentReadModel}
        linkedContainerIds={params.linkedContainerIds}
        nodes={params.nodes}
        online={params.online}
        openLinkDocumentModal={params.openLinkDocumentModal}
        openDocumentInfoRoute={params.openDocumentInfoRoute}
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
        online={params.online}
        refreshError={params.refreshError}
        selectedNode={selectedNode}
        selectDocumentProjection={params.selectDocumentProjection}
        setSelectedId={params.setSelectedId}
      />
    );
  }

  return <ExplorerEmptyDetail nodes={params.nodes} ready={params.ready} />;
}
