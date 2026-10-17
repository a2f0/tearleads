import { expect } from "bun:test";
import type { DocumentSummary } from "../../data/documents/documentSummary";
import { createDomainScope } from "../../data/domainScope";
import { getOrCreateDomainSyncCoordinator } from "../../data/sync/syncCoordinator";
import { type ReconciliationClock, systemReconciliationClock } from "./clock";
import type {
  ContainerDiscoveryOutcome,
  ContainerDiscoveryRequest,
  ReconciliationHost,
  ReconciliationService,
} from "./serviceTypes";

/** A per-container discovery mock; it may throw to reject its lane. */
export type PerContainerDiscovery = (
  containerId: string,
  onFullListing?: ContainerDiscoveryRequest["onFullListing"],
  onPendingDiscovery?: ContainerDiscoveryRequest["onPendingDiscovery"],
) => Promise<ReadonlyArray<DocumentSummary> | null>;

/** Serves each lane of a batched discovery from a per-container mock, in order. */
export function perContainerDiscovery(
  discover: PerContainerDiscovery,
): ReconciliationHost["discoverContainerDocuments"] {
  return async (requests, onOutcome) => {
    const outcomes: ContainerDiscoveryOutcome[] = [];
    for (const { containerId, onFullListing, onPendingDiscovery } of requests) {
      let outcome: ContainerDiscoveryOutcome;
      try {
        outcome = {
          containerId,
          status: "fulfilled",
          value: await discover(containerId, onFullListing, onPendingDiscovery),
        };
      } catch (reason) {
        outcome = { containerId, reason, status: "rejected" };
      }
      outcomes.push(outcome);
      await onOutcome(outcome);
    }
    return outcomes;
  };
}

/**
 * A fully no-op reconciliation host; tests override only what they observe.
 * Its lane runs on the real coordinator for the host's scope, so lane failure
 * backoff and delayed requests keep production timing.
 */
export function createReconciliationTestHost(
  overrides: Partial<ReconciliationHost> = {},
): ReconciliationHost {
  const host: ReconciliationHost = {
    applyReconciled: () => undefined,
    canDiscoverContainerDocuments: () => true,
    clock: systemReconciliationClock,
    discoverContainerDocuments: perContainerDiscovery(async () => []),
    domainScope: createDomainScope(),
    getRuntimeStatus: () => ({
      dbStatus: "ready",
      isAuthenticated: true,
      online: true,
    }),
    isIgnorableError: () => false,
    listAutomaticRootCatchupContainerIds: () => [],
    listContainerDocumentIds: async () => [],
    listKnownContainerIds: () => [],
    loadContainerDelta: async (containerId) => ({
      containerId,
      documentSummaries: [],
    }),
    probeUndiscoveredDocumentsBatch: async () => ({
      done: true,
      nextCursor: null,
      requestedCount: 0,
    }),
    refreshRootTree: async () => undefined,
    refreshTree: async () => undefined,
    registerLane: (key, config) =>
      getOrCreateDomainSyncCoordinator(host.domainScope).registerLane(
        key,
        config,
      ),
    reportInitialDocumentProbeComplete: () => undefined,
    requestDocumentContentPull: () => undefined,
    ...overrides,
  };
  return host;
}

/** A reconciliation clock that only moves when the test advances it. */
export interface ManualReconciliationClock extends ReconciliationClock {
  /** Move time forward, running every timer that falls due in order. */
  readonly advance: (ms: number) => void;
}

export function createManualReconciliationClock(
  startMs = 0,
): ManualReconciliationClock {
  let nowMs = startMs;
  let nextId = 0;
  const timers = new Map<number, { callback: () => void; dueMs: number }>();
  return {
    advance: (ms) => {
      const targetMs = nowMs + ms;
      for (;;) {
        let next: [number, { callback: () => void; dueMs: number }] | null =
          null;
        for (const entry of timers) {
          if (
            entry[1].dueMs <= targetMs &&
            (!next || entry[1].dueMs < next[1].dueMs)
          ) {
            next = entry;
          }
        }
        if (!next) break;
        timers.delete(next[0]);
        nowMs = next[1].dueMs;
        next[1].callback();
      }
      nowMs = targetMs;
    },
    now: () => nowMs,
    schedule: (callback, delayMs) => {
      const id = nextId++;
      timers.set(id, { callback, dueMs: nowMs + Math.max(0, delayMs) });
      return () => {
        timers.delete(id);
      };
    },
  };
}

/** A promise plus its resolver, for gating a mock host call open by hand. */
export function createGate(): { open: () => void; wait: Promise<void> } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, wait };
}

export function silenceExpectedTransientDiscoveryError(
  expectedCount = 1,
): () => void {
  const originalConsoleError = console.error;
  let actualCount = 0;

  console.error = (...args: unknown[]) => {
    const isExpectedDiscoveryFailure =
      args[0] === "Device-first reconciliation failed:" &&
      args.some(
        (arg) =>
          arg instanceof Error && arg.message === "transient discovery failure",
      );
    if (isExpectedDiscoveryFailure) {
      actualCount += 1;
      return;
    }

    originalConsoleError(...args);
  };

  return () => {
    console.error = originalConsoleError;
    expect(actualCount).toBe(expectedCount);
  };
}

/** Queue a scoped event for each known container at the event lane priority. */
export function forceKnownContainers(
  service: ReconciliationService,
  host: ReconciliationHost,
): void {
  for (const containerId of host.listKnownContainerIds()) {
    service.enqueueContainer(containerId, "active", true);
  }
}
