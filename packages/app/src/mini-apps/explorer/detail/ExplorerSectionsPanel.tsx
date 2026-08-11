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
import { ExplorerUploadsPanel } from "./sync/ExplorerUploadsPanel";
import { ExplorerWriteQueuePanel } from "./sync/ExplorerWriteQueuePanel";
import "./ExplorerSectionsPanel.css";

type ExplorerSectionTabId = "sync" | "blobs" | "writes" | "uploads";

const EXPLORER_SECTION_TABS: ReadonlyArray<
  MiniAppTabDescriptor<ExplorerSectionTabId>
> = [
  { id: "sync", label: EXPLORER_LABELS.syncLanesAction },
  { id: "blobs", label: EXPLORER_LABELS.blobBrowserAction },
  { id: "writes", label: EXPLORER_LABELS.writeQueueAction },
  { id: "uploads", label: EXPLORER_LABELS.uploadsAction },
];

interface ExplorerSectionsPanelProps {
  route: ExplorerRoute;
  billingBlockedOrganizationId: string | null;
  domainScope: DomainScope;
  documentListRevision: number;
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
  openUploadsRoute: () => void;
  openWriteQueueRoute: () => void;
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
  if (route.view === "uploads") {
    return (
      <ExplorerUploadsPanel
        domainScope={params.domainScope}
        uploadManager={params.uploadManager}
      />
    );
  }
  if (route.view === "write-queue" || route.view === "write-queue-entry") {
    return (
      <ExplorerWriteQueuePanel
        billingBlockedOrganizationId={params.billingBlockedOrganizationId}
        documentListRevision={params.documentListRevision}
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
      />
    );
  }
  return (
    <ExplorerSyncLanesPanel
      embedded
      domainScope={params.domainScope}
      onBackToSelectionRoute={params.openSyncLanesRoute}
      onOpenBlobDetail={(storageKey) => {
        params.openBlobBrowserRoute({ storageKey });
      }}
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
  if (route.view === "write-queue" || route.view === "write-queue-entry") {
    return "writes";
  }
  if (route.view === "uploads") {
    return "uploads";
  }
  return "sync";
}

/**
 * The full-screen Explorer diagnostics hub: route-backed tabs for transient
 * sync-lane telemetry, local blob state, durable pending writes, and the
 * session upload queue.
 */
export function ExplorerSectionsPanel(params: ExplorerSectionsPanelProps) {
  const idPrefix = useId();
  const {
    openBlobBrowserRoute,
    openSyncLanesRoute,
    openUploadsRoute,
    openWriteQueueRoute,
    route,
  } = params;
  const activeTab = getActiveExplorerSectionTab(route);
  const selectTab = useCallback(
    (tab: ExplorerSectionTabId) => {
      if (tab === "blobs") {
        openBlobBrowserRoute();
        return;
      }
      if (tab === "writes") {
        openWriteQueueRoute();
        return;
      }
      if (tab === "uploads") {
        openUploadsRoute();
        return;
      }
      openSyncLanesRoute();
    },
    [
      openBlobBrowserRoute,
      openSyncLanesRoute,
      openUploadsRoute,
      openWriteQueueRoute,
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
