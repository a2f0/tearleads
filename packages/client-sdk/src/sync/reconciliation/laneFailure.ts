import type { ReconcileQueue } from "./queue";

interface FailedLaneState {
  active: boolean;
  automaticRetryGenerations: Map<string, number>;
  forcedContainerGenerations: Map<string, number>;
  lane: { requestSync: () => void } | null;
  lifecycleGeneration: number;
  queue: ReconcileQueue;
}

export function rearmFailedContainer(
  state: FailedLaneState,
  containerId: string,
  forceGeneration: number | undefined,
  lifecycleGeneration: number,
): void {
  if (!state.active || state.lifecycleGeneration !== lifecycleGeneration) {
    return;
  }
  const shouldRetryForce =
    forceGeneration !== undefined &&
    state.forcedContainerGenerations.get(containerId) === forceGeneration &&
    state.automaticRetryGenerations.get(containerId) !== forceGeneration;
  if (shouldRetryForce) {
    state.automaticRetryGenerations.set(containerId, forceGeneration);
    state.queue.enqueue(containerId, "idle");
  }
  if (state.queue.size > 0) {
    state.lane?.requestSync();
  }
}
