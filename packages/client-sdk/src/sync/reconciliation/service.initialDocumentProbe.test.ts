import { expect, test } from "bun:test";
import type { DomainScope } from "../../data/domainScope";
import {
  createReconciliationService,
  type ReconciliationHost,
} from "./service";

function createProbeHost(input: {
  readonly discoverContainerDocuments: (
    containerId: string,
  ) => Promise<unknown>;
  readonly probeUndiscoveredDocuments: (
    listedDocumentIds: ReadonlySet<string>,
  ) => Promise<void>;
}): ReconciliationHost {
  return {
    canDiscoverContainerDocuments: () => true,
    domainScope: {} as DomainScope,
    getRuntimeStatus: () => ({
      dbStatus: "ready",
      isAuthenticated: true,
      online: true,
    }),
    listKnownContainerIds: () => ["c-1", "c-2"],
    listAutomaticRootCatchupContainerIds: () => ["c-1", "c-2"],
    discoverContainerDocuments: input.discoverContainerDocuments,
    loadContainerDelta: async (containerId) => ({
      containerId,
      documentSummaries: [],
    }),
    applyReconciled: () => undefined,
    probeUndiscoveredDocuments: input.probeUndiscoveredDocuments,
    refreshTree: async () => undefined,
    refreshRootTree: async () => undefined,
    isIgnorableError: () => false,
  };
}

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

test("initial idle sweep probes documents absent from every listing once", async () => {
  const probes: string[][] = [];
  const service = createReconciliationService(
    createProbeHost({
      discoverContainerDocuments: async (containerId) =>
        containerId === "c-1"
          ? [{ documentId: "listed-a" }, { documentId: "listed-shared" }]
          : [{ documentId: "listed-b" }, { documentId: "listed-shared" }],
      probeUndiscoveredDocuments: async (listedDocumentIds) => {
        probes.push([...listedDocumentIds].sort());
      },
    }),
  );
  service.start();
  service.enqueueIdleBackfill();

  await waitFor(() => probes.length === 1, "Expected the initial probe");
  expect(probes).toEqual([["listed-a", "listed-b", "listed-shared"]]);

  service.enqueueIdleBackfill();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(probes).toHaveLength(1);
});

test("initial probe waits for every eligible listing to complete", async () => {
  const probes: string[][] = [];
  let listingAttempts = 0;
  let secondListingAvailable = false;
  const service = createReconciliationService(
    createProbeHost({
      discoverContainerDocuments: async (containerId) => {
        listingAttempts += 1;
        if (containerId === "c-2" && !secondListingAvailable) {
          return null;
        }
        return [{ documentId: `listed-${containerId}` }];
      },
      probeUndiscoveredDocuments: async (listedDocumentIds) => {
        probes.push([...listedDocumentIds].sort());
      },
    }),
  );
  service.start();
  service.enqueueIdleBackfill();

  await waitFor(() => listingAttempts === 2, "Expected the initial listings");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(probes).toEqual([]);

  secondListingAvailable = true;
  service.enqueueIdleBackfill();
  await waitFor(() => probes.length === 1, "Expected probe after retry");
  expect(probes).toEqual([["listed-c-1", "listed-c-2"]]);
});
