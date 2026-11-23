import type {
  DomainSyncSnapshot,
  PendingDownloadQueueItem,
  SyncLaneSnapshot,
} from "@tearleads/client-sdk";
import type { QueueReadState } from "../../stores/sync-queues/queueReadMachine";

/** The sync coordinator's lanes, reduced to what the tray reports. */
export interface SyncLaneSummary {
  /** Lanes with a run in flight. */
  readonly running: number;
  /** Lanes whose last run failed, or whose run the watchdog abandoned. */
  readonly failed: number;
  /** The first failed lane's recorded error. */
  readonly firstError: string | null;
}

const NO_SYNC_LANES: SyncLaneSummary = {
  failed: 0,
  firstError: null,
  running: 0,
};

// The watchdog records a developer-facing reason ("Sync lane watchdog: run
// exceeded …"), so an abandoned run is named in plain words instead.
const ABANDONED_RUN_ERROR = "Stopped responding";

/**
 * Which failure a lane records, by key, so a later snapshot can tell the same
 * failure from a new one: an abandoned run by when it started, a failed run
 * by when it failed. A lane with no failure has no entry.
 */
export type LaneFailureMarks = ReadonlyMap<string, string>;

const NO_FAILURE_MARKS: LaneFailureMarks = new Map();

// A lane's failure as the tray names it, or undefined when it is healthy. The
// SDK reports a lane as running or queued ahead of its failure, so a lane that
// keeps failing and retrying would mostly look healthy by `status`. Its
// `lastError` is set when a run fails and cleared only when one completes, so
// it says whether the last finished run failed, whatever is queued after it.
function laneFailure(lane: SyncLaneSnapshot): string | null | undefined {
  // An upload lane (the only `blob` phase) records an upload the write queue
  // already tracks; the SDK keeps a failed one as history that no sync request
  // re-runs, so the queue's failed writes report it instead.
  if (lane.phase === "blob") return undefined;
  if (lane.runAbandoned) return ABANDONED_RUN_ERROR;
  if (lane.lastError !== null) return lane.lastError;
  return lane.status === "error" ? null : undefined;
}

function laneFailureMark(lane: SyncLaneSnapshot): string {
  return lane.runAbandoned
    ? `abandoned:${lane.lastStartedAt ?? ""}`
    : `failed:${lane.lastFailedAt ?? ""}`;
}

/** The failure each lane records now (see `LaneFailureMarks`). */
export function markLaneFailures(
  snapshot: DomainSyncSnapshot,
): LaneFailureMarks {
  const marks = new Map<string, string>();
  for (const lane of snapshot.lanes) {
    if (laneFailure(lane) !== undefined)
      marks.set(lane.key, laneFailureMark(lane));
  }
  return marks;
}

/**
 * Counts the lanes running and failing. A failure listed in `staleFailures`
 * is left out: it was recorded before the device came back online, and the
 * lane's next run either clears it or records a new one.
 */
export function summarizeSyncLanes(
  snapshot: DomainSyncSnapshot,
  staleFailures: LaneFailureMarks = NO_FAILURE_MARKS,
): SyncLaneSummary {
  let running = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (const lane of snapshot.lanes) {
    if (lane.running) running += 1;
    const laneError = laneFailure(lane);
    if (laneError === undefined) continue;
    if (staleFailures.get(lane.key) === laneFailureMark(lane)) continue;
    failed += 1;
    firstError ??= laneError;
  }
  return { failed, firstError, running };
}

/** What the lanes and pauses add to the tray's status on this device. */
export interface SyncHolds {
  /**
   * The lanes as the tray reports them, in the status and the popover alike:
   * none while offline.
   */
  readonly lanes: SyncLaneSummary;
  /** Sync work is running now; `useHeldSyncActivity` holds it for display. */
  readonly laneActive: boolean;
  /** Organizations whose sync is paused, whether or not anything is queued. */
  readonly pausedOrganizationCount: number;
  /** Some queued write belongs to a paused organization, so it waits. */
  readonly writesPaused: boolean;
}

export function selectSyncHolds(input: {
  readonly dbReady: boolean;
  readonly lanes: SyncLaneSummary;
  readonly online: boolean;
  readonly pausedOrganizationIds: ReadonlySet<string>;
  /** The organizations the queued writes belong to. */
  readonly writeOrganizationIds: ReadonlyArray<string>;
}): SyncHolds {
  const pausedOrganizationCount = input.pausedOrganizationIds.size;
  const writesPaused = input.writeOrganizationIds.some((organizationId) =>
    input.pausedOrganizationIds.has(organizationId),
  );
  // Offline, sync tasks fail or wait as a matter of course; the offline note
  // explains them.
  if (!input.online)
    return {
      lanes: NO_SYNC_LANES,
      laneActive: false,
      pausedOrganizationCount,
      writesPaused,
    };
  return {
    lanes: input.lanes,
    laneActive: input.dbReady && input.lanes.running > 0,
    pausedOrganizationCount,
    writesPaused,
  };
}

/** The download queue as the tray's popover reports it. */
export type DownloadQueueSummary =
  | { readonly status: "loading" }
  | { readonly message: string; readonly status: "unreadable" }
  | {
      readonly failed: number;
      readonly firstError: string | null;
      readonly pending: number;
      readonly status: "read";
    };

export function summarizeDownloadQueue(
  state: QueueReadState<PendingDownloadQueueItem>,
): DownloadQueueSummary {
  switch (state.status) {
    case "loading":
      return { status: "loading" };
    case "failed":
      return { message: state.message, status: "unreadable" };
    case "ready": {
      const failedItems = state.items.filter((item) => item.lastError !== null);
      return {
        failed: failedItems.length,
        firstError: failedItems[0]?.lastError ?? null,
        pending: state.items.length,
        status: "read",
      };
    }
  }
}
