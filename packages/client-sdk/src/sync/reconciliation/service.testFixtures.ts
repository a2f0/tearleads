import { expect } from "bun:test";
import type { DocumentSummary } from "../../data/documents/documentSummary";
import { createDomainScope } from "../../data/domainScope";
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

/** A fully no-op reconciliation host; tests override only what they observe. */
export function createReconciliationTestHost(
  overrides: Partial<ReconciliationHost> = {},
): ReconciliationHost {
  return {
    applyReconciled: () => undefined,
    canDiscoverContainerDocuments: () => true,
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
    reportInitialDocumentProbeComplete: () => undefined,
    requestDocumentContentPull: () => undefined,
    ...overrides,
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
