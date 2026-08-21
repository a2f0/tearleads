import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/waitFor";
import { waitForDomainSyncCoordinatorToSettle } from "../../data/sync/syncCoordinator";
import { createReconciliationService } from "./service";
import {
  createGate,
  createReconciliationTestHost,
  silenceExpectedTransientDiscoveryError,
} from "./service.testFixtures";

test("forced idle backfill retries every settled container", async () => {
  const attempts: string[] = [];
  const contentPulls: boolean[] = [];
  const host = createReconciliationTestHost({
    discoverContainerDocuments: async (containerId) => {
      attempts.push(containerId);
      return [];
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
        return [];
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
    await waitFor(
      () => attempts.length === 3,
      "Expected automatic forced retry",
      2_000,
    );

    expect(contentPulls).toEqual([false, true]);
  } finally {
    restoreConsoleError();
  }
});

test("permanent forced failure stops after one automatic retry", async () => {
  const restoreConsoleError = silenceExpectedTransientDiscoveryError(2);
  const contentPulls: boolean[] = [];
  let attempts = 0;
  let shouldFail = true;

  try {
    const host = createReconciliationTestHost({
      discoverContainerDocuments: async () => {
        attempts += 1;
        if (shouldFail) {
          throw new Error("transient discovery failure");
        }
        return [];
      },
      listKnownContainerIds: () => ["c-1"],
      requestDocumentContentPull: (_containerId, _documents, force) => {
        contentPulls.push(force);
      },
    });
    const service = createReconciliationService(host);
    service.start();
    service.enqueueIdleBackfill(true);
    await waitFor(() => attempts === 2, "Expected one automatic retry", 2_000);
    // The attempt counter increments before the rejected promise reaches the
    // coordinator's error callback; let that microtask publish its outcome.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      await waitForDomainSyncCoordinatorToSettle(host.domainScope, {
        timeoutMs: 300,
      }),
    ).toBe(true);
    expect(attempts).toBe(2);

    shouldFail = false;
    service.enqueueIdleBackfill();
    await waitFor(() => contentPulls.length === 1, "Expected signaled retry");
    expect(contentPulls).toEqual([true]);
  } finally {
    restoreConsoleError();
  }
});

test("failure from a prior lifecycle cannot rearm after restart", async () => {
  const restoreConsoleError = silenceExpectedTransientDiscoveryError();
  const started = createGate();
  const finish = createGate();
  let attempts = 0;

  try {
    const host = createReconciliationTestHost({
      discoverContainerDocuments: async () => {
        attempts += 1;
        started.open();
        await finish.wait;
        throw new Error("transient discovery failure");
      },
      listKnownContainerIds: () => ["c-1"],
    });
    const service = createReconciliationService(host);
    service.start();
    service.enqueueIdleBackfill(true);
    await started.wait;

    service.stop();
    service.start();
    finish.open();
    expect(
      await waitForDomainSyncCoordinatorToSettle(host.domainScope, {
        timeoutMs: 300,
      }),
    ).toBe(true);
    expect(attempts).toBe(1);
  } finally {
    restoreConsoleError();
  }
});

test("database loss mid-reconciliation preserves pending force", async () => {
  const contentPulls: boolean[] = [];
  let databaseReady = true;
  let failNext = true;
  const host = createReconciliationTestHost({
    discoverContainerDocuments: async () => {
      if (failNext) {
        failNext = false;
        databaseReady = false;
        throw new Error("database unavailable");
      }
      return [];
    },
    getRuntimeStatus: () => ({
      dbStatus: databaseReady ? "ready" : "unavailable",
      isAuthenticated: true,
      online: true,
    }),
    isIgnorableError: (error) =>
      error instanceof Error && error.message === "database unavailable",
    listKnownContainerIds: () => ["c-1"],
    requestDocumentContentPull: (_containerId, _documents, force) => {
      contentPulls.push(force);
    },
  });
  const service = createReconciliationService(host);
  service.start();
  service.enqueueIdleBackfill(true);
  await waitFor(() => !databaseReady, "Expected database loss");

  databaseReady = true;
  service.enqueueIdleBackfill();
  await waitFor(() => contentPulls.length === 1, "Expected forced retry");

  expect(contentPulls).toEqual([true]);
});

