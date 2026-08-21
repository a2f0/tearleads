import type { ReconcileQueue } from "./queue";

interface FailedLaneState {
  active: boolean;
  automaticRetryGenerations: Map<string, number>;
  forcedContainerGenerations: Map<string, number>;
  lane: { requestSync: () => void } | null;
  lifecycleGeneration: number;
  queue: ReconcileQueue;
  retryNotBeforeByContainerId: Map<string, number>;
}

export interface FailedForcedContainer {
  containerId: string;
  forceGeneration: number;
}

const SWEEP_RETRY_BACKOFF_MS = 1_000;

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

export function rearmFailedSweepContainers(
  state: FailedLaneState,
  failures: ReadonlyArray<FailedForcedContainer>,
  lifecycleGeneration: number,
): void {
  if (failures.length === 0) {
    return;
  }
  const retryNotBefore = Date.now() + SWEEP_RETRY_BACKOFF_MS;
  for (const failure of failures) {
    state.retryNotBeforeByContainerId.set(failure.containerId, retryNotBefore);
    rearmFailedContainer(
      state,
      failure.containerId,
      failure.forceGeneration,
      lifecycleGeneration,
    );
  }
}

export async function waitForContainerRetryBackoff(
  state: FailedLaneState,
  containerId: string,
  lifecycleGeneration: number,
): Promise<boolean> {
  const retryNotBefore = state.retryNotBeforeByContainerId.get(containerId);
  if (retryNotBefore !== undefined) {
    const remainingMs = Math.max(0, retryNotBefore - Date.now());
    await new Promise((resolve) => setTimeout(resolve, remainingMs));
    if (state.retryNotBeforeByContainerId.get(containerId) === retryNotBefore) {
      state.retryNotBeforeByContainerId.delete(containerId);
    }
  }
  return state.active && state.lifecycleGeneration === lifecycleGeneration;
}
