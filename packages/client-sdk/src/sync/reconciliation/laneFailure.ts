import type { ReconcileQueue } from "./queue";

interface FailedLaneState {
  active: boolean;
  lane: { requestSync: () => void } | null;
  queue: ReconcileQueue;
}

export function rearmFailedContainer(
  state: FailedLaneState,
  containerId: string,
  forced: boolean,
): void {
  if (!state.active) {
    return;
  }
  if (forced) {
    state.queue.enqueue(containerId, "idle");
  }
  if (state.queue.size > 0) {
    state.lane?.requestSync();
  }
}
