import type {
  BlobInfo,
  BlobStore,
  ContainerDocumentQueries,
  ContainerNode,
  DomainScope,
} from "@tearleads/client-sdk";
import { useCallback, useId } from "react";
import {
  type MiniAppTabDescriptor,
  MiniAppTabList,
  MiniAppTabPanel,
} from "../../../components/mini-app/MiniAppLayout";
import type { ExplorerBlobInfoLoader } from "../../../stores/explorer/blobInfo";
import type { BlobPickTarget } from "../../shared/blob-pick/BlobPickProvider";
import type { ExplorerUploadManager } from "../hooks/useExplorerUploadManager";
import { EXPLORER_LABELS } from "../labels";
import type { ExplorerRoute } from "../routes";
import { ExplorerBlobBrowserPanel } from "./blob/ExplorerBlobBrowserPanel";
import { ExplorerSyncLanesPanel } from "./sync/ExplorerSyncLanesPanel";
import {
  type ExplorerDownloadDestinations,
  ExplorerDownloadsPanel,
} from "./transfers/ExplorerDownloadsPanel";
import { ExplorerOutgoingPanel } from "./transfers/ExplorerOutgoingPanel";
import "./ExplorerSectionsPanel.css";

type ExplorerSectionTabId = "sync" | "blobs" | "outgoing" | "incoming";

// The engine view and local blobs, then what waits in each direction.
const EXPLORER_SECTION_TABS: ReadonlyArray<
  MiniAppTabDescriptor<ExplorerSectionTabId>
> = [
  { id: "sync", label: EXPLORER_LABELS.syncLanesAction },
  { id: "blobs", label: EXPLORER_LABELS.blobBrowserAction },
  { id: "outgoing", label: EXPLORER_LABELS.outgoingAction },
  { id: "incoming", label: EXPLORER_LABELS.incomingAction },
];

interface ExplorerSectionsPanelProps {
  route: ExplorerRoute;
  billingBlockedOrganizationId: string | null;
  dbReady: boolean;
  domainScope: DomainScope;
  documentQueries: ContainerDocumentQueries;
  isAuthenticated: boolean;
  onOpenSyncLaneDetailRoute: (laneKey: string) => void;
  openSyncLanesRoute: () => void;
  blobStore: BlobStore;
  loadBlobInfo: ExplorerBlobInfoLoader;
  nodes: ReadonlyArray<ContainerNode>;
  online: boolean;
  organizationNamesById: ReadonlyMap<string, string>;
  openBlobBrowserRoute: (input?: {
    blobId?: string | null | undefined;
    storageKey?: string | null | undefined;
  }) => void;
  openContainerInfoRoute: (containerId: string) => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  openIncomingRoute: () => void;
  openOutgoingRoute: () => void;
  openWriteQueueEntryRoute: (entryKey: string) => void;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
  blobPickTarget: BlobPickTarget | null;
  onCancelBlobPick: () => void;
  onPickBlob: (blob: BlobInfo) => void;
  uploadManager: ExplorerUploadManager;
}

