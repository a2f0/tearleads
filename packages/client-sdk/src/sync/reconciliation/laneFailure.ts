import type { ReconcileQueue } from "./queue";

interface FailedLaneState {
  active: boolean;
  automaticRetryGenerations: Map<string, number>;
  forcedContainerGenerations: Map<string, number>;
  lane: {
    requestSync: () => void;
    requestSyncAfter: (delayMs: number) => void;
  } | null;
  lifecycleGeneration: number;
  queue: ReconcileQueue;
}

export interface FailedForcedContainer {
  busy?: boolean | undefined;
  containerId: string;
  forceGeneration?: number | undefined;
}

export const SWEEP_RETRY_BACKOFF_MS = 1_000;

export function rearmFailedContainer(
  state: FailedLaneState,
  containerId: string,
  forceGeneration: number | undefined,
  lifecycleGeneration: number,
  busy = false,
): void {
  if (!state.active || state.lifecycleGeneration !== lifecycleGeneration) {
    return;
  }
  if (busy) {
    // A busy SQLite refusal is transient cross-tab contention: re-queue the
    // container without spending its once-per-force automatic retry budget.
    state.queue.enqueue(containerId, "idle");
    state.lane?.requestSyncAfter(SWEEP_RETRY_BACKOFF_MS);
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
  for (const failure of failures) {
    if (!state.active || state.lifecycleGeneration !== lifecycleGeneration) {
      continue;
    }
    if (failure.busy) {
      state.queue.enqueue(failure.containerId, "idle");
      continue;
    }
    if (
      failure.forceGeneration !== undefined &&
      state.forcedContainerGenerations.get(failure.containerId) ===
        failure.forceGeneration &&
      state.automaticRetryGenerations.get(failure.containerId) !==
        failure.forceGeneration
    ) {
      state.automaticRetryGenerations.set(
        failure.containerId,
        failure.forceGeneration,
      );
      state.queue.enqueue(failure.containerId, "idle");
    }
  }
  if (state.queue.size > 0) {
    state.lane?.requestSyncAfter(SWEEP_RETRY_BACKOFF_MS);
  }
}
