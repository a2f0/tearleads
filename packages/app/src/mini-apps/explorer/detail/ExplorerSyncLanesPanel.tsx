import type {
  DomainScope,
  DomainSyncSnapshot,
  SyncLaneLastAction,
  SyncLanePhase,
  SyncLaneSnapshot,
  SyncLaneStatus,
} from "@tearleads/client-sdk";
import {
  getDomainSyncCoordinatorSnapshot,
  subscribeToDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import { useCallback, useMemo } from "react";
import { classNames } from "../../../components/shared/classNames";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
} from "../../../components/shared/MiniAppLayout";
import {
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
} from "../../../components/shared/MiniAppTable";
import { useTearleadsExternalValue } from "../../../providers/sdk/useTearleadsSubscription";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import {
  EXPLORER_LABELS,
  getExplorerSyncLaneCountLabel,
  getExplorerSyncLaneUploadProgressLabel,
} from "../labels";

interface SyncLaneSummary {
  complete: number;
  errors: number;
  idle: number;
  queued: number;
  registered: number;
  running: number;
}

const SYNC_LANE_COLUMNS: ReadonlyArray<MiniAppTableColumn> = [
  {
    header: EXPLORER_LABELS.syncLanesLaneColumn,
    id: "lane",
    width: "30%",
  },
  {
    header: EXPLORER_LABELS.syncLanesPhaseColumn,
    id: "phase",
    width: "8rem",
  },
  {
    header: EXPLORER_LABELS.syncLanesStatusColumn,
    id: "status",
    width: "8rem",
  },
  {
    header: EXPLORER_LABELS.syncLanesProgressColumn,
    id: "progress",
    width: "11rem",
  },
  {
    header: EXPLORER_LABELS.syncLanesLastActionColumn,
    id: "last-action",
    width: "16rem",
  },
  {
    header: EXPLORER_LABELS.syncLanesCountsColumn,
    id: "counts",
    width: "15rem",
  },
];

const SYNC_LANE_PROGRESS_BY_STATUS: Record<SyncLaneStatus, number> = {
  complete: 100,
  error: 100,
  idle: 0,
  queued: 25,
  running: 65,
};

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

export function getExplorerSyncLaneProgress(status: SyncLaneStatus): number {
  return SYNC_LANE_PROGRESS_BY_STATUS[status];
}

function getExplorerSyncLaneStatusLabel(status: SyncLaneStatus): string {
  switch (status) {
    case "complete":
      return EXPLORER_LABELS.syncLanesStatusComplete;
    case "error":
      return EXPLORER_LABELS.syncLanesStatusError;
    case "queued":
      return EXPLORER_LABELS.syncLanesStatusQueued;
    case "running":
      return EXPLORER_LABELS.syncLanesStatusRunning;
    case "idle":
      return EXPLORER_LABELS.syncLanesStatusIdle;
  }
}

function getSyncLanePhaseLabel(phase: SyncLanePhase): string {
  switch (phase) {
    case "structural":
      return EXPLORER_LABELS.syncLanesStructuralPhase;
    case "blob":
      return EXPLORER_LABELS.syncLanesBlobPhase;
    case "document":
      return EXPLORER_LABELS.syncLanesDocumentPhase;
  }
}

function getSyncLaneLastActionLabel(action: SyncLaneLastAction): string {
  switch (action) {
    case "completed":
      return EXPLORER_LABELS.syncLanesLastActionCompleted;
    case "failed":
      return EXPLORER_LABELS.syncLanesLastActionFailed;
    case "registered":
      return EXPLORER_LABELS.syncLanesLastActionRegistered;
    case "requested":
      return EXPLORER_LABELS.syncLanesLastActionRequested;
    case "started":
      return EXPLORER_LABELS.syncLanesLastActionStarted;
  }
}

function summarizeSyncLanes(snapshot: DomainSyncSnapshot): SyncLaneSummary {
  const summary: SyncLaneSummary = {
    complete: 0,
    errors: 0,
    idle: 0,
    queued: 0,
    registered: snapshot.lanes.length,
    running: 0,
  };

  for (const lane of snapshot.lanes) {
    if (lane.status === "complete") {
      summary.complete += 1;
    } else if (lane.status === "error") {
      summary.errors += 1;
    } else if (lane.status === "idle") {
      summary.idle += 1;
    } else if (lane.status === "queued") {
      summary.queued += 1;
    } else if (lane.status === "running") {
      summary.running += 1;
    }
  }

  return summary;
}

function ExplorerSyncLaneMetric(params: { label: string; value: number }) {
  return (
    <div className="explorer-sync-lane-metric">
      <strong>{params.value.toLocaleString()}</strong>
      <span>{params.label}</span>
    </div>
  );
}

function ExplorerSyncLaneOverview(params: { snapshot: DomainSyncSnapshot }) {
  const summary = useMemo(
    () => summarizeSyncLanes(params.snapshot),
    [params.snapshot],
  );

  return (
    <div className="explorer-sync-lane-overview">
      <ExplorerSyncLaneMetric
        label={EXPLORER_LABELS.syncLanesRegisteredMetric}
        value={summary.registered}
      />
      <ExplorerSyncLaneMetric
        label={EXPLORER_LABELS.syncLanesRunningMetric}
        value={summary.running}
      />
      <ExplorerSyncLaneMetric
        label={EXPLORER_LABELS.syncLanesQueuedMetric}
        value={summary.queued}
      />
      <ExplorerSyncLaneMetric
        label={EXPLORER_LABELS.syncLanesCompleteMetric}
        value={summary.complete}
      />
      <ExplorerSyncLaneMetric
        label={EXPLORER_LABELS.syncLanesErrorMetric}
        value={summary.errors}
      />
      <ExplorerSyncLaneMetric
        label={EXPLORER_LABELS.syncLanesIdleMetric}
        value={summary.idle}
      />
    </div>
  );
}