// Renders the panel the current route selects; the hub component below owns
// the tab bar around it.
function ExplorerSectionsActivePanel(params: ExplorerSectionsPanelProps) {
  const { route } = params;
  if (route.view === "blob-browser") {
    return (
      <ExplorerBlobBrowserPanel
        blobStore={params.blobStore}
        loadBlobInfo={params.loadBlobInfo}
        nodes={params.nodes}
        online={params.online}
        onCancelBlobPick={params.onCancelBlobPick}
        onPickBlob={params.onPickBlob}
        openDocumentInfoRoute={params.openDocumentInfoRoute}
        organizationNamesById={params.organizationNamesById}
        pickTarget={params.blobPickTarget}
        route={route}
        selectDocumentProjection={params.selectDocumentProjection}
      />
    );
  }
  if (route.view === "incoming") {
    const downloadDestinations: ExplorerDownloadDestinations = {
      openBlobDetail: (storageKey) =>
        params.openBlobBrowserRoute({ storageKey }),
      openContainerInfoRoute: params.openContainerInfoRoute,
      openDocumentInfoRoute: params.openDocumentInfoRoute,
    };
    return (
      <ExplorerDownloadsPanel
        dbReady={params.dbReady}
        destinations={downloadDestinations}
        documentQueries={params.documentQueries}
        domainScope={params.domainScope}
        online={params.online}
        isAuthenticated={params.isAuthenticated}
      />
    );
  }
  if (route.view === "outgoing" || route.view === "write-queue-entry") {
    return (
      <ExplorerOutgoingPanel
        billingBlockedOrganizationId={params.billingBlockedOrganizationId}
        dbReady={params.dbReady}
        documentQueries={params.documentQueries}
        domainScope={params.domainScope}
        isAuthenticated={params.isAuthenticated}
        nodes={params.nodes}
        online={params.online}
        openContainerInfoRoute={params.openContainerInfoRoute}
        openDocument={params.selectDocumentProjection}
        openWriteQueueEntryRoute={params.openWriteQueueEntryRoute}
        organizationNamesById={params.organizationNamesById}
        selectedEntryKey={
          route.view === "write-queue-entry" ? route.entryKey : null
        }
        uploadManager={params.uploadManager}
      />
    );
  }
  return (
    <ExplorerSyncLanesPanel
      embedded
      documentQueries={params.documentQueries}
      domainScope={params.domainScope}
      onBackToSelectionRoute={params.openSyncLanesRoute}
      onOpenBlobDetail={(storageKey) => {
        params.openBlobBrowserRoute({ storageKey });
      }}
      onOpenDocument={params.selectDocumentProjection}
      onOpenLaneDetail={params.onOpenSyncLaneDetailRoute}
      selectedLaneKey={route.view === "sync-lane-detail" ? route.laneKey : null}
    />
  );
}

function getActiveExplorerSectionTab(
  route: ExplorerSectionsPanelProps["route"],
): ExplorerSectionTabId {
  if (route.view === "blob-browser") {
    return "blobs";
  }
  if (route.view === "outgoing" || route.view === "write-queue-entry") {
    return "outgoing";
  }
  if (route.view === "incoming") return "incoming";
  return "sync";
}

/**
 * The full-screen Explorer diagnostics hub: route-backed tabs for transient
 * sync-lane telemetry (both directions), local blob state, what waits to
 * leave this device (uploads and the durable write queue), and what waits to
 * reach it (the download queue and finished downloads).
 */
export function ExplorerSectionsPanel(params: ExplorerSectionsPanelProps) {
  const idPrefix = useId();
  const {
    openBlobBrowserRoute,
    openIncomingRoute,
    openOutgoingRoute,
    openSyncLanesRoute,
    route,
  } = params;
  const activeTab = getActiveExplorerSectionTab(route);
  const selectTab = useCallback(
    (tab: ExplorerSectionTabId) => {
      if (tab === "blobs") {
        openBlobBrowserRoute();
        return;
      }
      if (tab === "outgoing") {
        openOutgoingRoute();
        return;
      }
      if (tab === "incoming") {
        openIncomingRoute();
        return;
      }
      openSyncLanesRoute();
    },
    [
      openBlobBrowserRoute,
      openIncomingRoute,
      openOutgoingRoute,
      openSyncLanesRoute,
    ],
  );

  // A blob pick in flight (a document's "Choose Blob" flow routed here) keeps
  // the focused bare Blob Browser — no hub tabs to wander off into mid-pick.
  if (params.blobPickTarget !== null && route.view === "blob-browser") {
    return <ExplorerSectionsActivePanel {...params} />;
  }

  return (
    <div className="explorer-sections-hub">
      <MiniAppTabList
        activeTab={activeTab}
        className="explorer-sections-tabs"
        idPrefix={idPrefix}
        label={EXPLORER_LABELS.compactSectionsTabsLabel}
        leading
        onSelect={selectTab}
        tabs={EXPLORER_SECTION_TABS}
      />
      <MiniAppTabPanel
        activeTab={activeTab}
        className="explorer-sections-tab-panel"
        idPrefix={idPrefix}
      >
        <ExplorerSectionsActivePanel {...params} />
      </MiniAppTabPanel>
    </div>
  );
}
