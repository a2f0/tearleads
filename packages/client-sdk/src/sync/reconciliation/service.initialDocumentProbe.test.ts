import { expect, test } from "bun:test";
import type { DomainScope } from "../../data/domainScope";
import type {
  InitialDocumentProbeBatchInput,
  InitialDocumentProbeBatchResult,
} from "./initialDocumentProbe";
import {
  createReconciliationService,
  type ReconciliationHost,
} from "./service";

function createProbeHost(input: {
  readonly listContainerDocumentIds: (
    containerId: string,
  ) => Promise<ReadonlyArray<string> | null>;
  readonly probeUndiscoveredDocumentsBatch: (
    input: InitialDocumentProbeBatchInput,
  ) => Promise<InitialDocumentProbeBatchResult>;
  readonly reportComplete?: (requestedCount: number) => void;
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
    listContainerDocumentIds: input.listContainerDocumentIds,
    discoverContainerDocuments: async () => [],
    loadContainerDelta: async (containerId) => ({
      containerId,
      documentSummaries: [],
    }),
    applyReconciled: () => undefined,
    probeUndiscoveredDocumentsBatch: input.probeUndiscoveredDocumentsBatch,
    reportInitialDocumentProbeComplete:
      input.reportComplete ?? (() => undefined),
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

test("initial probe uses every authoritative listing and bounded batches once", async () => {
  const batches: InitialDocumentProbeBatchInput[] = [];
  const completedCounts: number[] = [];
  const service = createReconciliationService(
    createProbeHost({
      listContainerDocumentIds: async (containerId) =>
        containerId === "c-1"
          ? ["listed-a", "listed-shared"]
          : ["listed-b", "listed-shared"],
      probeUndiscoveredDocumentsBatch: async (batch) => {
        batches.push(batch);
        return batches.length === 1
          ? { done: false, nextCursor: "local-8", requestedCount: 8 }
          : { done: true, nextCursor: null, requestedCount: 1 };
      },
      reportComplete: (requestedCount) => {
        completedCounts.push(requestedCount);
      },
    }),
  );
  service.start();
  service.enqueueIdleBackfill();

  await waitFor(() => completedCounts.length === 1, "Expected initial probe");
  expect(completedCounts).toEqual([9]);
  expect(batches).toHaveLength(2);
  expect([...(batches[0]?.listedContainerIds ?? [])].sort()).toEqual([
    "c-1",
    "c-2",
  ]);
  expect([...(batches[0]?.listedDocumentIds ?? [])].sort()).toEqual([
    "listed-a",
    "listed-b",
    "listed-shared",
  ]);
  expect(batches[0]?.afterLocalId).toBeNull();
  expect(batches[1]?.afterLocalId).toBe("local-8");

  service.enqueueIdleBackfill();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(batches).toHaveLength(2);
});

test("initial probe pauses until every authoritative listing succeeds", async () => {
  const probes: InitialDocumentProbeBatchInput[] = [];
  let listingAttempts = 0;
  let secondListingAvailable = false;
  const service = createReconciliationService(
    createProbeHost({
      listContainerDocumentIds: async (containerId) => {
        listingAttempts += 1;
        if (containerId === "c-2" && !secondListingAvailable) {
          return null;
        }
        return [`listed-${containerId}`];
      },
      probeUndiscoveredDocumentsBatch: async (batch) => {
        probes.push(batch);
        return { done: true, nextCursor: null, requestedCount: 0 };
      },
    }),
  );
  service.start();
  service.enqueueIdleBackfill();

  await waitFor(() => listingAttempts === 2, "Expected full listings");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(probes).toEqual([]);

  secondListingAvailable = true;
  service.enqueueIdleBackfill();
  await waitFor(() => probes.length === 1, "Expected probe after retry");
  expect([...(probes[0]?.listedDocumentIds ?? [])].sort()).toEqual([
    "listed-c-1",
    "listed-c-2",
  ]);
});

test("stop invalidates an in-flight listing before a restarted probe", async () => {
  let releaseFirstListing: (() => void) | undefined;
  let listingAttempts = 0;
  let probeCount = 0;
  const service = createReconciliationService(
    createProbeHost({
      listContainerDocumentIds: async (containerId) => {
        listingAttempts += 1;
        if (listingAttempts === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstListing = resolve;
          });
        }
        return [`listed-${containerId}`];
      },
      probeUndiscoveredDocumentsBatch: async () => {
        probeCount += 1;
        return { done: true, nextCursor: null, requestedCount: 0 };
      },
    }),
  );
  service.start();
  service.enqueueIdleBackfill();
  await waitFor(
    () => releaseFirstListing !== undefined,
    "Expected in-flight listing",
  );

  service.stop();
  service.start();
  service.enqueueIdleBackfill();
  releaseFirstListing?.();

  await waitFor(() => probeCount === 1, "Expected restarted probe");
  expect(listingAttempts).toBe(3);
});
