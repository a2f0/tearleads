import type {
  DomainSyncSnapshot,
  SyncLaneLastAction,
  SyncLanePhase,
  SyncLaneSnapshot,
  SyncLaneStatus,
} from "@symcrypt/client-sdk";
import { EXPLORER_LABELS } from "../../labels";

interface SyncLaneSummary {
  complete: number;
  errors: number;
  idle: number;
  queued: number;
  registered: number;
  running: number;
}

/**
 * Which lanes the Sync Lanes list shows, driven by the overview metrics above
 * it. `null` is the "Registered" tile: its count is every registered lane, so
 * selecting it is the natural "show everything" reset.
 */
export type SyncLaneFilter = SyncLaneStatus | null;

const SYNC_LANE_PROGRESS_BY_STATUS: Record<SyncLaneStatus, number> = {
  complete: 100,
  error: 100,
  idle: 0,
  queued: 25,
  running: 65,
};

export function getExplorerSyncLaneProgress(status: SyncLaneStatus): number {
  return SYNC_LANE_PROGRESS_BY_STATUS[status];
}

export function getExplorerSyncLaneStatusLabel(status: SyncLaneStatus): string {
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

export function getSyncLanePhaseLabel(phase: SyncLanePhase): string {
  switch (phase) {
    case "structural":
      return EXPLORER_LABELS.syncLanesStructuralPhase;
    case "blob":
      return EXPLORER_LABELS.syncLanesBlobPhase;
    case "document":
      return EXPLORER_LABELS.syncLanesDocumentPhase;
  }
}

export function getSyncLaneLastActionLabel(action: SyncLaneLastAction): string {
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

export function getExplorerSyncLaneProgressPercent(
  lane: SyncLaneSnapshot,
): number {
  if (lane.progress && lane.progress.bytesTotal > 0) {
    const ratio = lane.progress.bytesUploaded / lane.progress.bytesTotal;
    return Math.max(0, Math.min(100, Math.round(ratio * 100)));
  }

  return getExplorerSyncLaneProgress(lane.status);
}

export function summarizeSyncLanes(
  snapshot: DomainSyncSnapshot,
): SyncLaneSummary {
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

export function getSyncLaneSummaryCount(
  summary: SyncLaneSummary,
  filter: SyncLaneFilter,
): number {
  switch (filter) {
    case null:
      return summary.registered;
    case "complete":
      return summary.complete;
    case "error":
      return summary.errors;
    case "idle":
      return summary.idle;
    case "queued":
      return summary.queued;
    case "running":
      return summary.running;
  }
}

export function filterSyncLanes(
  lanes: ReadonlyArray<SyncLaneSnapshot>,
  filter: SyncLaneFilter,
): ReadonlyArray<SyncLaneSnapshot> {
  return filter === null
    ? lanes
    : lanes.filter((lane) => lane.status === filter);
}

export function formatExplorerSyncLaneBoolean(value: boolean): string {
  return value
    ? EXPLORER_LABELS.syncLanesBooleanYes
    : EXPLORER_LABELS.syncLanesBooleanNo;
}

// Lane keys carry an opaque per-lane suffix (`documents:<localId>`,
// `blob-upload:<slotId>`) that is far too long for the list column and, with
// `overflow-wrap: anywhere`, collapses to one-character-per-line vertical text.
// The list only needs to identify a lane by category — the full label and key
// stay in the lane-detail view (and this cell's tooltip) — so roll the key's
// prefix up to a short, stable name and drop the suffix entirely.
export function getSyncLaneCompactLabel(lane: SyncLaneSnapshot): string {
  const prefix = lane.key.split(":", 1)[0];
  switch (prefix) {
    case "documents":
      return EXPLORER_LABELS.syncLanesCompactDocument;
    case "blob-upload":
      return EXPLORER_LABELS.syncLanesCompactBlobUpload;
    case "reconciliation":
      return EXPLORER_LABELS.syncLanesCompactReconciliation;
    case "container-contents":
      return EXPLORER_LABELS.syncLanesCompactContainerContents;
    default:
      // An unrecognized lane keeps its human label; the cell clamps it with an
      // ellipsis so a stray long key still cannot widen the column.
      return lane.label;
  }
}
