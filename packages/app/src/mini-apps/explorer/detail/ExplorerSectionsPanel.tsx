import type {
  BlobInfo,
  BlobInfoInput,
  BlobInfoList,
  BlobStore,
  ContainerDocumentQueries,
  ContainerNode,
  DomainScope,
} from "@tearleads/client-sdk";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useId,
} from "react";
import { MiniAppButton } from "../../../components/mini-app/MiniAppLayout";
import type { BlobPickTarget } from "../../shared/blob-pick/BlobPickProvider";
import type { ExplorerUploadManager } from "../hooks/useExplorerUploadManager";
import { EXPLORER_LABELS } from "../labels";
import type { ExplorerRoute } from "../routes";
import { ExplorerBlobBrowserPanel } from "./blob/ExplorerBlobBrowserPanel";
import { ExplorerSyncLanesPanel } from "./sync/ExplorerSyncLanesPanel";
import { ExplorerUploadsPanel } from "./sync/ExplorerUploadsPanel";
import { ExplorerWriteQueuePanel } from "./sync/ExplorerWriteQueuePanel";

type ExplorerSectionTabId = "sync" | "blobs" | "writes" | "uploads";

const EXPLORER_SECTION_TABS: ReadonlyArray<{
  id: ExplorerSectionTabId;
  label: string;
}> = [
  { id: "sync", label: EXPLORER_LABELS.syncLanesAction },
  { id: "blobs", label: EXPLORER_LABELS.blobBrowserAction },
  { id: "writes", label: EXPLORER_LABELS.writeQueueAction },
  { id: "uploads", label: EXPLORER_LABELS.uploadsAction },
];

// Roving tabindex per the WAI-ARIA tab pattern (mirrors SystemMonitorTabs): only
// the active tab is in the tab order; arrow/Home/End move focus and selection.
function ExplorerSectionTabBar({
  activeTab,
  idPrefix,
  onSelect,
}: {
  activeTab: ExplorerSectionTabId;
  idPrefix: string;
  onSelect: (tab: ExplorerSectionTabId) => void;
}) {
  const handleTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const lastIndex = EXPLORER_SECTION_TABS.length - 1;
      const currentIndex = EXPLORER_SECTION_TABS.findIndex(
        (tab) => tab.id === activeTab,
      );
      let nextIndex: number;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          nextIndex = currentIndex >= lastIndex ? 0 : currentIndex + 1;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = lastIndex;
          break;
        default:
          return;
      }
      const nextTab = EXPLORER_SECTION_TABS[nextIndex];
      if (!nextTab) {
        return;
      }
      event.preventDefault();
      onSelect(nextTab.id);
      document.getElementById(`${idPrefix}-${nextTab.id}-tab`)?.focus();
    },
    [activeTab, idPrefix, onSelect],
  );

  return (
    <div
      aria-label={EXPLORER_LABELS.compactSectionsTabsLabel}
      className="explorer-info-tabs explorer-sections-tabs"
      role="tablist"
    >
      {EXPLORER_SECTION_TABS.map((tab) => (
        <MiniAppButton
          aria-controls={`${idPrefix}-${tab.id}-panel`}
          aria-selected={activeTab === tab.id}
          className="explorer-info-tab"
          id={`${idPrefix}-${tab.id}-tab`}
          key={tab.id}
          role="tab"
          tabIndex={activeTab === tab.id ? 0 : -1}
          variant="ghost"
          onClick={() => {
            onSelect(tab.id);
          }}
          onKeyDown={handleTabKeyDown}
        >
          {tab.label}
        </MiniAppButton>
      ))}
    </div>
  );
}

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
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
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
        domainScope={params.domainScope}
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

  return (
    <div className="explorer-sections-hub">
      <ExplorerSectionTabBar
        activeTab={activeTab}
        idPrefix={idPrefix}
        onSelect={selectTab}
      />
      <div
        aria-labelledby={`${idPrefix}-${activeTab}-tab`}
        className="explorer-sections-tab-panel"
        id={`${idPrefix}-${activeTab}-panel`}
        role="tabpanel"
      >
        <ExplorerSectionsActivePanel {...params} />
      </div>
    </div>
  );
}
