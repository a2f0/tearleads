import type {
  BlobInfo,
  BlobInfoInput,
  BlobInfoList,
  BlobStore,
  ContainerDocumentQueries,
  ContainerInfo,
  ContainerItemRow,
  ContainerNode,
  ContainerShareAccessLevel,
  DocumentInfo,
  DocumentSummary,
  DomainScope,
  StoredDocumentKind,
} from "@tearleads/client-sdk";
import type { MouseEvent } from "react";
import { MiniAppStatus } from "../../../components/shared/MiniAppLayout";
import type { ImportExplorerDroppedFiles } from "../../../stores/explorer/useExplorerDroppedFileImport";
import type { ExplorerBlobPickTarget } from "../blob-pick/ExplorerBlobPickProvider";
import type { ExplorerContextMenuTarget } from "../context-menu/ExplorerContextMenu";
import { getDocumentByLocalId } from "../documentSummaries";
import { ExplorerDatabaseErrorStatus } from "../ExplorerDatabaseErrorStatus";
import type { ExplorerRoute } from "../routes";
import type { MiniAppWindowPosition } from "../types";
import { ExplorerBlobBrowserPanel } from "./ExplorerBlobBrowserPanel";
import { ExplorerContainerDetail } from "./ExplorerContainerDetail";
import { ExplorerContainerInfoPanel } from "./ExplorerContainerInfoPanel";
import { ExplorerDocumentDetail } from "./ExplorerDocumentDetail";
import { ExplorerDocumentInfoPanel } from "./ExplorerDocumentInfoPanel";
import { ExplorerNewStructuredDocumentPanel } from "./ExplorerNewStructuredDocumentPanel";
import { ExplorerSyncLanesPanel } from "./ExplorerSyncLanesPanel";

