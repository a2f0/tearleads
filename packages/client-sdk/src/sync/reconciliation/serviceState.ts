import type { SyncLane } from "../../data/sync/syncLaneConfig";
import type { IdleBackfillState } from "./idleBackfill";
import type { ReconciliationRuntimeStatus } from "./serviceTypes";
import type { SharedRefresh } from "./sharedRefresh";

/** Whether the runtime can reach the server on behalf of a signed-in user. */
export function canReconcile(status: ReconciliationRuntimeStatus): boolean {
  return status.dbStatus === "ready" && status.isAuthenticated && status.online;
}

/** One reconciliation service's queue, forces, lane and refresh in flight. */
export interface ReconciliationState extends IdleBackfillState {
  active: boolean;
  lane: SyncLane | null;
  lifecycleGeneration: number;
  probeContinuationCancel: (() => void) | null;
  pendingRefresh: SharedRefresh | null;
}
