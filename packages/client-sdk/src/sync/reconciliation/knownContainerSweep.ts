import {
  acknowledgeContainerForce,
  type IdleBackfillState,
} from "./idleBackfill";
import {
  type FailedForcedContainer,
  rearmFailedSweepContainers,
} from "./laneFailure";
import { reconcileOneContainer } from "./reconcileContainer";
import type { ReconciliationHost } from "./serviceTypes";

interface KnownContainerSweepState extends IdleBackfillState {
  active: boolean;
  lane: {
    requestSync: () => void;
    requestSyncAfter: (delayMs: number) => void;
  } | null;
  lifecycleGeneration: number;
}

export function isCurrentReconciliationLifecycle(
  state: KnownContainerSweepState,
  generation: number,
): boolean {
  return (
    state.lifecycleGeneration === generation &&
    (state.active || generation === 0)
  );
}

// Reconcile a container whose discovered mark is already set, rolling the mark
// back when the container is skipped or fails so a transient error (or a
// container that later becomes eligible) can be retried.
export async function reconcileMarkedContainer(
  host: ReconciliationHost,
  state: KnownContainerSweepState,
  containerId: string,
  forceDocumentContentPull: boolean,
): Promise<boolean> {
  try {
    const reconciled = await reconcileOneContainer(host, containerId, {
      forceDocumentContentPull,
    });
    if (!reconciled) {
      state.discoveredContainerIds.delete(containerId);
    }
    return reconciled;
  } catch (error) {
    state.discoveredContainerIds.delete(containerId);
    throw error;
  }
}

type SweepContainerResult =
  | { status: "failed"; error: unknown; forceGeneration: number | undefined }
  | { status: "stale" }
  | { status: "succeeded" };

async function sweepContainer(input: {
  containerId: string;
  forceAllDocumentContentPulls: boolean;
  host: ReconciliationHost;
  lifecycleGeneration: number;
  state: KnownContainerSweepState;
}): Promise<SweepContainerResult> {
  const { containerId, host, lifecycleGeneration, state } = input;
  if (!isCurrentReconciliationLifecycle(state, lifecycleGeneration)) {
    return { status: "stale" };
  }
  const forceGeneration = state.forcedContainerGenerations.get(containerId);
  try {
    const reconciled = await reconcileMarkedContainer(
      host,
      state,
      containerId,
      input.forceAllDocumentContentPulls || forceGeneration !== undefined,
    );
    if (!isCurrentReconciliationLifecycle(state, lifecycleGeneration)) {
      return { status: "stale" };
    }
    if (reconciled) {
      acknowledgeContainerForce(state, containerId, forceGeneration);
    }
    return { status: "succeeded" };
  } catch (error) {
    if (!isCurrentReconciliationLifecycle(state, lifecycleGeneration)) {
      return { status: "stale" };
    }
    return { error, forceGeneration, status: "failed" };
  }
}

export async function sweepKnownContainers(input: {
  forceAllDocumentContentPulls: boolean;
  host: ReconciliationHost;
  knownIds: ReadonlyArray<string>;
  lifecycleGeneration: number;
  state: KnownContainerSweepState;
}): Promise<void> {
  const {
    forceAllDocumentContentPulls,
    host,
    knownIds,
    lifecycleGeneration,
    state,
  } = input;
  if (!isCurrentReconciliationLifecycle(state, lifecycleGeneration)) {
    return;
  }
  const containerIds = forceAllDocumentContentPulls
    ? knownIds
    : knownIds.filter(
        (containerId) =>
          state.forcedContainerGenerations.has(containerId) ||
          !state.discoveredContainerIds.has(containerId),
      );
  // Mark only the containers this sweep will fetch. Automatic root hints are
  // discovery signals, so already-reconciled containers stay settled unless a
  // targeted event forced them; explicit full refreshes still fetch every id.
  for (const containerId of containerIds) {
    state.discoveredContainerIds.add(containerId);
  }
  // Reconcile every container independently: one failing container must not
  // block refreshing the rest. Surface the first real error after the sweep.
  let firstError: unknown;
  const failedForces: FailedForcedContainer[] = [];
  for (const containerId of containerIds) {
    const result = await sweepContainer({
      containerId,
      forceAllDocumentContentPulls,
      host,
      lifecycleGeneration,
      state,
    });
    if (result.status === "stale") {
      return;
    }
    if (result.status === "failed") {
      if (result.forceGeneration !== undefined) {
        failedForces.push({
          containerId,
          forceGeneration: result.forceGeneration,
        });
      }
      if (!host.isIgnorableError(result.error) && firstError === undefined) {
        firstError = result.error;
      }
    }
  }
  rearmFailedSweepContainers(state, failedForces, lifecycleGeneration);
  if (firstError !== undefined) {
    throw firstError;
  }
}
