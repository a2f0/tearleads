import type { SyncLaneSnapshot } from "@tearleads/client-sdk";
import type { ReactNode } from "react";
import { classNames } from "../../../components/shared/classNames";
import { EXPLORER_LABELS, getExplorerSyncLaneCountLabel } from "../labels";
import {
  ExplorerSyncLaneLastAction,
  ExplorerSyncLaneProgress,
  ExplorerSyncLaneStatusBadge,
} from "./ExplorerSyncLaneShared";
import { getSyncLanePhaseLabel } from "./ExplorerSyncLaneUtils";

const SYNC_LANE_LIST_COLUMNS = [
  { id: "lane", label: EXPLORER_LABELS.syncLanesLaneColumn },
  { id: "phase", label: EXPLORER_LABELS.syncLanesPhaseColumn },
  { id: "status", label: EXPLORER_LABELS.syncLanesStatusColumn },
  { id: "progress", label: EXPLORER_LABELS.syncLanesProgressColumn },
  { id: "last-action", label: EXPLORER_LABELS.syncLanesLastActionColumn },
  { id: "counts", label: EXPLORER_LABELS.syncLanesCountsColumn },
] as const;

function ExplorerSyncLaneListHeader() {
  return (
    <div className="explorer-sync-lane-list-head">
      {SYNC_LANE_LIST_COLUMNS.map((column) => (
        <span key={column.id}>{column.label}</span>
      ))}
    </div>
  );
}

function ExplorerSyncLaneListCell(params: {
  children: ReactNode;
  className?: string | undefined;
  label: string;
}) {
  return (
    <span
      className={classNames("explorer-sync-lane-list-cell", params.className)}
      data-label={params.label}
    >
      {params.children}
    </span>
  );
}

function ExplorerSyncLaneListRow(params: {
  lane: SyncLaneSnapshot;
  onOpenLaneDetail: (laneKey: string) => void;
}) {
  const { lane, onOpenLaneDetail } = params;

  return (
    <button
      aria-label={`${EXPLORER_LABELS.syncLanesOpenLaneAction}: ${lane.label}`}
      className="explorer-sync-lane-list-row"
      onClick={() => onOpenLaneDetail(lane.key)}
      title={lane.lastError ?? undefined}
      type="button"
    >
      <span className="explorer-sync-lane-list-primary">
        <span className="explorer-sync-lane-list-label">{lane.label}</span>
        <code>{lane.key}</code>
      </span>
      <ExplorerSyncLaneListCell label={EXPLORER_LABELS.syncLanesPhaseColumn}>
        {getSyncLanePhaseLabel(lane.phase)}
      </ExplorerSyncLaneListCell>
      <ExplorerSyncLaneListCell label={EXPLORER_LABELS.syncLanesStatusColumn}>
        <ExplorerSyncLaneStatusBadge status={lane.status} />
      </ExplorerSyncLaneListCell>
      <ExplorerSyncLaneListCell
        className="explorer-sync-lane-list-cell--progress"
        label={EXPLORER_LABELS.syncLanesProgressColumn}
      >
        <ExplorerSyncLaneProgress lane={lane} />
      </ExplorerSyncLaneListCell>
      <ExplorerSyncLaneListCell
        label={EXPLORER_LABELS.syncLanesLastActionColumn}
      >
        <ExplorerSyncLaneLastAction lane={lane} />
      </ExplorerSyncLaneListCell>
      <ExplorerSyncLaneListCell label={EXPLORER_LABELS.syncLanesCountsColumn}>
        {getExplorerSyncLaneCountLabel({
          errorCount: lane.errorCount,
          requestCount: lane.requestCount,
          runCount: lane.runCount,
        })}
      </ExplorerSyncLaneListCell>
    </button>
  );
}

export function ExplorerSyncLaneList(params: {
  lanes: ReadonlyArray<SyncLaneSnapshot>;
  onOpenLaneDetail: (laneKey: string) => void;
}) {
  if (params.lanes.length === 0) {
    return (
      <div className="explorer-sync-lane-list explorer-sync-lane-list--empty">
        <div className="explorer-sync-lane-empty">
          {EXPLORER_LABELS.syncLanesNoLanes}
        </div>
      </div>
    );
  }

  return (
    <div className="explorer-sync-lane-list">
      <ExplorerSyncLaneListHeader />
      {params.lanes.map((lane) => (
        <ExplorerSyncLaneListRow
          key={lane.key}
          lane={lane}
          onOpenLaneDetail={params.onOpenLaneDetail}
        />
      ))}
    </div>
  );
}
