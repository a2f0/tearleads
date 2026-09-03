import type {
  BlobInfo,
  BlobStore,
  ContainerDocumentQueries,
  ContainerInfo,
  ContainerItemRow,
  ContainerNode,
  ContainerShareAccessLevel,
  DocumentInfo,
  DocumentSummary,
  DomainScope,
  OrganizationDirectoryAndGroups,
} from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { MouseEvent } from "react";
import { MiniAppStatus } from "../../../components/mini-app/MiniAppLayout";
import type { AvatarUrlByContactId } from "../../../document-types/contact/useContactAvatarUrls";
import type { ExplorerBlobInfoLoader } from "../../../stores/explorer/blobInfo";
import type { ExplorerDocumentAttributionRangesLoader } from "../../../stores/explorer/documentInfo";
import { isContainerUnderTrash } from "../../../stores/explorer/ExplorerSystemContainers";
import type { BlobPickTarget } from "../../shared/blob-pick/BlobPickProvider";
import type { ExplorerContextMenuTarget } from "../context-menu/ExplorerContextMenu";
import type { ExplorerAttributionProfileHydrationRequester } from "../hooks/explorerAttributionReadModel";
import type { ExplorerUploadManager } from "../hooks/useExplorerUploadManager";
import type { OpenInlineDocument } from "../hooks/useInlineDocumentAction";
import {
  canAdminContainerNode,
  canWriteContainerNode,
} from "../model/containerRules";
import type { ExplorerRoute } from "../routes";
import { ExplorerDatabaseErrorStatus } from "../shared/ExplorerDatabaseErrorStatus";
import type { MiniAppWindowPosition } from "../types";
import type { ExplorerAttributionUserLabelResolver } from "./attributionDisplay";
import { ExplorerContainerDetail } from "./container/ExplorerContainerDetail";
import { ExplorerContainerInfoPanel } from "./container/ExplorerContainerInfoPanel";
import { ExplorerDocumentDetail } from "./document/ExplorerDocumentDetail";
import { ExplorerDocumentInfoPanel } from "./document/ExplorerDocumentInfoPanel";
import { ExplorerNewStructuredDocumentPanel } from "./document/ExplorerNewStructuredDocumentPanel";
import { getDocumentInfoRouteFallbackSummary } from "./documentInfoRouteSummary";
import { ExplorerSectionsPanel } from "./ExplorerSectionsPanel";

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
  openInlineDocument: OpenInlineDocument;
  ready: boolean;
  route: ExplorerNewStructuredDocumentRouteState;
}) {
  const { nodes, openInlineDocument, ready, route } = params;
  const creationNode = nodes.find((node) => node.id === route.containerId);

  if (!creationNode || !canWriteContainerNode(creationNode)) {
    return <ExplorerEmptyDetail nodes={nodes} ready={ready} />;
  }

  return (
    <ExplorerNewStructuredDocumentPanel
      // Creating the document routes straight to it. Do not step back through
      // the selection route first: that would push a history entry, leaving the
      // blank document-type picker behind for the back button to land on
      // (useExplorerRoute replaces the picker when the new document opens).
      onCreateDocument={(documentKind) =>
        openInlineDocument(route.containerId, documentKind)
      }
      selectedNode={creationNode}
    />
  );
}

