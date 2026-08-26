import type {
  DomainSyncCoordinatorState,
  SyncLaneState,
} from "./coordinatorState";
import {
  describeSyncLaneError,
  INITIAL_SYNC_LANE_RUN_STATE,
  noopLaneRun,
  publishSyncCoordinatorSnapshot,
} from "./coordinatorState";
import type { SyncLaneProgress } from "./syncTelemetry";
import { createSyncTimestamp } from "./syncTelemetry";

/**
 * Handle for an observational upload lane. Unlike pump-driven lanes, these are
 * never `requested` — the upload path that owns the handle drives the lane's
 * running/progress/terminal state directly. The coordinator pump ignores them
 * because `selectNextRequestedLane` only ever picks `requested` lanes.
 */
export interface UploadSyncLane {
  reportProgress: (progress: SyncLaneProgress) => void;
  complete: () => void;
  fail: (error: unknown) => void;
}

export interface UploadSyncLaneOptions {
  blobStorageKey?: string | undefined;
  label?: string | undefined;
}

// Completed/failed upload lanes are retained so a finished upload stays visible
// in the visualizer, but capped so a long-lived session can't grow `lanes`
// without bound (one upload lane is created per attachment slot upload).
const MAX_RETAINED_UPLOAD_LANES = 10;

function evictRetainedUploadLanes(
  coordinatorState: DomainSyncCoordinatorState,
) {
  const settledUploadLanes: SyncLaneState[] = [];
  for (const lane of coordinatorState.lanes.values()) {
    if (lane.config.phase === "blob" && !lane.running) {
      settledUploadLanes.push(lane);
    }
  }

  if (settledUploadLanes.length <= MAX_RETAINED_UPLOAD_LANES) {
    return;
  }

  settledUploadLanes.sort(
    (left, right) => left.registrationIndex - right.registrationIndex,
  );
  const removeCount = settledUploadLanes.length - MAX_RETAINED_UPLOAD_LANES;
  for (const lane of settledUploadLanes.slice(0, removeCount)) {
    coordinatorState.lanes.delete(lane.key);
  }
}

export function beginUploadLane(
  coordinatorState: DomainSyncCoordinatorState,
  key: string,
  options: UploadSyncLaneOptions,
): UploadSyncLane {
  const startedAt = createSyncTimestamp();
  let lane = coordinatorState.lanes.get(key);
  if (lane) {
    lane.config = { label: options.label, phase: "blob", run: noopLaneRun };
    lane.blobStorageKey = options.blobStorageKey ?? null;
  } else {
    lane = {
      ...INITIAL_SYNC_LANE_RUN_STATE,
      blobStorageKey: options.blobStorageKey ?? null,
      config: { label: options.label, phase: "blob", run: noopLaneRun },
      errorCount: 0,
      key,
      lastAction: "started",
      lastActionAt: startedAt,
      lastCompletedAt: null,
      lastError: null,
      lastFailedAt: null,
      lastRequestedAt: null,
      lastStartedAt: startedAt,
      notBeforeAtMs: null,
      progress: null,
      pumpDriven: false,
      registrationIndex: coordinatorState.nextRegistrationIndex,
      requestCount: 0,
      requested: false,
    };
    coordinatorState.nextRegistrationIndex += 1;
    coordinatorState.lanes.set(key, lane);
  }

  const uploadLane = lane;
  // A stale executable handle may share this key. Make the upload row
  // observational before publishing and discard any queued pump request.
  uploadLane.pumpDriven = false;
  uploadLane.requested = false;
  uploadLane.running = true;
  uploadLane.runCount += 1;
  uploadLane.lastAction = "started";
  uploadLane.lastActionAt = startedAt;
  uploadLane.lastStartedAt = startedAt;
  uploadLane.lastError = null;
  uploadLane.progress = null;
  evictRetainedUploadLanes(coordinatorState);
  publishSyncCoordinatorSnapshot(coordinatorState);

  // If this lane key is re-begun (or evicted and recreated), runCount advances
  // and a stale handle from the prior session becomes a no-op, so out-of-order
  // callbacks can't clobber the newer upload's state.
  const sessionRunCount = uploadLane.runCount;
  const isCurrentSession = () => uploadLane.runCount === sessionRunCount;

  return {
    complete() {
      if (!isCurrentSession()) {
        return;
      }
      uploadLane.running = false;
      uploadLane.lastAction = "completed";
      uploadLane.lastActionAt = createSyncTimestamp();
      uploadLane.lastCompletedAt = uploadLane.lastActionAt;
      uploadLane.lastError = null;
      if (uploadLane.progress) {
        uploadLane.progress = {
          ...uploadLane.progress,
          bytesUploaded: uploadLane.progress.bytesTotal,
          partsCompleted: uploadLane.progress.partsTotal,
        };
      }
      evictRetainedUploadLanes(coordinatorState);
      publishSyncCoordinatorSnapshot(coordinatorState);
    },
    fail(error: unknown) {
      if (!isCurrentSession()) {
        return;
      }
      uploadLane.running = false;
      uploadLane.errorCount += 1;
      uploadLane.lastAction = "failed";
      uploadLane.lastActionAt = createSyncTimestamp();
      uploadLane.lastError = describeSyncLaneError(error);
      uploadLane.lastFailedAt = uploadLane.lastActionAt;
      evictRetainedUploadLanes(coordinatorState);
      publishSyncCoordinatorSnapshot(coordinatorState);
    },
    reportProgress(progress: SyncLaneProgress) {
      if (!isCurrentSession()) {
        return;
      }
      uploadLane.progress = { ...progress };
      uploadLane.lastActionAt = createSyncTimestamp();
      publishSyncCoordinatorSnapshot(coordinatorState);
    },
  };
}
