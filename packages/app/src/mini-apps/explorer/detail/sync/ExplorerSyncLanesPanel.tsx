import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import {
  type DomainScope,
  type DomainSyncSnapshot,
  requestAllDomainSyncLanes,
} from "@symcrypt/client-sdk";
import { useCallback, useMemo, useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
} from "../../../../components/mini-app/MiniAppLayout";
import { useWindowTitleBarAction } from "../../../../components/window/WindowMenuContext";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerSyncLaneDetail } from "./ExplorerSyncLaneDetail";
import { ExplorerSyncLaneList } from "./ExplorerSyncLaneList";
import { ExplorerSyncLaneOverview } from "./ExplorerSyncLaneShared";
import { filterSyncLanes, type SyncLaneFilter } from "./ExplorerSyncLaneUtils";
import { useDomainSyncSnapshot } from "./useDomainSyncSnapshot";
import "./ExplorerSyncLanesPanel.css";

export { getExplorerSyncLaneProgress } from "./ExplorerSyncLaneUtils";

function getSyncLaneDetailSubtitle(
  snapshot: DomainSyncSnapshot,
  selectedLaneKey: string,
): string {
  return (
    snapshot.lanes.find((lane) => lane.key === selectedLaneKey)?.label ??
    selectedLaneKey
  );
}

export function ExplorerSyncLanesPanelView(params: {
  // The lane-detail "Back to Sync Lanes" affordance lives on the window toolbar
  // (registered by ExplorerRoutedChrome), so the panel renders no in-detail back
  // button. In list mode the "Back to Explorer" button is suppressed when
  // embedded, since the compact tabbed hub's tab bar owns top-level navigation.
  embedded?: boolean;
  onBackToSelectionRoute: () => void;
  onOpenBlobDetail?: ((storageKey: string) => void) | undefined;
  onOpenLaneDetail: (laneKey: string) => void;
  selectedLaneKey: string | null;
  snapshot: DomainSyncSnapshot;
}) {
  const {
    embedded = false,
    onBackToSelectionRoute,
    onOpenBlobDetail,
    onOpenLaneDetail,
    selectedLaneKey,
    snapshot,
  } = params;
  const showingLaneDetail = selectedLaneKey !== null;
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
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>
            {showingLaneDetail
              ? EXPLORER_LABELS.syncLanesDetailTitle
              : EXPLORER_LABELS.syncLanesTitle}
          </strong>
          <span>
            {selectedLaneKey !== null
              ? getSyncLaneDetailSubtitle(snapshot, selectedLaneKey)
              : formatMiniAppDateTime(snapshot.updatedAt, {
                  emptyFallback: "-",
                })}
          </span>
        </MiniAppHeaderCopy>
        <MiniAppActions>
          {showingLaneDetail || embedded ? null : (
            <MiniAppButton onClick={onBackToSelectionRoute}>
              {EXPLORER_LABELS.syncLanesBackAction}
            </MiniAppButton>
          )}
        </MiniAppActions>
      </MiniAppHeader>
      {selectedLaneKey !== null ? (
        <ExplorerSyncLaneDetail
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
  embedded?: boolean;
  domainScope: DomainScope;
  onBackToSelectionRoute: () => void;
  onOpenBlobDetail?: ((storageKey: string) => void) | undefined;
  onOpenLaneDetail: (laneKey: string) => void;
  selectedLaneKey: string | null;
}) {
  const snapshot = useDomainSyncSnapshot(params.domainScope);
  const { domainScope, selectedLaneKey } = params;
  const handleSyncNow = useCallback(
    () => requestAllDomainSyncLanes(domainScope),
    [domainScope],
  );

  // The manual "Sync now" trigger lives on the window toolbar, registered here
  // beside the snapshot it needs. It stays ENABLED even while work is pending:
  // re-requesting is idempotent and cheap, and the moment the user most needs
  // the escape hatch is exactly when the queue looks stuck with pending work
  // (issue #1672 — the old disabled-while-pending rule made a wedged queue
  // unrecoverable from the UI). Dropped in lane detail as before.
  const syncNowAction = useMemo(
    () =>
      selectedLaneKey !== null
        ? null
        : {
            disabled: false,
            icon: <ArrowsClockwiseIcon aria-hidden size={18} />,
            id: "explorer-sync-now",
            label: EXPLORER_LABELS.syncLanesSyncNowAction,
            onClick: handleSyncNow,
            priority: 150,
          },
    [handleSyncNow, selectedLaneKey],
  );
  useWindowTitleBarAction(syncNowAction);

  return (
    <ExplorerSyncLanesPanelView
      embedded={params.embedded ?? false}
      onBackToSelectionRoute={params.onBackToSelectionRoute}
      onOpenBlobDetail={params.onOpenBlobDetail}
      onOpenLaneDetail={params.onOpenLaneDetail}
      selectedLaneKey={params.selectedLaneKey}
      snapshot={snapshot}
    />
  );
}
