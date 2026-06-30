import {
  type DomainScope,
  type DomainSyncSnapshot,
  requestAllDomainSyncLanes,
} from "@tearleads/client-sdk";
import { useCallback } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
} from "../../../components/shared/MiniAppLayout";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS } from "../labels";
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
  onBackToSelectionRoute: () => void;
  onBackToSyncLanesRoute: () => void;
  onOpenLaneDetail: (laneKey: string) => void;
  onSyncNow: () => void;
  selectedLaneKey: string | null;
  snapshot: DomainSyncSnapshot;
}) {
  const {
    onBackToSelectionRoute,
    onBackToSyncLanesRoute,
    onOpenLaneDetail,
    onSyncNow,
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
          {showingLaneDetail ? null : (
            <MiniAppButton onClick={onSyncNow}>
              {EXPLORER_LABELS.syncLanesSyncNowAction}
            </MiniAppButton>
          )}
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
  domainScope: DomainScope;
  onBackToSelectionRoute: () => void;
  onBackToSyncLanesRoute: () => void;
  onOpenLaneDetail: (laneKey: string) => void;
  selectedLaneKey: string | null;
}) {
  const snapshot = useDomainSyncSnapshot(params.domainScope);
  const { domainScope } = params;
  const handleSyncNow = useCallback(
    () => requestAllDomainSyncLanes(domainScope),
    [domainScope],
  );

  return (
    <ExplorerSyncLanesPanelView
      onBackToSelectionRoute={params.onBackToSelectionRoute}
      onBackToSyncLanesRoute={params.onBackToSyncLanesRoute}
      onOpenLaneDetail={params.onOpenLaneDetail}
      onSyncNow={handleSyncNow}
      selectedLaneKey={params.selectedLaneKey}
      snapshot={snapshot}
    />
  );
}
