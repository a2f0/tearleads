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
  readonly listKnownContainerIds?: () => ReadonlyArray<string>;
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
    listKnownContainerIds:
      input.listKnownContainerIds ?? (() => ["c-1", "c-2"]),
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
  expect(batches[1]?.listedDocumentIds).toBe(batches[0]?.listedDocumentIds);

  service.enqueueIdleBackfill();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(batches).toHaveLength(2);
});

test("initial probe retries listings in bounded turns before pausing", async () => {
  const probes: InitialDocumentProbeBatchInput[] = [];
  const listingAttempts = new Map<string, number>();
  let secondListingAvailable = false;
  const service = createReconciliationService(
    createProbeHost({
      listContainerDocumentIds: async (containerId) => {
        listingAttempts.set(
          containerId,
          (listingAttempts.get(containerId) ?? 0) + 1,
        );
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

  await waitFor(
    () => listingAttempts.get("c-2") === 3,
    "Expected bounded listing retries",
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(probes).toEqual([]);
  expect(listingAttempts).toEqual(
    new Map([
      ["c-1", 1],
      ["c-2", 3],
    ]),
  );

  secondListingAvailable = true;
  service.enqueueIdleBackfill();
  await waitFor(() => probes.length === 1, "Expected probe after retry");
  expect(listingAttempts.get("c-2")).toBe(4);
  expect([...(probes[0]?.listedDocumentIds ?? [])].sort()).toEqual([
    "listed-c-1",
    "listed-c-2",
  ]);
});

test("an empty early tree does not complete before remote containers arrive", async () => {
  let knownContainerIds: ReadonlyArray<string> = [];
  const listedContainerIds: string[] = [];
  const completedCounts: number[] = [];
  let probeCount = 0;
  const service = createReconciliationService(
    createProbeHost({
      listKnownContainerIds: () => knownContainerIds,
      listContainerDocumentIds: async (containerId) => {
        listedContainerIds.push(containerId);
        return [`listed-${containerId}`];
      },
      probeUndiscoveredDocumentsBatch: async () => {
        probeCount += 1;
        return { done: true, nextCursor: null, requestedCount: 0 };
      },
      reportComplete: (requestedCount) => {
        completedCounts.push(requestedCount);
      },
    }),
  );
  service.start();
  service.enqueueIdleBackfill();
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(listedContainerIds).toEqual([]);
  expect(probeCount).toBe(0);
  expect(completedCounts).toEqual([]);

  knownContainerIds = ["c-1"];
  service.enqueueIdleBackfill();
  await waitFor(() => probeCount === 1, "Expected late-container probe");
  expect(listedContainerIds).toEqual(["c-1"]);
  expect(completedCounts).toEqual([0]);
});

test("container growth does not reopen a completed initial pass", async () => {
  let knownContainerIds: ReadonlyArray<string> = ["c-1"];
  const batches: InitialDocumentProbeBatchInput[] = [];
  const completedCounts: number[] = [];
  const service = createReconciliationService(
    createProbeHost({
      listKnownContainerIds: () => knownContainerIds,
      listContainerDocumentIds: async (containerId) => [
        `listed-${containerId}`,
      ],
      probeUndiscoveredDocumentsBatch: async (batch) => {
        batches.push(batch);
        return { done: true, nextCursor: null, requestedCount: 1 };
      },
      reportComplete: (requestedCount) => {
        completedCounts.push(requestedCount);
      },
    }),
  );
  service.start();
  service.enqueueIdleBackfill();
  await waitFor(() => batches.length === 1, "Expected first probe pass");

  knownContainerIds = ["c-1", "c-2"];
  service.enqueueIdleBackfill();
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect([...(batches[0]?.listedContainerIds ?? [])]).toEqual(["c-1"]);
  expect(batches).toHaveLength(1);
  expect(completedCounts).toEqual([1]);
});

test("container growth invalidates an in-flight candidate cursor", async () => {
  let knownContainerIds: ReadonlyArray<string> = ["c-1"];
  let releaseFirstBatch: (() => void) | undefined;
  const batches: InitialDocumentProbeBatchInput[] = [];
  const service = createReconciliationService(
    createProbeHost({
      listKnownContainerIds: () => knownContainerIds,
      listContainerDocumentIds: async (containerId) => [
        `listed-${containerId}`,
      ],
      probeUndiscoveredDocumentsBatch: async (batch) => {
        batches.push(batch);
        if (batches.length === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstBatch = resolve;
          });
          return { done: false, nextCursor: "local-8", requestedCount: 8 };
        }
        return { done: true, nextCursor: null, requestedCount: 0 };
      },
    }),
  );
  service.start();
  service.enqueueIdleBackfill();
  await waitFor(
    () => releaseFirstBatch !== undefined,
    "Expected in-flight candidate batch",
  );

  knownContainerIds = ["c-1", "c-2"];
  service.enqueueIdleBackfill();
  releaseFirstBatch?.();
  await waitFor(
    () => batches.length === 2,
    "Expected restarted candidate scan",
  );

  expect(batches[1]?.afterLocalId).toBeNull();
  expect([...(batches[1]?.listedContainerIds ?? [])].sort()).toEqual([
    "c-1",
    "c-2",
  ]);
});

test("discovery reset preserves an in-progress probe cursor", async () => {
  const batches: InitialDocumentProbeBatchInput[] = [];
  let online = true;
  const service = createReconciliationService({
    ...createProbeHost({
      listKnownContainerIds: () => ["c-1"],
      listContainerDocumentIds: async () => ["listed-c-1"],
      probeUndiscoveredDocumentsBatch: async (batch) => {
        batches.push(batch);
        if (batches.length === 1) {
          online = false;
          return { done: false, nextCursor: "local-8", requestedCount: 8 };
        }
        return { done: true, nextCursor: null, requestedCount: 0 };
      },
    }),
    getRuntimeStatus: () => ({
      dbStatus: "ready",
      isAuthenticated: true,
      online,
    }),
  });
  service.start();
  service.enqueueIdleBackfill();
  await waitFor(() => batches.length === 1, "Expected first candidate batch");

  service.resetDiscovered();
  online = true;
  service.enqueueIdleBackfill();
  await waitFor(() => batches.length === 2, "Expected resumed candidate batch");

  expect(batches[1]?.afterLocalId).toBe("local-8");
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
