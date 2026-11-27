import { expect, test } from "bun:test";
import { DATABASE_TRANSACTION_BUSY_MESSAGE } from "@tearleads/sqlite-worker/types";
import { MAX_CONTAINER_DOCUMENT_LANES } from "@tearleads/validators/request";
import { waitFor } from "../../../test/helpers/data/waitFor";
import { createReconciliationService } from "./service";
import {
  createReconciliationTestHost,
  forceKnownContainers,
  perContainerDiscovery,
  silenceExpectedTransientDiscoveryError,
} from "./service.testFixtures";

const busyRefusal = () =>
  new Error("Failed query", {
    cause: new Error(DATABASE_TRANSACTION_BUSY_MESSAGE),
  });

test("busy SQLite refusals do not spend a forced container's automatic retry budget", async () => {
  const restoreConsoleError = silenceExpectedTransientDiscoveryError(1);
  const contentPulls: boolean[] = [];
  let attempts = 0;
  const reported: unknown[] = [];

  try {
    const host = createReconciliationTestHost({
      discoverContainerDocuments: perContainerDiscovery(async () => {
        attempts += 1;
        // Two busy refusals, then one real error, then success. If busy
        // refusals spent the once-per-force automatic retry budget, attempt 3
        // or 4 would never run.
        if (attempts <= 2) throw busyRefusal();
        if (attempts === 3) throw new Error("transient discovery failure");
        return [];
      }),
      listKnownContainerIds: () => ["c-1"],
      logError: (_message, error) => reported.push(error),
      requestDocumentContentPull: (_containerId, _documents, force) => {
        contentPulls.push(force);
      },
    });
    const service = createReconciliationService(host);
    service.start();
    forceKnownContainers(service, host);

    await waitFor(
      () => contentPulls.length === 1,
      "Expected forced container to recover after busy refusals and one real failure",
      6_000,
    );
    expect(attempts).toBe(4);
    expect(contentPulls).toEqual([true]);
    // Only the real error reached diagnostics; busy refusals stayed silent.
    expect(reported).toHaveLength(1);
  } finally {
    restoreConsoleError();
  }
});

test("a sweep container refused as busy is re-queued without spending its retry budget", async () => {
  const contentPulls: boolean[] = [];
  let attempts = 0;

  const host = createReconciliationTestHost({
    discoverContainerDocuments: perContainerDiscovery(async () => {
      attempts += 1;
      if (attempts <= 2) throw busyRefusal();
      return [];
    }),
    listKnownContainerIds: () => ["c-1"],
    requestDocumentContentPull: (_containerId, _documents, force) => {
      contentPulls.push(force);
    },
  });
  const service = createReconciliationService(host);
  service.start();

  await expect(service.reconcileNow()).rejects.toThrow("Failed query");
  await waitFor(
    () => contentPulls.length === 1,
    "Expected sweep container to recover after repeated busy refusals",
    4_000,
  );
  expect(attempts).toBe(3);
  expect(contentPulls).toEqual([true]);
});

test("a busy refusal in an earlier sweep batch does not mask a real error in a later batch", async () => {
  const containerIds = Array.from(
    { length: MAX_CONTAINER_DOCUMENT_LANES + 1 },
    (_unused, index) => `c-${index + 1}`,
  );
  const firstId = containerIds[0];
  const lastId = containerIds[containerIds.length - 1];
  const host = createReconciliationTestHost({
    discoverContainerDocuments: perContainerDiscovery(async (containerId) => {
      if (containerId === firstId) throw busyRefusal();
      if (containerId === lastId) throw new Error("later batch real failure");
      return [];
    }),
    listKnownContainerIds: () => containerIds,
  });
  const service = createReconciliationService(host);
  service.start();

  try {
    await expect(service.reconcileNow()).rejects.toThrow(
      "later batch real failure",
    );
  } finally {
    service.stop();
  }
});

test("an unforced container hitting busy SQLite refusals re-queues and reconciles", async () => {
  const contentPulls: boolean[] = [];
  const reported: unknown[] = [];
  let attempts = 0;

  const host = createReconciliationTestHost({
    discoverContainerDocuments: perContainerDiscovery(async () => {
      attempts += 1;
      if (attempts <= 2) throw busyRefusal();
      return [];
    }),
    listKnownContainerIds: () => ["c-unforced"],
    logError: (_message, error) => reported.push(error),
    requestDocumentContentPull: (_containerId, _documents, force) => {
      contentPulls.push(force);
    },
  });
  const service = createReconciliationService(host);
  service.start();
  service.setActiveContainer("c-unforced");

  await waitFor(
    () => contentPulls.length === 1,
    "Expected unforced container to recover after repeated busy refusals",
    4_000,
  );
  expect(attempts).toBe(3);
  expect(contentPulls).toEqual([false]);
  expect(reported).toEqual([]);
});
