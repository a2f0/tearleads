import { expect, test } from "bun:test";
import type { DomainScope } from "../../data/domainScope";
import {
  createReconciliationService,
  type ReconciliationHost,
} from "./service";

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() <= deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

test("service drops a stale local active id and re-arms it after remote backing", async () => {
  const discovered: string[] = [];
  let remoteBacked = false;
  const host: ReconciliationHost = {
    applyReconciled: () => {},
    canDiscoverContainerDocuments: () => remoteBacked,
    discoverContainerDocuments: async (containerId) => {
      discovered.push(containerId);
      return [];
    },
    domainScope: {} as DomainScope,
    getRuntimeStatus: () => ({
      dbStatus: "ready",
      isAuthenticated: true,
      online: true,
    }),
    isIgnorableError: () => false,
    listAutomaticRootCatchupContainerIds: () => [],
    listContainerDocumentIds: async () => [],
    listKnownContainerIds: () => (remoteBacked ? ["active"] : []),
    loadContainerDelta: async (containerId) => ({
      containerId,
      documentSummaries: [],
    }),
    refreshRootTree: async () => {},
    refreshTree: async () => {},
    probeUndiscoveredDocumentsBatch: async () => ({
      done: true,
      nextCursor: null,
      requestedCount: 0,
    }),
    reportInitialDocumentProbeComplete: () => undefined,
  };
  const service = createReconciliationService(host);
  service.start();
  service.setActiveContainer("active");

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(discovered).toEqual([]);

  remoteBacked = true;
  service.enqueueIdleBackfill();
  await waitFor(
    () => discovered.length === 1,
    "Expected the promoted active container to reconcile",
  );
  expect(discovered).toEqual(["active"]);
});

test("explicit refresh excludes an ineligible active container", async () => {
  const discovered: string[] = [];
  const host: ReconciliationHost = {
    applyReconciled: () => {},
    canDiscoverContainerDocuments: (containerId) => containerId === "remote",
    discoverContainerDocuments: async (containerId) => {
      discovered.push(containerId);
      return [];
    },
    domainScope: {} as DomainScope,
    getRuntimeStatus: () => ({
      dbStatus: "ready",
      isAuthenticated: true,
      online: true,
    }),
    isIgnorableError: () => false,
    listAutomaticRootCatchupContainerIds: () => [],
    listContainerDocumentIds: async () => [],
    listKnownContainerIds: () => ["remote"],
    loadContainerDelta: async (containerId) => ({
      containerId,
      documentSummaries: [],
    }),
    refreshRootTree: async () => {},
    refreshTree: async () => {},
    probeUndiscoveredDocumentsBatch: async () => ({
      done: true,
      nextCursor: null,
      requestedCount: 0,
    }),
    reportInitialDocumentProbeComplete: () => undefined,
  };
  const service = createReconciliationService(host);
  service.start();
  service.setActiveContainer("local-active");

  await service.reconcileNow();

  expect(discovered).toEqual(["remote"]);
});
