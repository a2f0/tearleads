import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/waitFor";
import { createReconciliationService } from "./service";
import {
  createReconciliationTestHost,
  perContainerDiscovery,
} from "./service.testFixtures";

// A full sweep takes over the queue so each container is fetched once. A
// queued container outside the known set is not in the sweep, so it must be
// handed back rather than dropped with the rest of the queue.
test("a full refresh hands back a queued container it did not reconcile", async () => {
  const discovered: string[] = [];
  const host = createReconciliationTestHost({
    discoverContainerDocuments: perContainerDiscovery(async (containerId) => {
      discovered.push(containerId);
      return [];
    }),
    listKnownContainerIds: () => ["known"],
  });
  const service = createReconciliationService(host);
  // Not started yet, so the queued container waits for the lane.
  service.enqueueContainer("outside", "idle");

  await service.reconcileNow();
  expect(discovered).toEqual(["known"]);

  service.start();
  await waitFor(
    () => discovered.includes("outside"),
    "Expected the handed-back container to reconcile",
    2_000,
  );
  expect(discovered).toEqual(["known", "outside"]);
});

// Refresh and reconnect force every container, so a transient failure must
// keep that force, retry once after the backoff, and pull content forced.
test("a full refresh keeps the force of a container that failed", async () => {
  const contentPulls: boolean[] = [];
  let attempts = 0;
  const host = createReconciliationTestHost({
    discoverContainerDocuments: perContainerDiscovery(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("listing unavailable");
      return [];
    }),
    listKnownContainerIds: () => ["c-1"],
    requestDocumentContentPull: (_containerId, _documents, force) => {
      contentPulls.push(force);
    },
  });
  const service = createReconciliationService(host);
  service.start();

  await expect(service.reconcileNow()).rejects.toThrow("listing unavailable");
  await waitFor(() => attempts === 2, "Expected the retained force", 2_000);
  await waitFor(() => contentPulls.length === 1, "Expected a content pull");

  expect(contentPulls).toEqual([true]);
});