function ExplorerSyncLaneStatusBadge(params: { status: SyncLaneStatus }) {
  const label = getExplorerSyncLaneStatusLabel(params.status);

  return (
    <span
      className={classNames(
        "explorer-sync-lane-status",
        `explorer-sync-lane-status--${params.status}`,
      )}
    >
      {label}
    </span>
  );
}

function getExplorerSyncLaneProgressPercent(lane: SyncLaneSnapshot): number {
  if (lane.progress && lane.progress.bytesTotal > 0) {
    const ratio = lane.progress.bytesUploaded / lane.progress.bytesTotal;
    return Math.max(0, Math.min(100, Math.round(ratio * 100)));
  }

  return getExplorerSyncLaneProgress(lane.status);
}

function ExplorerSyncLaneProgress(params: { lane: SyncLaneSnapshot }) {
  const { lane } = params;
  const label = getExplorerSyncLaneStatusLabel(lane.status);
  const percent = getExplorerSyncLaneProgressPercent(lane);

  return (
    <>
      <div
        aria-label={label}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        className={classNames(
          "explorer-sync-lane-progress",
          `explorer-sync-lane-progress--${lane.status}`,
        )}
        role="progressbar"
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      {lane.progress ? (
        <MiniAppTableText muted>
          {getExplorerSyncLaneUploadProgressLabel(lane.progress)}
        </MiniAppTableText>
      ) : null}
    </>
  );
}

function ExplorerSyncLaneLastAction(params: { lane: SyncLaneSnapshot }) {
  const actionLabel = getSyncLaneLastActionLabel(params.lane.lastAction);

  return (
    <>
      <MiniAppTableText>{actionLabel}</MiniAppTableText>
      <MiniAppTableText muted>
        {formatMiniAppDateTime(params.lane.lastActionAt, {
          emptyFallback: "-",
        })}
      </MiniAppTableText>
    </>
  );
}

function ExplorerSyncLaneRow(params: { lane: SyncLaneSnapshot }) {
  const { lane } = params;

  return (
    <MiniAppTableRow>
      <MiniAppTableCell>
        <MiniAppTableText>{lane.label}</MiniAppTableText>
        <MiniAppTableText muted>
          <code>{lane.key}</code>
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>{getSyncLanePhaseLabel(lane.phase)}</MiniAppTableCell>
      <MiniAppTableCell>
        <ExplorerSyncLaneStatusBadge status={lane.status} />
      </MiniAppTableCell>
      <MiniAppTableCell>
        <ExplorerSyncLaneProgress lane={lane} />
      </MiniAppTableCell>
      <MiniAppTableCell title={lane.lastError ?? undefined}>
        <ExplorerSyncLaneLastAction lane={lane} />
      </MiniAppTableCell>
      <MiniAppTableCell>
        {getExplorerSyncLaneCountLabel({
          errorCount: lane.errorCount,
          requestCount: lane.requestCount,
          runCount: lane.runCount,
        })}
      </MiniAppTableCell>
    </MiniAppTableRow>
  );
}

export function ExplorerSyncLanesPanelView(params: {
  onBackToSelectionRoute: () => void;
  snapshot: DomainSyncSnapshot;
}) {
  const { onBackToSelectionRoute, snapshot } = params;

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--sync-lanes"
      scroll
      variant="framed"
    >
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>{EXPLORER_LABELS.syncLanesTitle}</strong>
          <span>
            {formatMiniAppDateTime(snapshot.updatedAt, { emptyFallback: "-" })}
          </span>
        </MiniAppHeaderCopy>
        <MiniAppActions>
          <MiniAppButton onClick={onBackToSelectionRoute}>
            {EXPLORER_LABELS.syncLanesBackAction}
          </MiniAppButton>
        </MiniAppActions>
      </MiniAppHeader>
      <ExplorerSyncLaneOverview snapshot={snapshot} />
      <MiniAppTableFrame className="explorer-sync-lane-table-wrap">
        <MiniAppTable columns={SYNC_LANE_COLUMNS}>
          {snapshot.lanes.length > 0 ? (
            snapshot.lanes.map((lane) => (
              <ExplorerSyncLaneRow key={lane.key} lane={lane} />
            ))
          ) : (
            <MiniAppTableEmptyRow colSpan={SYNC_LANE_COLUMNS.length}>
              {EXPLORER_LABELS.syncLanesNoLanes}
            </MiniAppTableEmptyRow>
          )}
        </MiniAppTable>
      </MiniAppTableFrame>
    </MiniAppPanel>
  );
}

export function ExplorerSyncLanesPanel(params: {
  domainScope: DomainScope;
  onBackToSelectionRoute: () => void;
}) {
  const snapshot = useDomainSyncSnapshot(params.domainScope);

  return (
    <ExplorerSyncLanesPanelView
      onBackToSelectionRoute={params.onBackToSelectionRoute}
      snapshot={snapshot}
    />
  );
}