test("a null production discovery result preserves pending force", async () => {
  const contentPulls: boolean[] = [];
  let attempts = 0;
  let discoveryResult: ReadonlyArray<never> | null = null;
  const host = createReconciliationTestHost({
    discoverContainerDocuments: async () => {
      attempts += 1;
      return discoveryResult;
    },
    listKnownContainerIds: () => ["c-1"],
    requestDocumentContentPull: (_containerId, _documents, force) => {
      contentPulls.push(force);
    },
  });
  const service = createReconciliationService(host);
  service.start();
  service.enqueueIdleBackfill(true);
  await waitFor(() => attempts === 1, "Expected unavailable discovery");
  expect(contentPulls).toEqual([]);

  discoveryResult = [];
  service.enqueueIdleBackfill();
  await waitFor(() => contentPulls.length === 1, "Expected forced retry");

  expect(contentPulls).toEqual([true]);
});

test("unscoped invalidation force-reconciles containers hydrated later", async () => {
  const attempts: Array<{ containerId: string; force: boolean }> = [];
  const knownContainerIds = ["c-1"];
  const host = createReconciliationTestHost({
    discoverContainerDocuments: async () => [],
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

test("a newer force survives an older in-flight reconciliation", async () => {
  const firstStarted = createGate();
  const finishFirst = createGate();
  const contentPulls: boolean[] = [];
  let attemptCount = 0;
  const host = createReconciliationTestHost({
    discoverContainerDocuments: async () => {
      attemptCount += 1;
      if (attemptCount === 1) {
        firstStarted.open();
        await finishFirst.wait;
      }
      return [];
    },
    requestDocumentContentPull: (_containerId, _documents, force) => {
      contentPulls.push(force);
    },
  });
  const service = createReconciliationService(host);
  service.start();

  service.enqueueContainer("c-1", "active", true);
  await firstStarted.wait;
  service.enqueueContainer("c-1", "active", true);
  finishFirst.open();
  await waitFor(() => attemptCount === 2, "Expected the newer force to run");

  expect(contentPulls).toEqual([true, true]);
});

test("an old lane completion cannot consume a post-refresh force", async () => {
  const firstStarted = createGate();
  const finishFirst = createGate();
  const contentPulls: boolean[] = [];
  let attemptCount = 0;
  const host = createReconciliationTestHost({
    discoverContainerDocuments: async () => {
      attemptCount += 1;
      if (attemptCount === 1) {
        firstStarted.open();
        await finishFirst.wait;
      }
      return [];
    },
    listKnownContainerIds: () => ["c-1"],
    requestDocumentContentPull: (_containerId, _documents, force) => {
      contentPulls.push(force);
    },
  });
  const service = createReconciliationService(host);
  service.start();

  service.enqueueContainer("c-1", "active", true);
  await firstStarted.wait;
  await service.reconcileNow();
  service.enqueueContainer("c-1", "active", true);
  finishFirst.open();
  await waitFor(
    () => attemptCount === 3,
    "Expected the post-refresh force to run",
  );

  expect(contentPulls).toEqual([true, true, true]);
});

test("a failed full refresh preserves pending forced reconciliation", async () => {
  const contentPulls: boolean[] = [];
  let online = false;
  const host = createReconciliationTestHost({
    getRuntimeStatus: () => ({
      dbStatus: "ready",
      isAuthenticated: true,
      online,
    }),
    listKnownContainerIds: () => ["c-1"],
    refreshTree: async () => {
      throw new Error("refresh failed");
    },
    requestDocumentContentPull: (_containerId, _documents, force) => {
      contentPulls.push(force);
    },
  });
  const service = createReconciliationService(host);
  service.start();
  service.enqueueIdleBackfill(true);

  online = true;
  await expect(service.reconcileNow()).rejects.toThrow("refresh failed");
  service.enqueueIdleBackfill();
  await waitFor(() => contentPulls.length === 1, "Expected forced retry");

  expect(contentPulls).toEqual([true]);
});

test("full refresh failure automatically retries a pending force", async () => {
  const contentPulls: boolean[] = [];
  let attempts = 0;
  let failNext = true;
  let online = false;
  const host = createReconciliationTestHost({
    discoverContainerDocuments: async () => {
      attempts += 1;
      if (failNext) {
        failNext = false;
        throw new Error("transient refresh failure");
      }
      return [];
    },
    getRuntimeStatus: () => ({
      dbStatus: "ready",
      isAuthenticated: true,
      online,
    }),
    listKnownContainerIds: () => ["c-1"],
    requestDocumentContentPull: (_containerId, _documents, force) => {
      contentPulls.push(force);
    },
  });
  const service = createReconciliationService(host);
  service.start();
  service.enqueueIdleBackfill(true);
  online = true;

  await expect(service.reconcileNow()).rejects.toThrow(
    "transient refresh failure",
  );
  await waitFor(() => attempts === 2, "Expected automatic forced retry");

  expect(contentPulls).toEqual([true]);
});
