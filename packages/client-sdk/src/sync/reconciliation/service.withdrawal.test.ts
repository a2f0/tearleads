import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/waitFor";
import { createReconciliationService } from "./service";
import {
  createGate,
  createReconciliationTestHost,
  perContainerDiscovery,
} from "./service.testFixtures";

// One request lists 32 lanes, so 40 containers take two sweep batches.
const KNOWN = Array.from({ length: 40 }, (_, index) => `c-${index}`);

function abortError(): DOMException {
  return new DOMException("Refresh cancelled", "AbortError");
}

// The last caller withdrawing stops the sweep before its next batch, for a
// full refresh and a root catch-up alike. Its own promise settles at once and
// the batch in flight finishes. The sweep lists 32 containers per request;
// the containers it never reached go back to the background lane, which
// lists at most 4 at a time, so no later listing is a sweep batch.
for (const scope of ["full", "root"] as const) {
  test(`withdrawing the last caller stops a ${scope} sweep between batches`, async () => {
    const firstBatchStarted = createGate();
    const finishFirstBatch = createGate();
    const batchSizes: number[] = [];
    const listed = new Set<string>();
    const discoverEach = perContainerDiscovery(async () => []);
    const host = createReconciliationTestHost({
      discoverContainerDocuments: async (requests, onOutcome) => {
        batchSizes.push(requests.length);
        for (const { containerId } of requests) listed.add(containerId);
        if (batchSizes.length === 1) {
          firstBatchStarted.open();
          await finishFirstBatch.wait;
        }
        return discoverEach(requests, onOutcome);
      },
      listAutomaticRootCatchupContainerIds: () => KNOWN,
      listKnownContainerIds: () => KNOWN,
    });
    const service = createReconciliationService(host);
    service.start();
    const caller = new AbortController();

    const refresh =
      scope === "full"
        ? service.reconcileNow({ signal: caller.signal })
        : service.reconcileRootContainersNow({ signal: caller.signal });
    await firstBatchStarted.wait;
    const reason = abortError();
    caller.abort(reason);
    await expect(refresh).rejects.toBe(reason);
    finishFirstBatch.open();

    await waitFor(
      () => listed.size === KNOWN.length,
      "Expected the unreached containers to reconcile in the background",
      2_000,
    );
    expect(batchSizes[0]).toBe(32);
    expect(batchSizes.slice(1).every((size) => size <= 4)).toBe(true);
  });
}

// Opening a container the sweep had not reached yet is suppressed by the
// sweep's mark. If the sweep then stops, that one navigation must still
// reconcile the container, with no second enqueue to rescue it.
test("a container opened during a stopped sweep still reconciles", async () => {
  const firstBatchStarted = createGate();
  const finishFirstBatch = createGate();
  const discovered: string[] = [];
  const host = createReconciliationTestHost({
    discoverContainerDocuments: perContainerDiscovery(async (containerId) => {
      discovered.push(containerId);
      if (containerId === "c-0") {
        firstBatchStarted.open();
        await finishFirstBatch.wait;
      }
      return [];
    }),
    listKnownContainerIds: () => KNOWN,
  });
  const service = createReconciliationService(host);
  service.start();
  const caller = new AbortController();

  const refresh = service.reconcileNow({ signal: caller.signal });
  await firstBatchStarted.wait;
  service.setActiveContainer("c-35");
  caller.abort(abortError());
  await expect(refresh).rejects.toThrow("Refresh cancelled");
  finishFirstBatch.open();

  await waitFor(
    () => discovered.includes("c-35"),
    "Expected the opened container to reconcile after the stop",
    2_000,
  );
});

// The reconnect catch-up joins an Explorer refresh without a signal. The
// Explorer withdrawing must not cancel the catch-up's sweep.
test("a caller without a signal keeps a shared refresh running", async () => {
  const firstBatchStarted = createGate();
  const finishFirstBatch = createGate();
  const discovered: string[] = [];
  const host = createReconciliationTestHost({
    discoverContainerDocuments: perContainerDiscovery(async (containerId) => {
      discovered.push(containerId);
      if (containerId === "c-0") {
        firstBatchStarted.open();
        await finishFirstBatch.wait;
      }
      return [];
    }),
    listKnownContainerIds: () => KNOWN,
  });
  const service = createReconciliationService(host);
  service.start();
  const explorer = new AbortController();

  const cancelled = service.reconcileNow({ signal: explorer.signal });
  const catchUp = service.reconcileNow();
  await firstBatchStarted.wait;
  explorer.abort(abortError());
  await expect(cancelled).rejects.toThrow("Refresh cancelled");
  finishFirstBatch.open();

  await catchUp;
  expect(new Set(discovered)).toEqual(new Set(KNOWN));
});

// A trailing refresh queued behind a running one, whose only caller withdrew
// before it began, never starts; a later request starts a fresh one rather
// than joining the stopped one.
test("a queued refresh whose callers all withdrew never starts", async () => {
  const treeStarted = createGate();
  const finishTree = createGate();
  let treeRefreshes = 0;
  const host = createReconciliationTestHost({
    listKnownContainerIds: () => ["c-1"],
    refreshTree: async () => {
      treeRefreshes += 1;
      if (treeRefreshes === 1) {
        treeStarted.open();
        await finishTree.wait;
      }
    },
  });
  const service = createReconciliationService(host);
  service.start();

  const running = service.reconcileNow();
  await treeStarted.wait;
  const caller = new AbortController();
  const queued = service.reconcileNow({
    freshListing: true,
    signal: caller.signal,
  });
  caller.abort(abortError());
  await expect(queued).rejects.toThrow("Refresh cancelled");
  finishTree.open();
  await running;
  expect(treeRefreshes).toBe(1);

  await service.reconcileNow({ freshListing: true });
  expect(treeRefreshes).toBe(2);
});

// Withdrawing while the tree refresh runs skips the document sweep; the tree
// crawl itself belongs to the store and is not cancelled.
test("withdrawing during the tree refresh skips the sweep", async () => {
  const treeStarted = createGate();
  const finishTree = createGate();
  const discovered: string[] = [];
  let treeFinished = false;
  const host = createReconciliationTestHost({
    discoverContainerDocuments: perContainerDiscovery(async (containerId) => {
      discovered.push(containerId);
      return [];
    }),
    listKnownContainerIds: () => ["c-1"],
    refreshTree: async () => {
      treeStarted.open();
      await finishTree.wait;
      treeFinished = true;
    },
  });
  const service = createReconciliationService(host);
  const caller = new AbortController();

  const refresh = service.reconcileNow({ signal: caller.signal });
  await treeStarted.wait;
  caller.abort(abortError());
  await expect(refresh).rejects.toThrow("Refresh cancelled");
  finishTree.open();
  await service.reconcileNow({ freshListing: true });

  expect(treeFinished).toBe(true);
  // Only the later refresh swept.
  expect(discovered).toEqual(["c-1"]);
});

test("an already aborted caller starts no refresh", async () => {
  let treeRefreshes = 0;
  const host = createReconciliationTestHost({
    refreshTree: async () => {
      treeRefreshes += 1;
    },
  });
  const service = createReconciliationService(host);
  const caller = new AbortController();
  caller.abort(abortError());

  await expect(service.reconcileNow({ signal: caller.signal })).rejects.toThrow(
    "Refresh cancelled",
  );
  await service.reconcileNow();
  expect(treeRefreshes).toBe(1);
});
