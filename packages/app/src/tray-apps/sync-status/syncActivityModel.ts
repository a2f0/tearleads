import type {
  DomainSyncSnapshot,
  PendingDownloadQueueItem,
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

export function summarizeSyncLanes(
  snapshot: DomainSyncSnapshot,
): SyncLaneSummary {
  let running = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (const lane of snapshot.lanes) {
    if (lane.running) running += 1;
    const laneError =
      lane.status === "error"
        ? (lane.lastError ?? null)
        : lane.runAbandoned
          ? ABANDONED_RUN_ERROR
          : undefined;
    if (laneError === undefined) continue;
    failed += 1;
    firstError ??= laneError;
  }
  return { failed, firstError, running };
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