interface ExplorerDetailPanelProps {
  activateLinkedContainer: (
    documentId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  attributionUserLabelResolver?:
    | ExplorerAttributionUserLabelResolver
    | undefined;
  blobStore: BlobStore;
  billingBlockedOrganizationId: string | null;
  canActivateLinkedContainer: boolean;
  canMutateDocumentLinks: boolean;
  canShareWithPeer: boolean;
  contactAvatarUrlByLocalId: AvatarUrlByContactId;
  // The open row context menu's target, so the container listing can keep the
  // right-clicked row highlighted while the menu is open (it does not select).
  contextTarget: ExplorerContextMenuTarget | null;
  // True when the local SQLite database failed to start; gates the whole panel
  // on an explicit boot error + Retry instead of an endless "Loading...".
  databaseError: boolean;
  currentOrganizationId: string | null | undefined;
  currentSigningFingerprint: string | null | undefined;
  currentSelfContactLocalId: string | null | undefined;
  currentUserId: string | null | undefined;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  domainScope: DomainScope;
  uploadManager: ExplorerUploadManager;
  initialEditingSelectedDocument: boolean;
  isAuthenticated: boolean;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  loadBlobInfo: ExplorerBlobInfoLoader;
  loadContainerInfo: (containerId: string) => Promise<ContainerInfo>;
  loadDocumentAttributionRanges: ExplorerDocumentAttributionRangesLoader;
  loadDocumentInfo: (localId: string) => Promise<DocumentInfo>;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  nodes: ReadonlyArray<ContainerNode>;
  online: boolean;
  organizationNamesById: ReadonlyMap<string, string>;
  readModelProjection?: OrganizationDirectoryAndGroups | null | undefined;
  readModelRevision?: number | undefined;
  readModelScope?: object | null | undefined;
  requestAttributionProfileHydration: ExplorerAttributionProfileHydrationRequester;
  // Pick mode for the blob-browser route: set when "Choose Blob" on a document
  // routed here. onPickBlob resolves the pick; onCancelBlobPick abandons it.
  blobPickTarget: BlobPickTarget | null;
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
  onInitialEditingSelectedDocumentConsumed: (localId: string) => void;
  onOpenSyncLaneDetailRoute: (laneKey: string) => void;
  openSyncLanesRoute: () => void;
  onOpenGrant: (
    grant: {
      containerId: string;
      subjectId: string;
      subjectType: "group" | "user";
    },
    position?: MiniAppWindowPosition,
  ) => void;
  // Re-attempts the SQLite worker boot after a failure (the Retry action).
  onRetryDatabase: () => void;
  openInlineDocument: OpenInlineDocument;
  openBlobBrowserRoute: (input?: {
    blobId?: string | null | undefined;
    storageKey?: string | null | undefined;
  }) => void;
  openContainerInfoRoute: (containerId: string) => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  openUploadsRoute: () => void;
  openWriteQueueRoute: () => void;
  openWriteQueueEntryRoute: (entryKey: string) => void;
  peerUserId: string | null;
  ready: boolean;
  refreshError: string | null;
  route: ExplorerRoute;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
  selectedDocument: DocumentSummary | undefined;
  selectedNode: ContainerNode | undefined;
  setContainerIcon: (
    containerId: string,
    icon: string | null,
  ) => Promise<ContainerNode | null>;
  setSelectedId: (id: string | null) => void;
  // Edit ranges are raw attribution trace data, so the Get Info section stays
  // behind the developer feature flag rather than shipping to every viewer.
  showDocumentEditRanges: boolean;
  // The per-object sync dot beside the detail header's title. The footer tray
  // already reports sync for the whole write queue, so this one — which speaks
  // only for the selected object — stays behind a flag rather than sitting in
  // every viewer's header.
  showHeaderSyncIndicator: boolean;
  showLinkedDocumentActivationControls: boolean;
  // The viewer's derived Trash system slot, used with currentOrganizationId to
  // detect whether the selected object is trashed and should render read-only (no
  // edit button, no editing, no blob attach/detach). Rules-based detection also
  // catches a peer's shared Trash under a foreign org's root. UI-only; the API
  // does not enforce this.
  trashSystemSlot: ContainerSystemSlot | null;
  shareWithGroup: (
    containerId: string,
    groupId: string,
    accessLevel: ContainerShareAccessLevel,
    options: { expectedGroupName: string },
  ) => Promise<boolean>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
  unlinkDocument: (
    documentId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
  visibleSystemSlots: ReadonlySet<NonNullable<ContainerNode["systemSlot"]>>;
}

export function ExplorerDetailPanel(params: ExplorerDetailPanelProps) {
  // A failed SQLite boot makes every detail route non-functional (they all read
  // from the local database), so gate the whole panel on the error — matching
  // the sidebar — rather than letting individual routes render broken UIs.
  if (params.databaseError) {
    return <ExplorerDatabaseErrorStatus onRetry={params.onRetryDatabase} />;
  }

  return renderExplorerRouteDetail(params);
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Route rendering stays explicit so each Explorer state is easy to follow.
function renderExplorerRouteDetail(params: ExplorerDetailPanelProps) {
  const { route, selectedDocument, selectedNode } = params;

  // The Sync toolbar action and diagnostics deep links render the full-screen
  // Explorer diagnostics hub in the main pane (the folder tree stays in the
  // sidebar so a container is always one click away). A blob pick in flight
  // renders the hub's bare Blob Browser (the hub hides its tabs mid-pick).
  if (
    route.view === "sync-lanes" ||
    route.view === "sync-lane-detail" ||
    route.view === "blob-browser" ||
    route.view === "write-queue" ||
    route.view === "write-queue-entry" ||
    route.view === "uploads"
  ) {
    return (
      <ExplorerSectionsPanel
        blobPickTarget={params.blobPickTarget}
        blobStore={params.blobStore}
        billingBlockedOrganizationId={params.billingBlockedOrganizationId}
        domainScope={params.domainScope}
        documentListRevision={params.documentListRevision}
        documentQueries={params.documentQueries}
        isAuthenticated={params.isAuthenticated}
        loadBlobInfo={params.loadBlobInfo}
        nodes={params.nodes}
        onCancelBlobPick={params.onCancelBlobPick}
        onOpenSyncLaneDetailRoute={params.onOpenSyncLaneDetailRoute}
        onPickBlob={params.onPickBlob}
        online={params.online}
        organizationNamesById={params.organizationNamesById}
        openBlobBrowserRoute={params.openBlobBrowserRoute}
        openContainerInfoRoute={params.openContainerInfoRoute}
        openDocumentInfoRoute={params.openDocumentInfoRoute}
        openSyncLanesRoute={params.openSyncLanesRoute}
        openUploadsRoute={params.openUploadsRoute}
        openWriteQueueRoute={params.openWriteQueueRoute}
        openWriteQueueEntryRoute={params.openWriteQueueEntryRoute}
        route={route}
        selectDocumentProjection={params.selectDocumentProjection}
        uploadManager={params.uploadManager}
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
        // Only a container admin may change the icon, and app-managed system
        // folders (Trash, Contacts) keep their fixed icons, so gate those out.
        canManageIcon={canAdminContainerNode(infoNode) && !infoNode?.systemSlot}
        containerIcon={infoNode?.icon ?? null}
        containerId={route.containerId}
        containerName={infoNode?.name}
        containerSyncStatus={infoNode?.syncState.status ?? null}
        containerNamesById={containerNamesById}
        canShareContainer={canWriteContainerNode(infoNode)}
        canShareWithPeer={params.canShareWithPeer}
        loadContainerInfo={params.loadContainerInfo}
        onOpenGrant={params.onOpenGrant}
        readModelProjection={params.readModelProjection}
        readModelRevision={params.readModelRevision}
        readModelScope={params.readModelScope}
        peerUserId={params.peerUserId}
        setContainerIcon={params.setContainerIcon}
        shareWithGroup={params.shareWithGroup}
        shareWithUser={params.shareWithUser}
      />
    );
  }

  if (route.view === "document-info") {
    const fallbackDocumentSummary = getDocumentInfoRouteFallbackSummary({
      documentSummaries: params.documentSummaries,
      localId: route.localId,
      selectedDocument,
    });

    return (
      <ExplorerDocumentInfoPanel
        activateLinkedContainer={params.activateLinkedContainer}
        attributionUserLabelResolver={params.attributionUserLabelResolver}
        canActivateLinkedContainer={params.canActivateLinkedContainer}
        canMutateDocumentLinks={params.canMutateDocumentLinks}
        containerId={route.containerId}
        documentTitle={fallbackDocumentSummary?.title}
        fallbackDocumentSummary={fallbackDocumentSummary}
        linkedContainerIdsByDocumentId={params.linkedContainerIdsByDocumentId}
        loadDocumentAttributionRanges={params.loadDocumentAttributionRanges}
        loadDocumentInfo={params.loadDocumentInfo}
        loadDocumentSummary={params.loadDocumentSummary}
        localId={route.localId}
        nodes={params.nodes}
        openBlobBrowserRoute={params.openBlobBrowserRoute}
        requestAttributionProfileHydration={
          params.requestAttributionProfileHydration
        }
        setSelectedId={params.setSelectedId}
        showDocumentEditRanges={params.showDocumentEditRanges}
        showLinkedDocumentActivationControls={
          params.showLinkedDocumentActivationControls
        }
        unlinkDocument={params.unlinkDocument}
      />
    );
  }

  if (route.view === "new-structured-document") {
    return (
      <ExplorerNewStructuredDocumentRoutePanel
        nodes={params.nodes}
        openInlineDocument={params.openInlineDocument}
        ready={params.ready}
        route={route}
      />
    );
  }

  if (selectedDocument) {
    // A document living anywhere under Trash renders read-only: no edit button,
    // no note edit mode, no blob attach/detach. Enforced in the UI only.
    const selectedDocumentReadOnly = isContainerUnderTrash(
      params.nodes,
      selectedDocument.containerId,
      {
        currentOrganizationId: params.currentOrganizationId,
        trashSystemSlot: params.trashSystemSlot,
      },
    );
    return (
      <ExplorerDocumentDetail
        currentSigningFingerprint={params.currentSigningFingerprint}
        currentSelfContactLocalId={params.currentSelfContactLocalId}
        currentUserId={params.currentUserId}
        documentListRevision={params.documentListRevision}
        documentQueries={params.documentQueries}
        nodes={params.nodes}
        online={params.online}
        initialEditing={params.initialEditingSelectedDocument}
        onInitialEditingConsumed={
          params.onInitialEditingSelectedDocumentConsumed
        }
        readOnly={selectedDocumentReadOnly}
        refreshError={params.refreshError}
        selectedDocument={selectedDocument}
        showHeaderSyncIndicator={params.showHeaderSyncIndicator}
      />
    );
  }

  if (selectedNode) {
    return (
      <ExplorerContainerDetail
        containerNodes={params.nodes}
        contactAvatarUrlByLocalId={params.contactAvatarUrlByLocalId}
        contextTarget={params.contextTarget}
        currentOrganizationId={params.currentOrganizationId}
        currentSigningFingerprint={params.currentSigningFingerprint}
        currentSelfContactLocalId={params.currentSelfContactLocalId}
        currentUserId={params.currentUserId}
        documentListRevision={params.documentListRevision}
        documentQueries={params.documentQueries}
        uploadManager={params.uploadManager}
        online={params.online}
        onContainerContextMenu={params.onContainerContextMenu}
        onItemContextMenu={params.onItemContextMenu}
        refreshError={params.refreshError}
        selectedNode={selectedNode}
        selectDocumentProjection={params.selectDocumentProjection}
        setSelectedId={params.setSelectedId}
        showHeaderSyncIndicator={params.showHeaderSyncIndicator}
        visibleSystemSlots={params.visibleSystemSlots}
      />
    );
  }

  return <ExplorerEmptyDetail nodes={params.nodes} ready={params.ready} />;
}