function ExplorerEmptyDetail(params: {
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
}) {
  const { nodes, ready } = params;

  // The database-error case is handled once at the top of ExplorerDetailPanel
  // (every route is non-functional without the DB), so this only covers the
  // healthy idle/empty/select states.
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
    documentId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  blobStore: BlobStore;
  canActivateLinkedContainer: boolean;
  canLinkSelectedDocument: boolean;
  canMoveSelectedDocument: boolean;
  canMutateDocumentLinks: boolean;
  // The open row context menu's target, so the container listing can keep the
  // right-clicked row highlighted while the menu is open (it does not select).
  contextTarget: ExplorerContextMenuTarget | null;
  // True when the local SQLite database failed to start; gates the whole panel
  // on an explicit boot error + Retry instead of an endless "Loading...".
  databaseError: boolean;
  currentOrganizationId: string | null | undefined;
  currentSigningFingerprint: string | null | undefined;
  currentUserId: string | null | undefined;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  domainScope: DomainScope;
  importDroppedFiles: ImportExplorerDroppedFiles;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
  loadContainerInfo: (containerId: string) => Promise<ContainerInfo>;
  loadDocumentInfo: (localId: string) => Promise<DocumentInfo>;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  nodes: ReadonlyArray<ContainerNode>;
  online: boolean;
  // Pick mode for the blob-browser route: set when "Choose Blob" on a document
  // routed here. onPickBlob resolves the pick; onCancelBlobPick abandons it.
  blobPickTarget: ExplorerBlobPickTarget | null;
  onCancelBlobPick: () => void;
  onPickBlob: (blob: BlobInfo) => void;
  onContainerContextMenu: (
    event: MouseEvent<HTMLElement>,
    containerId: string,
  ) => void;
  onItemContextMenu: (
    event: MouseEvent<HTMLElement>,
    row: ContainerItemRow,
  ) => void;
  onBackToSelectionRoute: () => void;
  onOpenSyncLaneDetailRoute: (laneKey: string) => void;
  onBackToSyncLanesRoute: () => void;
  onOpenGrant: (
    grant: {
      containerId: string;
      subjectId: string;
      subjectType: "group" | "organization" | "user";
    },
    position?: MiniAppWindowPosition,
  ) => void;
  // Re-attempts the SQLite worker boot after a failure (the Retry action).
  onRetryDatabase: () => void;
  openInlineDocument: (
    containerId: string,
    documentKind: StoredDocumentKind,
    localId?: string,
  ) => void;
  openBlobBrowserRoute: (input?: {
    blobId?: string | null | undefined;
    storageKey?: string | null | undefined;
  }) => void;
  openLinkDocumentModal: (documentId: string) => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  openMoveDocumentModal: (documentId: string) => void;
  peerUserId: string | null;
  ready: boolean;
  refreshError: string | null;
  route: ExplorerRoute;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
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
    documentId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
  visibleSystemSlots: ReadonlySet<NonNullable<ContainerNode["systemSlot"]>>;
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
  // A failed SQLite boot makes every detail route non-functional (they all read
  // from the local database), so gate the whole panel on the error — matching
  // the sidebar — rather than letting individual routes render broken UIs.
  if (params.databaseError) {
    return <ExplorerDatabaseErrorStatus onRetry={params.onRetryDatabase} />;
  }

  const { route, selectedDocument, selectedNode } = params;
  if (route.view === "blob-browser") {
    return (
      <ExplorerBlobBrowserPanel
        blobStore={params.blobStore}
        loadBlobInfo={params.loadBlobInfo}
        nodes={params.nodes}
        onBackToSelectionRoute={params.onBackToSelectionRoute}
        onCancelBlobPick={params.onCancelBlobPick}
        onPickBlob={params.onPickBlob}
        openDocumentInfoRoute={params.openDocumentInfoRoute}
        pickTarget={params.blobPickTarget}
        route={route}
        selectDocumentProjection={params.selectDocumentProjection}
      />
    );
  }

  if (route.view === "sync-lanes") {
    return (
      <ExplorerSyncLanesPanel
        domainScope={params.domainScope}
        onBackToSelectionRoute={params.onBackToSelectionRoute}
        onBackToSyncLanesRoute={params.onBackToSyncLanesRoute}
        onOpenLaneDetail={params.onOpenSyncLaneDetailRoute}
        selectedLaneKey={null}
      />
    );
  }

  if (route.view === "sync-lane-detail") {
    return (
      <ExplorerSyncLanesPanel
        domainScope={params.domainScope}
        onBackToSelectionRoute={params.onBackToSelectionRoute}
        onBackToSyncLanesRoute={params.onBackToSyncLanesRoute}
        onOpenLaneDetail={params.onOpenSyncLaneDetailRoute}
        selectedLaneKey={route.laneKey}
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
        containerSyncStatus={infoNode?.syncState.status ?? null}
        containerNamesById={containerNamesById}
        loadContainerInfo={params.loadContainerInfo}
        onBackToContainer={params.onBackToSelectionRoute}
        onOpenGrant={params.onOpenGrant}
        peerUserId={params.peerUserId}
        shareWithGroup={params.shareWithGroup}
        shareWithUser={params.shareWithUser}
      />
    );
  }

  if (route.view === "document-info") {
    const fallbackDocumentSummary =
      selectedDocument?.id === route.localId
        ? selectedDocument
        : (getDocumentByLocalId(params.documentSummaries, route.localId) ??
          null);

    return (
      <ExplorerDocumentInfoPanel
        activateLinkedContainer={params.activateLinkedContainer}
        canActivateLinkedContainer={params.canActivateLinkedContainer}
        canMutateDocumentLinks={params.canMutateDocumentLinks}
        containerId={route.containerId}
        documentTitle={fallbackDocumentSummary?.title}
        fallbackDocumentSummary={fallbackDocumentSummary}
        linkedContainerIdsByDocumentId={params.linkedContainerIdsByDocumentId}
        loadDocumentInfo={params.loadDocumentInfo}
        loadDocumentSummary={params.loadDocumentSummary}
        localId={route.localId}
        nodes={params.nodes}
        onBackToDocument={params.onBackToSelectionRoute}
        openBlobBrowserRoute={params.openBlobBrowserRoute}
        setSelectedId={params.setSelectedId}
        unlinkDocument={params.unlinkDocument}
      />
    );
  }

  if (route.view === "new-structured-document") {
    return renderExplorerNewStructuredDocumentRoute(params, route);
  }

  if (selectedDocument) {
    return (
      <ExplorerDocumentDetail
        canLinkSelectedDocument={params.canLinkSelectedDocument}
        canMoveSelectedDocument={params.canMoveSelectedDocument}
        documentListRevision={params.documentListRevision}
        documentQueries={params.documentQueries}
        nodes={params.nodes}
        online={params.online}
        openLinkDocumentModal={params.openLinkDocumentModal}
        openDocumentInfoRoute={params.openDocumentInfoRoute}
        openMoveDocumentModal={params.openMoveDocumentModal}
        refreshError={params.refreshError}
        selectedDocument={selectedDocument}
        setSelectedId={params.setSelectedId}
      />
    );
  }

  if (selectedNode) {
    return (
      <ExplorerContainerDetail
        containerNodes={params.nodes}
        contextTarget={params.contextTarget}
        currentOrganizationId={params.currentOrganizationId}
        currentSigningFingerprint={params.currentSigningFingerprint}
        currentUserId={params.currentUserId}
        documentListRevision={params.documentListRevision}
        documentQueries={params.documentQueries}
        importDroppedFiles={params.importDroppedFiles}
        online={params.online}
        onContainerContextMenu={params.onContainerContextMenu}
        onItemContextMenu={params.onItemContextMenu}
        refreshError={params.refreshError}
        selectedNode={selectedNode}
        selectDocumentProjection={params.selectDocumentProjection}
        setSelectedId={params.setSelectedId}
        visibleSystemSlots={params.visibleSystemSlots}
      />
    );
  }

  return <ExplorerEmptyDetail nodes={params.nodes} ready={params.ready} />;
}
