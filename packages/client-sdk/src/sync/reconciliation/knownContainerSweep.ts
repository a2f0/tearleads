import { MAX_CONTAINER_DOCUMENT_LANES } from "@tearleads/validators/request";
import {
  acknowledgeContainerForce,
  type IdleBackfillState,
} from "./idleBackfill";
import {
  type FailedForcedContainer,
  rearmFailedSweepContainers,
} from "./laneFailure";
import {
  type ContainerReconcileResult,
  reconcileContainers,
} from "./reconcileContainer";
import type { ReconciliationHost } from "./serviceTypes";

interface KnownContainerSweepState extends IdleBackfillState {
  active: boolean;
  lane: {
    requestSync: () => void;
    requestSyncAfter: (delayMs: number) => void;
  } | null;
  lifecycleGeneration: number;
}

const pendingRetries = new WeakMap<
  KnownContainerSweepState,
  Map<string, { due: number; timer: ReturnType<typeof setTimeout> }>
>();

export function clearPendingDiscoveryRetries(
  state: KnownContainerSweepState,
): void {
  for (const { timer } of pendingRetries.get(state)?.values() ?? [])
    clearTimeout(timer);
  pendingRetries.delete(state);
}

function schedulePendingDiscovery(
  state: KnownContainerSweepState,
  containerId: string,
  delayMs: number,
): void {
  if (!state.active) return;
  const retries = pendingRetries.get(state) ?? new Map();
  pendingRetries.set(state, retries);
  const due = Date.now() + delayMs;
  const existing = retries.get(containerId);
  if (existing && existing.due <= due) return;
  if (existing) clearTimeout(existing.timer);
  const generation = state.lifecycleGeneration;
  const timer = setTimeout(
    () => {
      retries.delete(containerId);
      if (!state.active || state.lifecycleGeneration !== generation) return;
      state.discoveredContainerIds.delete(containerId);
      state.queue.enqueue(
        containerId,
        state.activeContainerId === containerId ? "active" : "idle",
      );
      state.lane?.requestSync();
    },
    Math.max(1, delayMs),
  );
  retries.set(containerId, { due, timer });
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

// Reconcile containers whose discovered marks are already set, rolling a mark
// back when its container is skipped or fails so a transient error (or a
// container that later becomes eligible) can be retried.
export async function reconcileMarkedContainers(
  host: ReconciliationHost,
  state: KnownContainerSweepState,
  containers: ReadonlyArray<{
    readonly containerId: string;
    readonly forceDocumentContentPull: boolean;
  }>,
  fullRevalidation = false,
): Promise<ReadonlyArray<ContainerReconcileResult>> {
  const results = await reconcileContainers(
    host,
    containers.map(({ containerId, forceDocumentContentPull }) => ({
      containerId,
      documentIds: fullRevalidation
        ? undefined
        : state.forcedDocumentIds.get(containerId),
      forceDocumentContentPull,
      onFullListing: state.initialDocumentProbe.captureListing(containerId),
      onPendingDiscovery: (delayMs: number) =>
        schedulePendingDiscovery(state, containerId, delayMs),
    })),
  );
  for (const result of results) {
    if (result.status !== "reconciled") {
      state.discoveredContainerIds.delete(result.containerId);
    }
  }
  return results;
}

/**
 * Reconciles one batch of a sweep. Force generations are read before the
 * batched listing starts, so a hint arriving while the batch is in flight
 * keeps its newer generation and runs again.
 */
async function sweepContainerBatch(input: {
  containerIds: ReadonlyArray<string>;
  forceAllDocumentContentPulls: boolean;
  host: ReconciliationHost;
  lifecycleGeneration: number;
  state: KnownContainerSweepState;
}): Promise<{
  readonly failedForces: ReadonlyArray<FailedForcedContainer>;
  readonly firstError: unknown;
} | null> {
  const { containerIds, forceAllDocumentContentPulls, host, state } = input;
  const forceGenerations = new Map(
    containerIds.map((containerId) => [
      containerId,
      state.forcedContainerGenerations.get(containerId),
    ]),
  );
  const results = await reconcileMarkedContainers(
    host,
    state,
    containerIds.map((containerId) => ({
      containerId,
      forceDocumentContentPull:
        forceAllDocumentContentPulls ||
        forceGenerations.get(containerId) !== undefined,
    })),
    forceAllDocumentContentPulls,
  );
  if (!isCurrentReconciliationLifecycle(state, input.lifecycleGeneration)) {
    return null;
  }
  const failedForces: FailedForcedContainer[] = [];
  let firstError: unknown;
  for (const result of results) {
    const forceGeneration = forceGenerations.get(result.containerId);
    if (result.status === "reconciled") {
      acknowledgeContainerForce(state, result.containerId, forceGeneration);
    } else if (result.status === "failed") {
      if (forceGeneration !== undefined) {
        failedForces.push({ containerId: result.containerId, forceGeneration });
      }
      if (!host.isIgnorableError(result.error) && firstError === undefined) {
        firstError = result.error;
      }
    }
  }
  return { failedForces, firstError };
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
  for (
    let offset = 0;
    offset < containerIds.length;
    offset += MAX_CONTAINER_DOCUMENT_LANES
  ) {
    const batch = await sweepContainerBatch({
      containerIds: containerIds.slice(
        offset,
        offset + MAX_CONTAINER_DOCUMENT_LANES,
      ),
      forceAllDocumentContentPulls,
      host,
      lifecycleGeneration,
      state,
    });
    if (!batch) return;
    failedForces.push(...batch.failedForces);
    if (firstError === undefined) firstError = batch.firstError;
  }
  rearmFailedSweepContainers(state, failedForces, lifecycleGeneration);
  if (firstError !== undefined) {
    throw firstError;
  }
}
