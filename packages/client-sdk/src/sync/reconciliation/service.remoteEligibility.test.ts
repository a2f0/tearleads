import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/waitFor";
import { createReconciliationService } from "./service";
import { createReconciliationTestHost } from "./service.testFixtures";
import { enqueueReconciliationForEvents } from "./triggers";

test("service drops a stale local active id and re-arms it after remote backing", async () => {
  const discovered: string[] = [];
  let remoteBacked = false;
  const host = createReconciliationTestHost({
    canDiscoverContainerDocuments: () => remoteBacked,
    discoverContainerDocuments: async (containerId) => {
      discovered.push(containerId);
      return [];
    },
    listKnownContainerIds: () => (remoteBacked ? ["active"] : []),
  });
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
  const host = createReconciliationTestHost({
    canDiscoverContainerDocuments: (containerId) => containerId === "remote",
    discoverContainerDocuments: async (containerId) => {
      discovered.push(containerId);
      return [];
    },
    listKnownContainerIds: () => ["remote"],
  });
  const service = createReconciliationService(host);
  service.start();
  service.setActiveContainer("local-active");

  await service.reconcileNow();

  expect(discovered).toEqual(["remote"]);
});

test("idle backfill rechecks remote eligibility when queued work drains", async () => {
  const discovered: string[] = [];
  let online = false;
  let remoteBacked = false;
  const host = createReconciliationTestHost({
    canDiscoverContainerDocuments: () => remoteBacked,
    discoverContainerDocuments: async (containerId) => {
      discovered.push(containerId);
      return [];
    },
    getRuntimeStatus: () => ({
      dbStatus: "ready",
      isAuthenticated: true,
      online,
    }),
    listKnownContainerIds: () => ["candidate"],
  });
  const service = createReconciliationService(host);
  service.start();
  service.enqueueIdleBackfill();

  remoteBacked = true;
  online = true;
  service.start();

  await waitFor(
    () => discovered.length === 1,
    "Expected dequeue-time eligibility to admit the container",
  );
  expect(discovered).toEqual(["candidate"]);
});

test("forced backfill retains force while a container is ineligible", async () => {
  const contentPulls: boolean[] = [];
  let remoteBacked = false;
  const host = createReconciliationTestHost({
    canDiscoverContainerDocuments: () => remoteBacked,
    listKnownContainerIds: () => ["candidate"],
    requestDocumentContentPull: (_containerId, _documents, force) => {
      contentPulls.push(force);
    },
  });
  const service = createReconciliationService(host);
  service.start();
  service.enqueueIdleBackfill(true);
  await new Promise((resolve) => setTimeout(resolve, 20));

  remoteBacked = true;
  service.enqueueIdleBackfill();
  await waitFor(
    () => contentPulls.length === 1,
    "Expected the promoted container to retain forced content pull",
  );

  expect(contentPulls).toEqual([true]);
});

test("forced backfill retains an active write-only container until eligible", async () => {
  const contentPulls: boolean[] = [];
  let remoteBacked = false;
  const host = createReconciliationTestHost({
    canDiscoverContainerDocuments: () => remoteBacked,
    listKnownContainerIds: () => [],
    requestDocumentContentPull: (_containerId, _documents, force) => {
      contentPulls.push(force);
    },
  });
  const service = createReconciliationService(host);
  service.start();
  service.setActiveContainer("foreign-system");
  service.enqueueIdleBackfill(true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(contentPulls).toEqual([]);

  remoteBacked = true;
  service.enqueueIdleBackfill();
  await waitFor(() => contentPulls.length === 1, "Expected active force");

  expect(contentPulls).toEqual([true]);
});

test("ordinary backfill includes an eligible active write-only container", async () => {
  const contentPulls: boolean[] = [];
  let remoteBacked = false;
  const host = createReconciliationTestHost({
    canDiscoverContainerDocuments: () => remoteBacked,
    listKnownContainerIds: () => [],
    requestDocumentContentPull: (_containerId, _documents, force) => {
      contentPulls.push(force);
    },
  });
  const service = createReconciliationService(host);
  service.start();
  service.setActiveContainer("foreign-system");
  await new Promise((resolve) => setTimeout(resolve, 20));

  remoteBacked = true;
  service.enqueueIdleBackfill();
  await waitFor(() => contentPulls.length === 1, "Expected active backfill");

  expect(contentPulls).toEqual([false]);
});

test("returning to a write-only container consumes an unscoped event", async () => {
  const contentPulls: boolean[] = [];
  const host = createReconciliationTestHost({
    listKnownContainerIds: () => [],
    requestDocumentContentPull: (_containerId, _documents, force) => {
      contentPulls.push(force);
    },
  });
  const service = createReconciliationService(host);
  service.start();
  service.setActiveContainer("foreign-system");
  await waitFor(() => contentPulls.length === 1, "Expected initial pull");
  service.setActiveContainer(null);

  enqueueReconciliationForEvents({
    events: [{ type: "document_update_created", documentId: "d-1" }],
    knownContainerIds: [],
    service,
  });
  service.setActiveContainer("foreign-system");
  await waitFor(() => contentPulls.length === 2, "Expected forced return pull");

  expect(contentPulls).toEqual([false, true]);
});
