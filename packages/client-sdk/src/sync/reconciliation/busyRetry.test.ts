import { expect, test } from "bun:test";
import { DATABASE_TRANSACTION_BUSY_MESSAGE } from "@tearleads/sqlite-worker/types";
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
