import { readUserTimingClock } from "../shared/userTiming";
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
import {
  transitionSyncLaneRequest,
  transitionSyncLaneRun,
} from "./syncLaneMachine";
import type { SyncLaneProgress } from "./syncTelemetry";
import { addSyncLaneRunDuration, createSyncTimestamp } from "./syncTelemetry";

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
    if (lane.config.phase === "blob" && lane.run.status !== "running") {
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

// Returns the session's run-ending step. Upload rows are timed like pump runs,
// once per session, but stay off the User Timing tracks: the owning document
// lane's run already spans them.
function startUploadLaneRun(lane: SyncLaneState, token: object): () => void {
  const startedAtMs = readUserTimingClock();
  let timed = false;
  return () => {
    lane.run = transitionSyncLaneRun(lane.run, { type: "settle", token });
    if (timed) {
      return;
    }
    timed = true;
    lane.runDurations = addSyncLaneRunDuration(
      lane.runDurations,
      readUserTimingClock() - startedAtMs,
    );
  };
}

function createUploadLaneState(
  coordinatorState: DomainSyncCoordinatorState,
  key: string,
  options: UploadSyncLaneOptions,
  startedAt: string,
): SyncLaneState {
  const lane: SyncLaneState = {
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
    progress: null,
    pumpDriven: false,
    registrationIndex: coordinatorState.nextRegistrationIndex,
    requestCount: 0,
  };
  coordinatorState.nextRegistrationIndex += 1;
  coordinatorState.lanes.set(key, lane);
  return lane;
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
    lane = createUploadLaneState(coordinatorState, key, options, startedAt);
  }

  const uploadLane = lane;
  // A stale executable handle may share this key. Make the upload row
  // observational before publishing and discard any queued pump request.
  const runToken = {};
  uploadLane.pumpDriven = false;
  uploadLane.request = transitionSyncLaneRequest(uploadLane.request, {
    type: "clear",
  });
  uploadLane.run = transitionSyncLaneRun(uploadLane.run, {
    type: "start",
    token: runToken,
  });
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
  const endRun = startUploadLaneRun(uploadLane, runToken);

  return {
    complete() {
      if (!isCurrentSession()) {
        return;
      }
      endRun();
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
      endRun();
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
