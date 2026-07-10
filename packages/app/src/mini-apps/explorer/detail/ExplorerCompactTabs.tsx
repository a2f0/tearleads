import type {
  BlobInfo,
  BlobInfoInput,
  BlobInfoList,
  BlobStore,
  ContainerNode,
  DomainScope,
} from "@tearleads/client-sdk";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useId,
} from "react";
import { MiniAppButton } from "../../../components/shared/MiniAppLayout";
import type { ExplorerBlobPickTarget } from "../blob-pick/ExplorerBlobPickProvider";
import { EXPLORER_LABELS } from "../labels";
import type { ExplorerRoute } from "../routes";
import { ExplorerBlobBrowserPanel } from "./ExplorerBlobBrowserPanel";
import { ExplorerSyncLanesPanel } from "./ExplorerSyncLanesPanel";

type ExplorerCompactTabId = "sync" | "blobs";

const EXPLORER_COMPACT_TABS: ReadonlyArray<{
  id: ExplorerCompactTabId;
  label: string;
}> = [
  { id: "sync", label: EXPLORER_LABELS.syncLanesAction },
  { id: "blobs", label: EXPLORER_LABELS.blobBrowserAction },
];

/**
 * The routes whose compact (mobile) presentation is the tabbed Sync Lanes /
 * Blob Browser hub. Other detail routes (document/container info, new document)
 * still render their own full-screen panel, so deep links and in-tab actions
 * that open them keep working.
 */
export function isExplorerCompactHubRoute(
  view: ExplorerRoute["view"],
): boolean {
  return (
    view === "selection" ||
    view === "sync-lanes" ||
    view === "sync-lane-detail" ||
    view === "blob-browser"
  );
}

// Roving tabindex per the WAI-ARIA tab pattern (mirrors SystemMonitorTabs): only
// the active tab is in the tab order; arrow/Home/End move focus and selection.
function ExplorerCompactTabBar({
  activeTab,
  idPrefix,
  onSelect,
}: {
  activeTab: ExplorerCompactTabId;
  idPrefix: string;
  onSelect: (tab: ExplorerCompactTabId) => void;
}) {
  const handleTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const lastIndex = EXPLORER_COMPACT_TABS.length - 1;
      const currentIndex = EXPLORER_COMPACT_TABS.findIndex(
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
      const nextTab = EXPLORER_COMPACT_TABS[nextIndex];
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
      className="explorer-info-tabs explorer-compact-tabs"
      role="tablist"
    >
      {EXPLORER_COMPACT_TABS.map((tab) => (
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

interface ExplorerCompactTabsProps {
  route: ExplorerRoute;
  domainScope: DomainScope;
  onOpenSyncLaneDetailRoute: (laneKey: string) => void;
  openSyncLanesRoute: () => void;
  blobStore: BlobStore;
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
  nodes: ReadonlyArray<ContainerNode>;
  online: boolean;
  openBlobBrowserRoute: (input?: {
    blobId?: string | null | undefined;
    storageKey?: string | null | undefined;
  }) => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
  blobPickTarget: ExplorerBlobPickTarget | null;
  onCancelBlobPick: () => void;
  onPickBlob: (blob: BlobInfo) => void;
}

/**
 * The compact (mobile) main-pane view for Explorer: a two-tab hub over the
 * existing Sync Lanes and Blob Browser panels. Mobile has no folder sidebar, so
 * this replaces the folder-driven layout. The active tab is derived from the
 * route (`blob-browser` → Blob Browser, otherwise Sync Lanes), and tapping a tab
 * navigates the route — so deep links and the back button keep working.
 */
export function ExplorerCompactTabs(params: ExplorerCompactTabsProps) {
  const idPrefix = useId();
  const { openBlobBrowserRoute, openSyncLanesRoute, route } = params;
  const activeTab: ExplorerCompactTabId =
    route.view === "blob-browser" ? "blobs" : "sync";

  const selectTab = useCallback(
    (tab: ExplorerCompactTabId) => {
      if (tab === "blobs") {
        openBlobBrowserRoute();
        return;
      }
      openSyncLanesRoute();
    },
    [openBlobBrowserRoute, openSyncLanesRoute],
  );

  return (
    <div className="explorer-compact-tabs-hub">
      <ExplorerCompactTabBar
        activeTab={activeTab}
        idPrefix={idPrefix}
        onSelect={selectTab}
      />
      <div
        aria-labelledby={`${idPrefix}-${activeTab}-tab`}
        className="explorer-compact-tab-panel"
        id={`${idPrefix}-${activeTab}-panel`}
        role="tabpanel"
      >
        {route.view === "blob-browser" ? (
          <ExplorerBlobBrowserPanel
            embedded
            blobStore={params.blobStore}
            domainScope={params.domainScope}
            loadBlobInfo={params.loadBlobInfo}
            nodes={params.nodes}
            online={params.online}
            onBackToSelectionRoute={openSyncLanesRoute}
            onCancelBlobPick={params.onCancelBlobPick}
            onPickBlob={params.onPickBlob}
            openDocumentInfoRoute={params.openDocumentInfoRoute}
            pickTarget={params.blobPickTarget}
            route={route}
            selectDocumentProjection={params.selectDocumentProjection}
          />
        ) : (
          <ExplorerSyncLanesPanel
            embedded
            domainScope={params.domainScope}
            onBackToSelectionRoute={openSyncLanesRoute}
            onBackToSyncLanesRoute={openSyncLanesRoute}
            onOpenLaneDetail={params.onOpenSyncLaneDetailRoute}
            selectedLaneKey={
              route.view === "sync-lane-detail" ? route.laneKey : null
            }
          />
        )}
      </div>
    </div>
  );
}
