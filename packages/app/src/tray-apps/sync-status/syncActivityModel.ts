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

const ABANDONED_RUN_ERROR = "Stopped responding";

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
  if (lane.lastError !== null) return lane.lastError;
  if (lane.runAbandoned) return ABANDONED_RUN_ERROR;
  return lane.status === "error" ? null : undefined;
}

export function summarizeSyncLanes(
  snapshot: DomainSyncSnapshot,
): SyncLaneSummary {
  let running = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (const lane of snapshot.lanes) {
    if (lane.running) running += 1;
    const laneError = laneFailure(lane);
    if (laneError === undefined) continue;
    failed += 1;
    firstError ??= laneError;
  }
  return { failed, firstError, running };
}

/** What the lanes and pauses add to the tray's status on this device. */
export interface SyncHolds {
  readonly failedLaneCount: number;
  readonly firstLaneError: string | null;
  /** Sync work is running now; `useHeldSyncActivity` holds it for display. */
  readonly laneActive: boolean;
  /** Some organization's sync is paused, whether or not anything is queued. */
  readonly syncPaused: boolean;
}

export function selectSyncHolds(input: {
  readonly dbReady: boolean;
  readonly lanes: SyncLaneSummary;
  readonly online: boolean;
  readonly pausedOrganizationIds: ReadonlySet<string>;
}): SyncHolds {
  const syncPaused = input.pausedOrganizationIds.size > 0;
  // Offline, sync tasks fail or wait as a matter of course; the offline note
  // explains them.
  if (!input.online)
    return {
      failedLaneCount: 0,
      firstLaneError: null,
      laneActive: false,
      syncPaused,
    };
  return {
    failedLaneCount: input.lanes.failed,
    firstLaneError: input.lanes.firstError,
    laneActive: input.dbReady && input.lanes.running > 0,
    syncPaused,
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
