import type { DomainScope, DomainSyncSnapshot } from "@tearleads/client-sdk";
import {
  getDomainSyncCoordinatorSnapshot,
  subscribeToDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import { useCallback } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
} from "../../../components/shared/MiniAppLayout";
import { useTearleadsExternalValue } from "../../../providers/sdk/useTearleadsSubscription";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS } from "../labels";
import { ExplorerSyncLaneDetail } from "./ExplorerSyncLaneDetail";
import { ExplorerSyncLaneList } from "./ExplorerSyncLaneList";
import { ExplorerSyncLaneOverview } from "./ExplorerSyncLaneShared";
import "./ExplorerSyncLanesPanel.css";

export { getExplorerSyncLaneProgress } from "./ExplorerSyncLaneUtils";

function useDomainSyncSnapshot(domainScope: DomainScope): DomainSyncSnapshot {
  const subscribe = useCallback(
    (listener: () => void) =>
      subscribeToDomainSyncCoordinator(domainScope, listener),
    [domainScope],
  );
  const getSnapshot = useCallback(
    () => getDomainSyncCoordinatorSnapshot(domainScope),
    [domainScope],
  );

  return useTearleadsExternalValue(subscribe, getSnapshot);
}

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
  onBackToSelectionRoute: () => void;
  onBackToSyncLanesRoute: () => void;
  onOpenLaneDetail: (laneKey: string) => void;
  selectedLaneKey: string | null;
  snapshot: DomainSyncSnapshot;
}) {
  const {
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
      variant="framed"
    >
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>
            {showingLaneDetail
              ? EXPLORER_LABELS.syncLanesDetailTitle
              : EXPLORER_LABELS.syncLanesTitle}
          </strong>
          <span>
            {showingLaneDetail
              ? getSyncLaneDetailSubtitle(snapshot, selectedLaneKey)
              : formatMiniAppDateTime(snapshot.updatedAt, {
                  emptyFallback: "-",
                })}
          </span>
        </MiniAppHeaderCopy>
        <MiniAppActions>
          <MiniAppButton
            onClick={
              showingLaneDetail
                ? onBackToSyncLanesRoute
                : onBackToSelectionRoute
            }
          >
            {showingLaneDetail
              ? EXPLORER_LABELS.syncLanesBackToListAction
              : EXPLORER_LABELS.syncLanesBackAction}
          </MiniAppButton>
        </MiniAppActions>
      </MiniAppHeader>
      {showingLaneDetail ? (
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
  domainScope: DomainScope;
  onBackToSelectionRoute: () => void;
  onBackToSyncLanesRoute: () => void;
  onOpenLaneDetail: (laneKey: string) => void;
  selectedLaneKey: string | null;
}) {
  const snapshot = useDomainSyncSnapshot(params.domainScope);

  return (
    <ExplorerSyncLanesPanelView
      onBackToSelectionRoute={params.onBackToSelectionRoute}
      onBackToSyncLanesRoute={params.onBackToSyncLanesRoute}
      onOpenLaneDetail={params.onOpenLaneDetail}
      selectedLaneKey={params.selectedLaneKey}
      snapshot={snapshot}
    />
  );
}
