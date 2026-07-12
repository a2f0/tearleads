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
import type { BlobPickTarget } from "../../shared/blob-pick/BlobPickProvider";
import { EXPLORER_LABELS } from "../labels";
import type { ExplorerRoute } from "../routes";
import { ExplorerBlobBrowserPanel } from "./blob/ExplorerBlobBrowserPanel";
import { ExplorerSyncLanesPanel } from "./sync/ExplorerSyncLanesPanel";

type ExplorerSectionTabId = "sync" | "blobs";

const EXPLORER_SECTION_TABS: ReadonlyArray<{
  id: ExplorerSectionTabId;
  label: string;
}> = [
  { id: "sync", label: EXPLORER_LABELS.syncLanesAction },
  { id: "blobs", label: EXPLORER_LABELS.blobBrowserAction },
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
  blobPickTarget: BlobPickTarget | null;
  onCancelBlobPick: () => void;
  onPickBlob: (blob: BlobInfo) => void;
}

/**
 * The full-screen Sync Lanes / Blob Browser hub: a two-tab view over the
 * existing Sync Lanes and Blob Browser panels, rendered in Explorer's main pane
 * when the Sync toolbar action opens the sync/blob route family. The active tab
 * is derived from the route (`blob-browser` -> Blob Browser, otherwise Sync
 * Lanes), and tapping a tab navigates the route so deep links and the back
 * button keep working.
 */
export function ExplorerSectionsPanel(params: ExplorerSectionsPanelProps) {
  const idPrefix = useId();
  const { openBlobBrowserRoute, openSyncLanesRoute, route } = params;
  const activeTab: ExplorerSectionTabId =
    route.view === "blob-browser" ? "blobs" : "sync";

  const selectTab = useCallback(
    (tab: ExplorerSectionTabId) => {
      if (tab === "blobs") {
        openBlobBrowserRoute();
        return;
      }
      openSyncLanesRoute();
    },
    [openBlobBrowserRoute, openSyncLanesRoute],
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
