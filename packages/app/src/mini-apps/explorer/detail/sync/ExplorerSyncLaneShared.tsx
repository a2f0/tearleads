import type {
  DomainSyncSnapshot,
  SyncLaneSnapshot,
  SyncLaneStatus,
} from "@tearleads/client-sdk";
import { useMemo } from "react";
import { classNames } from "../../../../components/shared/classNames";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import {
  EXPLORER_LABELS,
  getExplorerSyncLaneUploadProgressLabel,
} from "../../labels";
import {
  getExplorerSyncLaneProgressPercent,
  getExplorerSyncLaneStatusLabel,
  getSyncLaneLastActionLabel,
  summarizeSyncLanes,
} from "./ExplorerSyncLaneUtils";

function ExplorerSyncLaneMetric(params: { label: string; value: number }) {
  return (
    <div className="explorer-sync-lane-metric">
      <strong>{params.value.toLocaleString()}</strong>
      <span>{params.label}</span>
    </div>
  );
}

export function ExplorerSyncLaneOverview(params: {
  snapshot: DomainSyncSnapshot;
}) {
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

export function ExplorerSyncLaneStatusBadge(params: {
  status: SyncLaneStatus;
}) {
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

export function ExplorerSyncLaneProgress(params: { lane: SyncLaneSnapshot }) {
  const { lane } = params;
  const label = getExplorerSyncLaneStatusLabel(lane.status);
  const percent = getExplorerSyncLaneProgressPercent(lane);

  return (
    <span className="explorer-sync-lane-progress-stack">
      <span
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
      </span>
      {lane.progress ? (
        <span className="explorer-sync-lane-muted">
          {getExplorerSyncLaneUploadProgressLabel(lane.progress)}
        </span>
      ) : null}
    </span>
  );
}

export function ExplorerSyncLaneLastAction(params: { lane: SyncLaneSnapshot }) {
  const actionLabel = getSyncLaneLastActionLabel(params.lane.lastAction);

  return (
    <span className="explorer-sync-lane-last-action">
      <span>{actionLabel}</span>
      <span className="explorer-sync-lane-muted">
        {formatMiniAppDateTime(params.lane.lastActionAt, {
          emptyFallback: "-",
        })}
      </span>
    </span>
  );
}
