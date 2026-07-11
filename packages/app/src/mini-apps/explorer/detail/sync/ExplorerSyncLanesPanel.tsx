import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import {
  type DomainScope,
  type DomainSyncSnapshot,
  requestAllDomainSyncLanes,
} from "@tearleads/client-sdk";
import { useCallback, useMemo } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
} from "../../../../components/shared/MiniAppLayout";
import { useWindowTitleBarAction } from "../../../../components/window/WindowMenuContext";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerSyncLaneDetail } from "./ExplorerSyncLaneDetail";
import { ExplorerSyncLaneList } from "./ExplorerSyncLaneList";
import { ExplorerSyncLaneOverview } from "./ExplorerSyncLaneShared";
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
  // When embedded in the compact tabbed hub the tab bar owns top-level
  // navigation, so the list-mode "Back to Explorer" button is suppressed (the
  // lane-detail "Back to List" stays — it navigates within this panel).
  embedded?: boolean;
  onBackToSelectionRoute: () => void;
  onBackToSyncLanesRoute: () => void;
  onOpenLaneDetail: (laneKey: string) => void;
  selectedLaneKey: string | null;
  snapshot: DomainSyncSnapshot;
}) {
  const {
    embedded = false,
    onBackToSelectionRoute,
    onBackToSyncLanesRoute,
    onOpenLaneDetail,
    selectedLaneKey,
    snapshot,
  } = params;
  const showingLaneDetail = selectedLaneKey !== null;

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
          {showingLaneDetail ? (
            <MiniAppButton onClick={onBackToSyncLanesRoute}>
              {EXPLORER_LABELS.syncLanesBackToListAction}
            </MiniAppButton>
          ) : embedded ? null : (
            <MiniAppButton onClick={onBackToSelectionRoute}>
              {EXPLORER_LABELS.syncLanesBackAction}
            </MiniAppButton>
          )}
        </MiniAppActions>
      </MiniAppHeader>
      {selectedLaneKey !== null ? (
        <ExplorerSyncLaneDetail laneKey={selectedLaneKey} snapshot={snapshot} />
      ) : (
        <>
          <ExplorerSyncLaneOverview snapshot={snapshot} />
          <ExplorerSyncLaneList
            lanes={snapshot.lanes}
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
  onBackToSyncLanesRoute: () => void;
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
  // beside the snapshot it needs. It stays disabled while a sync is already in
  // flight (re-requesting then is redundant) and is dropped in lane detail —
  // the same rules the former in-panel button followed.
  const hasPendingWork = snapshot.hasPendingWork;
  const syncNowAction = useMemo(
    () =>
      selectedLaneKey !== null
        ? null
        : {
            disabled: hasPendingWork,
            icon: <ArrowsClockwiseIcon aria-hidden size={18} />,
            id: "explorer-sync-now",
            label: EXPLORER_LABELS.syncLanesSyncNowAction,
            onClick: handleSyncNow,
            priority: 150,
          },
    [handleSyncNow, hasPendingWork, selectedLaneKey],
  );
  useWindowTitleBarAction(syncNowAction);

  return (
    <ExplorerSyncLanesPanelView
      embedded={params.embedded ?? false}
      onBackToSelectionRoute={params.onBackToSelectionRoute}
      onBackToSyncLanesRoute={params.onBackToSyncLanesRoute}
      onOpenLaneDetail={params.onOpenLaneDetail}
      selectedLaneKey={params.selectedLaneKey}
      snapshot={snapshot}
    />
  );
}
