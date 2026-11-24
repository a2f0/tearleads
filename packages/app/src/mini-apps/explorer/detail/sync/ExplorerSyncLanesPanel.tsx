import {
  type ContainerDocumentQueries,
  type DomainScope,
  type DomainSyncSnapshot,
  requestAllDomainSyncLanes,
} from "@tearleads/client-sdk";
import { useWindowRefreshMenuItem } from "@tearleads/windowing";
import { useCallback, useMemo, useState } from "react";
import { MiniAppPanel } from "../../../../components/mini-app/MiniAppLayout";
import { useDomainSyncSnapshot } from "../../../../providers/sdk/useDomainSyncSnapshot";
import { EXPLORER_LABELS } from "../../labels";
import {
  ExplorerSyncLaneDetail,
  type ExplorerSyncLaneDocumentLinks,
} from "./ExplorerSyncLaneDetail";
import { ExplorerSyncLaneList } from "./ExplorerSyncLaneList";
import { ExplorerSyncLaneOverview } from "./ExplorerSyncLaneShared";
import { filterSyncLanes, type SyncLaneFilter } from "./ExplorerSyncLaneUtils";
import "./ExplorerSyncLanesPanel.css";

export { getExplorerSyncLaneProgress } from "./ExplorerSyncLaneUtils";

// The panel opens straight onto its content: the hub's tab names the view, and
// the lane-detail "Back to Sync Lanes" affordance lives on the window toolbar
// (registered by ExplorerRoutedChrome).
export function ExplorerSyncLanesPanelView(params: {
  documentLinks?: ExplorerSyncLaneDocumentLinks | undefined;
  onOpenBlobDetail?: ((storageKey: string) => void) | undefined;
  onOpenLaneDetail: (laneKey: string) => void;
  selectedLaneKey: string | null;
  snapshot: DomainSyncSnapshot;
}) {
  const {
    documentLinks,
    onOpenBlobDetail,
    onOpenLaneDetail,
    selectedLaneKey,
    snapshot,
  } = params;
  // Held above the list/detail branch so a filter survives a round trip into a
  // lane detail and back.
  const [laneFilter, setLaneFilter] = useState<SyncLaneFilter>(null);
  const visibleLanes = useMemo(
    () => filterSyncLanes(snapshot.lanes, laneFilter),
    [laneFilter, snapshot.lanes],
  );

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--sync-lanes"
      scroll
    >
      {selectedLaneKey !== null ? (
        <ExplorerSyncLaneDetail
          documentLinks={documentLinks}
          laneKey={selectedLaneKey}
          onOpenBlobDetail={onOpenBlobDetail}
          snapshot={snapshot}
        />
      ) : (
        <>
          <ExplorerSyncLaneOverview
            activeFilter={laneFilter}
            onSelectFilter={setLaneFilter}
            snapshot={snapshot}
          />
          <ExplorerSyncLaneList
            emptyMessage={
              laneFilter === null
                ? EXPLORER_LABELS.syncLanesNoLanes
                : EXPLORER_LABELS.syncLanesNoFilteredLanes
            }
            lanes={visibleLanes}
            onOpenLaneDetail={onOpenLaneDetail}
          />
        </>
      )}
    </MiniAppPanel>
  );
}

export function ExplorerSyncLanesPanel(params: {
  documentQueries?: ContainerDocumentQueries | undefined;
  domainScope: DomainScope;
  onOpenBlobDetail?: ((storageKey: string) => void) | undefined;
  onOpenDocument?: ((localId: string, containerId: string) => void) | undefined;
  onOpenLaneDetail: (laneKey: string) => void;
  selectedLaneKey: string | null;
}) {
  const snapshot = useDomainSyncSnapshot(params.domainScope);
  const { documentQueries, domainScope, onOpenDocument, selectedLaneKey } =
    params;
  // Stable per database, so a lane detail's summary load runs once per lane.
  const loadDocumentSummary = useCallback(
    (localId: string) =>
      documentQueries
        ? documentQueries.loadDocumentSummary(localId, {
            requireHydrated: true,
          })
        : Promise.resolve(null),
    [documentQueries],
  );
  const documentLinks = useMemo<ExplorerSyncLaneDocumentLinks | undefined>(
    () =>
      documentQueries && onOpenDocument
        ? { loadDocumentSummary, openDocument: onOpenDocument }
        : undefined,
    [documentQueries, loadDocumentSummary, onOpenDocument],
  );
  const handleRefresh = useCallback(
    () => requestAllDomainSyncLanes(domainScope),
    [domainScope],
  );

  // Re-requesting is idempotent and must remain enabled while lanes are pending:
  // a stuck queue is exactly when this escape hatch is needed (issue #1672).
  // The live snapshot subscription reflects the requested work as it runs.
  useWindowRefreshMenuItem(
    selectedLaneKey !== null
      ? null
      : {
          onRefresh: handleRefresh,
          priority: 200,
        },
  );

  return (
    <ExplorerSyncLanesPanelView
      documentLinks={documentLinks}
      onOpenBlobDetail={params.onOpenBlobDetail}
      onOpenLaneDetail={params.onOpenLaneDetail}
      selectedLaneKey={params.selectedLaneKey}
      snapshot={snapshot}
    />
  );
}
