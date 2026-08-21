import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/waitFor";
import { createReconciliationService } from "./service";
import {
  createReconciliationTestHost,
  silenceExpectedTransientDiscoveryError,
} from "./service.testFixtures";

test("forced idle backfill retries every settled container", async () => {
  const attempts: string[] = [];
  const contentPulls: boolean[] = [];
  const host = createReconciliationTestHost({
    discoverContainerDocuments: async (containerId) => {
      attempts.push(containerId);
    },
    listKnownContainerIds: () => ["c-1", "c-2"],
    requestDocumentContentPull: (_containerId, _documents, force) => {
      contentPulls.push(force);
    },
  });
  const service = createReconciliationService(host);
  service.start();

  service.enqueueIdleBackfill();
  await waitFor(() => attempts.length === 2, "Expected the initial backfill");
  service.enqueueIdleBackfill(true);
  await waitFor(
    () => attempts.length === 4,
    "Expected forced backfill to retry every settled container",
  );

  expect(attempts).toEqual(["c-1", "c-2", "c-1", "c-2"]);
  expect(contentPulls).toEqual([false, false, true, true]);
});

test("forced backfill retains force until a transient retry succeeds", async () => {
  const restoreConsoleError = silenceExpectedTransientDiscoveryError();
  const attempts: string[] = [];
  const contentPulls: boolean[] = [];
  let failNext = false;

  try {
    const host = createReconciliationTestHost({
      discoverContainerDocuments: async (containerId) => {
        attempts.push(containerId);
        if (failNext) {
          failNext = false;
          throw new Error("transient discovery failure");
        }
      },
      listKnownContainerIds: () => ["c-1"],
      requestDocumentContentPull: (_containerId, _documents, force) => {
        contentPulls.push(force);
      },
    });
    const service = createReconciliationService(host);
    service.start();
    service.enqueueIdleBackfill();
    await waitFor(() => attempts.length === 1, "Expected initial backfill");

    failNext = true;
    service.enqueueIdleBackfill(true);
    await waitFor(() => attempts.length === 2, "Expected forced failure");
    service.enqueueIdleBackfill();
    await waitFor(() => attempts.length === 3, "Expected forced retry");

    expect(contentPulls).toEqual([false, true]);
  } finally {
    restoreConsoleError();
  }
});

test("unscoped invalidation force-reconciles containers hydrated later", async () => {
  const attempts: Array<{ containerId: string; force: boolean }> = [];
  const knownContainerIds = ["c-1"];
  const host = createReconciliationTestHost({
    discoverContainerDocuments: async () => undefined,
    listKnownContainerIds: () => knownContainerIds,
    requestDocumentContentPull: (containerId, _documents, force) => {
      attempts.push({ containerId, force });
    },
  });
  const service = createReconciliationService(host);
  service.start();

  service.enqueueIdleBackfill(true);
  await waitFor(() => attempts.length === 1, "Expected known container force");
  knownContainerIds.push("c-2");
  service.enqueueIdleBackfill();
  await waitFor(() => attempts.length === 2, "Expected late container force");
  service.enqueueIdleBackfill();
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(attempts).toEqual([
    { containerId: "c-1", force: true },
    { containerId: "c-2", force: true },
  ]);
});
