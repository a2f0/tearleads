import { expect } from "bun:test";
import { createDomainScope } from "../../data/domainScope";
import type { ReconciliationHost } from "./serviceTypes";

/** A fully no-op reconciliation host; tests override only what they observe. */
export function createReconciliationTestHost(
  overrides: Partial<ReconciliationHost> = {},
): ReconciliationHost {
  return {
    applyReconciled: () => undefined,
    canDiscoverContainerDocuments: () => true,
    discoverContainerDocuments: async () => [],
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
