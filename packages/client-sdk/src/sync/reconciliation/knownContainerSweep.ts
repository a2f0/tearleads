import { MAX_CONTAINER_DOCUMENT_LANES } from "@tearleads/validators/request";
import type { ReconciliationClock } from "./clock";
import {
  acknowledgeContainerForce,
  type IdleBackfillState,
  markContainerForced,
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
  Map<string, { cancel: () => void; due: number }>
>();

export function clearPendingDiscoveryRetries(
  state: KnownContainerSweepState,
): void {
  for (const { cancel } of pendingRetries.get(state)?.values() ?? []) cancel();
  pendingRetries.delete(state);
}

function schedulePendingDiscovery(
  clock: ReconciliationClock,
  state: KnownContainerSweepState,
  containerId: string,
  delayMs: number,
): void {
  if (!state.active) return;
  const retries = pendingRetries.get(state) ?? new Map();
  pendingRetries.set(state, retries);
  const due = clock.now() + delayMs;
  const existing = retries.get(containerId);
  if (existing && existing.due <= due) return;
  existing?.cancel();
  const generation = state.lifecycleGeneration;
  const cancel = clock.schedule(
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
  retries.set(containerId, { cancel, due });
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
        schedulePendingDiscovery(host.clock, state, containerId, delayMs),
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
 * The force a failed container keeps for its automatic retry: the one it had
 * when its batch started, or, in a sweep that lists every container, the
 * sweep's own. Such a sweep covers every container but only within its pass,
 * so a failure keeps a force like a hint's, to be acknowledged only by a
 * later success. A newer
 * hint that arrived meanwhile already holds a force and its own queue entry,
 * so it is left alone.
 */
function failedContainerForce(
  state: KnownContainerSweepState,
  containerId: string,
  batchForceGeneration: number | undefined,
  listsEveryContainer: boolean,
): FailedForcedContainer | null {
  if (batchForceGeneration !== undefined) {
    return { containerId, forceGeneration: batchForceGeneration };
  }
  if (
    !listsEveryContainer ||
    state.forcedContainerGenerations.has(containerId)
  ) {
    return null;
  }
  markContainerForced(state, containerId);
  const forceGeneration = state.forcedContainerGenerations.get(containerId);
  return forceGeneration === undefined
    ? null
    : { containerId, forceGeneration };
}

/**
 * A lane the catch-up after an acknowledged connection could not list says
 * nothing about its documents, so each registered one is probed, as every
 * opened document was before listings owed reads. The lane keeps its force
 * and is listed again by its retry.
 */
async function probeUnlistedLanes(
  host: ReconciliationHost,
  results: ReadonlyArray<ContainerReconcileResult>,
): Promise<void> {
  for (const { containerId, listed } of results) {
    if (listed || !host.canDiscoverContainerDocuments(containerId)) continue;
    try {
      const delta = await host.loadContainerDelta(containerId);
      host.requestDocumentContentPull(
        containerId,
        delta.documentSummaries,
        true,
      );
    } catch (error) {
      if (!host.isIgnorableError(error)) {
        host.logError?.("Reconciliation: unlisted lane probe failed", error);
      }
    }
  }
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
  listsEveryContainer: boolean;
  onListed: ((containerId: string) => void) | undefined;
  probeUnlistedLanes: boolean;
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
  const isCurrent = () =>
    isCurrentReconciliationLifecycle(state, input.lifecycleGeneration);
  if (input.probeUnlistedLanes && isCurrent()) {
    await probeUnlistedLanes(host, results);
  }
  if (!isCurrent()) return null;
  for (const result of results) {
    if (result.listed) input.onListed?.(result.containerId);
  }
  return settleBatchForces({
    forceGenerations,
    host,
    listsEveryContainer: input.listsEveryContainer,
    results,
    state,
  });
}

/**
 * Acknowledges the force of each container a batch reconciled, and keeps one
 * for each it failed, to be retried.
 */
function settleBatchForces(input: {
  forceGenerations: ReadonlyMap<string, number | undefined>;
  host: ReconciliationHost;
  listsEveryContainer: boolean;
  results: ReadonlyArray<ContainerReconcileResult>;
  state: KnownContainerSweepState;
}): {
  readonly failedForces: ReadonlyArray<FailedForcedContainer>;
  readonly firstError: unknown;
} {
  const { host, state } = input;
  const failedForces: FailedForcedContainer[] = [];
  let firstError: unknown;
  for (const result of input.results) {
    const forceGeneration = input.forceGenerations.get(result.containerId);
    if (result.status === "reconciled") {
      acknowledgeContainerForce(state, result.containerId, forceGeneration);
    } else if (result.status === "failed") {
      const failedForce = failedContainerForce(
        state,
        result.containerId,
        forceGeneration,
        input.listsEveryContainer,
      );
      if (failedForce) failedForces.push(failedForce);
      if (!host.isIgnorableError(result.error) && firstError === undefined) {
        firstError = result.error;
      }
    }
  }
  return { failedForces, firstError };
}

/**
 * Hands a stopped sweep's unreached containers back to the background lane.
 * The sweep marked them discovered up front, so while it ran the lane dropped
 * any queued entry for them and a navigation to one was suppressed. Their
 * marks are released and they are queued again, the active container first,
 * so stopping a sweep never loses work it had absorbed. A container that was
 * already discovered before the sweep keeps its mark: the lane skips it
 * either way.
 */
function releaseUnreachedContainers(
  state: KnownContainerSweepState,
  unreached: ReadonlyArray<string>,
  markedBySweep: ReadonlySet<string>,
): void {
  for (const containerId of unreached) {
    if (!markedBySweep.has(containerId)) continue;
    state.discoveredContainerIds.delete(containerId);
    state.queue.enqueue(
      containerId,
      containerId === state.activeContainerId ? "active" : "idle",
    );
  }
  const activeContainerId = state.activeContainerId;
  if (activeContainerId && unreached.includes(activeContainerId)) {
    state.queue.enqueue(activeContainerId, "active");
  }
  if (state.queue.size > 0) state.lane?.requestSync();
}

export async function sweepKnownContainers(input: {
  /** Revalidate every registered document of each container that changed. */
  forceAllDocumentContentPulls: boolean;
  host: ReconciliationHost;
  knownIds: ReadonlyArray<string>;
  lifecycleGeneration: number;
  /**
   * List every known container, not only the forced and undiscovered ones.
   * Implied by `forceAllDocumentContentPulls`.
   */
  listsEveryContainer?: boolean | undefined;
  /** Told each container whose document lane this sweep listed. */
  onListed?: ((containerId: string) => void) | undefined;
  /** Probe the registered documents of a lane this sweep could not list. */
  probeUnlistedLanes?: boolean | undefined;
  state: KnownContainerSweepState;
  /**
   * Ends the sweep before its next batch. The batch in flight finishes, and
   * the sweep settles without reporting a failure, since no caller waits.
   */
  stop?: AbortSignal | undefined;
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
  const listsEveryContainer =
    forceAllDocumentContentPulls || input.listsEveryContainer === true;
  const containerIds = listsEveryContainer
    ? knownIds
    : knownIds.filter(
        (containerId) =>
          state.forcedContainerGenerations.has(containerId) ||
          !state.discoveredContainerIds.has(containerId),
      );
  // Mark only the containers this sweep will fetch. Automatic root hints are
  // discovery signals, so already-reconciled containers stay settled unless a
  // targeted event forced them; explicit full refreshes still fetch every id.
  const markedBySweep = new Set(
    containerIds.filter((id) => !state.discoveredContainerIds.has(id)),
  );
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
    if (input.stop?.aborted) {
      releaseUnreachedContainers(
        state,
        containerIds.slice(offset),
        markedBySweep,
      );
      break;
    }
    const batch = await sweepContainerBatch({
      containerIds: containerIds.slice(
        offset,
        offset + MAX_CONTAINER_DOCUMENT_LANES,
      ),
      forceAllDocumentContentPulls,
      host,
      lifecycleGeneration,
      listsEveryContainer,
      onListed: input.onListed,
      probeUnlistedLanes: input.probeUnlistedLanes === true,
      state,
    });
    if (!batch) return;
    failedForces.push(...batch.failedForces);
    if (firstError === undefined) firstError = batch.firstError;
  }
  rearmFailedSweepContainers(state, failedForces, lifecycleGeneration);
  if (firstError !== undefined && !input.stop?.aborted) {
    throw firstError;
  }
}
