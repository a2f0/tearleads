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
  getSyncLaneSummaryCount,
  type SyncLaneFilter,
  summarizeSyncLanes,
} from "./ExplorerSyncLaneUtils";
import "./ExplorerSyncLaneShared.css";

// Ordered along the lane lifecycle, with the unfiltered total leading. Each
// tile doubles as the filter for the lanes it counts; the leading `null` tile
// counts every registered lane, so it is also the "show all" reset.
const SYNC_LANE_METRICS: ReadonlyArray<{
  filter: SyncLaneFilter;
  label: string;
}> = [
  { filter: null, label: EXPLORER_LABELS.syncLanesRegisteredMetric },
  { filter: "running", label: EXPLORER_LABELS.syncLanesRunningMetric },
  { filter: "queued", label: EXPLORER_LABELS.syncLanesQueuedMetric },
  { filter: "complete", label: EXPLORER_LABELS.syncLanesCompleteMetric },
  { filter: "error", label: EXPLORER_LABELS.syncLanesErrorMetric },
  { filter: "idle", label: EXPLORER_LABELS.syncLanesIdleMetric },
];

function ExplorerSyncLaneMetric(params: {
  active: boolean;
  label: string;
  onSelect: () => void;
  value: number;
}) {
  return (
    <button
      aria-pressed={params.active}
      className="explorer-sync-lane-metric"
      onClick={params.onSelect}
      type="button"
    >
      <strong>{params.value.toLocaleString()}</strong>
      <span>{params.label}</span>
    </button>
  );
}

export function ExplorerSyncLaneOverview(params: {
  activeFilter: SyncLaneFilter;
  onSelectFilter: (filter: SyncLaneFilter) => void;
  snapshot: DomainSyncSnapshot;
}) {
  const { activeFilter, onSelectFilter, snapshot } = params;
  const summary = useMemo(() => summarizeSyncLanes(snapshot), [snapshot]);

  return (
    <div className="explorer-sync-lane-overview">
      {SYNC_LANE_METRICS.map((metric) => (
        <ExplorerSyncLaneMetric
          active={activeFilter === metric.filter}
          key={metric.label}
          label={metric.label}
          // Re-selecting the active tile clears the filter, so a status is
          // never a one-way trip even when it counts zero lanes; the Registered
          // tile resolves to "show all" either way.
          onSelect={() =>
            onSelectFilter(
              activeFilter === metric.filter ? null : metric.filter,
            )
          }
          value={getSyncLaneSummaryCount(summary, metric.filter)}
        />
      ))}
    </div>
  );
}

/**
 * A status in the Sync Lanes tone for `status`. Downloads and Uploads pass
 * their own wording as `label`; the tone, and so the emphasis, stays shared.
 */
export function ExplorerSyncLaneStatusBadge(params: {
  label?: string | undefined;
  status: SyncLaneStatus;
}) {
  const label = params.label ?? getExplorerSyncLaneStatusLabel(params.status);

  return (
    <span
      className={classNames(
        "explorer-sync-lane-status",
        `explorer-sync-lane-status--${params.status}`,
      )}
      // A long transfer status may be clipped by its column.
      title={params.label}
    >
      {label}
    </span>
  );
}

/** A horizontal bar filling to `percent` in the tone for `status`. */
export function ExplorerSyncProgressBar(params: {
  label: string;
  percent: number;
  status: SyncLaneStatus;
}) {
  return (
    <span
      aria-label={params.label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={params.percent}
      className={classNames(
        "explorer-sync-lane-progress",
        `explorer-sync-lane-progress--${params.status}`,
      )}
      role="progressbar"
    >
      <span style={{ width: `${params.percent}%` }} />
    </span>
  );
}

export function ExplorerSyncLaneProgress(params: { lane: SyncLaneSnapshot }) {
  const { lane } = params;

  return (
    <span className="explorer-sync-lane-progress-stack">
      <ExplorerSyncProgressBar
        label={getExplorerSyncLaneStatusLabel(lane.status)}
        percent={getExplorerSyncLaneProgressPercent(lane)}
        status={lane.status}
      />
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
