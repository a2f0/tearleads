import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/waitFor";
import type { LocalProjectionReconciledDelta } from "../../stores/local-projection";
import { createReconciliationService } from "./service";
import {
  createGate,
  createReconciliationTestHost,
  silenceExpectedTransientDiscoveryError,
} from "./service.testFixtures";
import type {
  ReconciliationHost,
  ReconciliationRuntimeStatus,
} from "./serviceTypes";

function createHost(
  overrides: Partial<ReconciliationHost> & {
    status?: ReconciliationRuntimeStatus;
    discovered?: string[];
    knownContainerIds?: ReadonlyArray<string>;
    automaticRootCatchupContainerIds?: ReadonlyArray<string>;
  } = {},
): ReconciliationHost {
  const discovered = overrides.discovered ?? [];
  const status = overrides.status ?? {
    dbStatus: "ready",
    isAuthenticated: true,
    online: true,
  };

  return createReconciliationTestHost({
    getRuntimeStatus: () => status,
    listKnownContainerIds: () => overrides.knownContainerIds ?? [],
    listAutomaticRootCatchupContainerIds: () =>
      overrides.automaticRootCatchupContainerIds ??
      overrides.knownContainerIds ??
      [],
    discoverContainerDocuments: async (containerId) => {
      discovered.push(containerId);
    },
    ...overrides,
  });
}

/** One reconciled delta carrying a single document summary. */
function deltaWithOneSummary(
  containerId: string,
): LocalProjectionReconciledDelta {
  return {
    containerId,
    documentSummaries: [
      {
        id: "d-1",
        containerId,
        documentId: "d-1",
        title: "doc",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

test("service reconciles the active container before idle backfill", async () => {
  const discovered: string[] = [];
  const host = createHost({
    discovered,
    knownContainerIds: ["active", "sibling-a", "sibling-b"],
  });
  const service = createReconciliationService(host);
  service.start();

  // The active container reconciles first and on its own — siblings are not
  // eagerly swept on navigation.
  service.setActiveContainer("active");
  await waitFor(
    () => discovered.length === 1,
    `Expected only the active container reconciled, saw ${discovered.join(",")}`,
  );
  expect(discovered).toEqual(["active"]);

  // An explicit idle backfill reconciles the remaining known containers.
  service.enqueueIdleBackfill();
  await waitFor(
    () => discovered.length === 3,
    `Expected all containers reconciled, saw ${discovered.join(",")}`,
  );
  expect(discovered.slice(1).sort()).toEqual(["sibling-a", "sibling-b"]);
});

test("service does not reconcile while offline", async () => {
  const discovered: string[] = [];
  const host = createHost({
    discovered,
    knownContainerIds: ["c-1"],
    status: { dbStatus: "ready", isAuthenticated: true, online: false },
  });
  const service = createReconciliationService(host);
  service.start();
  service.setActiveContainer("c-1");

  await flushMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(discovered).toEqual([]);
});

test("service does not reconcile while unauthenticated", async () => {
  const discovered: string[] = [];
  const host = createHost({
    discovered,
    knownContainerIds: ["c-1"],
    status: { dbStatus: "ready", isAuthenticated: false, online: true },
  });
  const service = createReconciliationService(host);
  service.start();
  service.enqueueContainer("c-1", "active");

  await flushMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(discovered).toEqual([]);
});

test("service applies the reconciled delta for each container", async () => {
  const applied: string[] = [];
  const host = createHost({
    knownContainerIds: ["c-1"],
    applyReconciled: (delta) => {
      applied.push(delta.containerId);
    },
  });
  const service = createReconciliationService(host);
  service.start();
  service.enqueueContainer("c-1", "active");

  await waitFor(
    () => applied.includes("c-1"),
    "Expected reconciled delta to be applied",
  );
});

test("service retries a container after a failed reconciliation", async () => {
  const restoreConsoleError = silenceExpectedTransientDiscoveryError();
  const attempts: string[] = [];
  let failNext = true;

  try {
    const host = createHost({
      knownContainerIds: ["c-1"],
      discoverContainerDocuments: async (containerId) => {
        attempts.push(containerId);
        if (failNext) {
          failNext = false;
          throw new Error("transient discovery failure");
        }
      },
    });
    const service = createReconciliationService(host);
    service.start();

    // First attempt fails; the container must not be permanently marked
    // discovered, so a fresh enqueue retries it.
    service.enqueueContainer("c-1", "active");
    await waitFor(
      () => attempts.length === 1,
      "Expected the first (failing) attempt",
    );

    service.enqueueContainer("c-1", "active");
    await waitFor(
      () => attempts.length === 2,
      "Expected a retry after the failed reconciliation",
    );
  } finally {
    restoreConsoleError();
  }
});

test("service force-reconciles a discovered container", async () => {
  const attempts: string[] = [];
  const contentPulls: boolean[] = [];
  const host = createHost({
    knownContainerIds: ["c-1"],
    discoverContainerDocuments: async (containerId) => {
      attempts.push(containerId);
    },
    requestDocumentContentPull: (_containerId, _documents, force) => {
      contentPulls.push(force);
    },
  });
  const service = createReconciliationService(host);
  service.start();

  service.enqueueContainer("c-1", "active");
  await waitFor(
    () => attempts.length === 1,
    "Expected the initial reconciliation",
  );

  service.enqueueContainer("c-1", "active", true);
  await waitFor(
    () => attempts.length === 2,
    "Expected forced reconciliation to refetch a discovered container",
  );
  expect(contentPulls).toEqual([false, true]);
});

test("forced idle backfill retries every settled container", async () => {
  const attempts: string[] = [];
  const contentPulls: boolean[] = [];
  const host = createHost({
    knownContainerIds: ["c-1", "c-2"],
    discoverContainerDocuments: async (containerId) => {
      attempts.push(containerId);
    },
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

test("service retries a container that failed during explicit refresh", async () => {
  const attempts: string[] = [];
  let failNext = true;
  const host = createHost({
    knownContainerIds: ["c-1"],
    discoverContainerDocuments: async (containerId) => {
      attempts.push(containerId);
      if (failNext) {
        failNext = false;
        throw new Error("transient refresh failure");
      }
    },
  });
  const service = createReconciliationService(host);
  service.start();

  await expect(service.reconcileNow()).rejects.toThrow(
    "transient refresh failure",
  );
  expect(attempts).toEqual(["c-1"]);

  service.enqueueContainer("c-1", "active");
  await waitFor(
    () => attempts.length === 2,
    "Expected passive retry after the refresh failure",
  );
});

test("root refresh retains a directly granted non-root container in catch-up", async () => {
  const calls: string[] = [];
  const host = createHost({
    knownContainerIds: ["root", "directly-granted-child", "own-system"],
    automaticRootCatchupContainerIds: ["root", "directly-granted-child"],
    discoverContainerDocuments: async (containerId) => {
      calls.push(`discover:${containerId}`);
    },
    refreshRootTree: async () => {
      calls.push("refresh-root");
    },
    refreshTree: async () => {
      calls.push("refresh-full");
    },
  });
  const service = createReconciliationService(host);
  service.start();

  await service.reconcileRootContainersNow();

  expect(calls).toEqual([
    "refresh-root",
    "discover:root",
    "discover:directly-granted-child",
  ]);
});

test("explicit full refresh retries an active container outside the background set", async () => {
  const discovered: string[] = [];
  const host = createHost({
    discovered,
    knownContainerIds: ["known-regular"],
  });
  const service = createReconciliationService(host);
  service.start();
  service.setActiveContainer("foreign-write-system");
  await waitFor(
    () => discovered.includes("foreign-write-system"),
    "Expected the active container's initial reconciliation",
  );
  discovered.length = 0;

  await service.reconcileNow();

  expect(discovered).toEqual(["known-regular", "foreign-write-system"]);
});

test("a full refresh during an in-flight root refresh still runs the full tree refresh", async () => {
  const calls: string[] = [];
  const rootStarted = createGate();
  const rootBlocked = createGate();
  const host = createHost({
    knownContainerIds: ["c-1"],
    discoverContainerDocuments: async (containerId) => {
      calls.push(`discover:${containerId}`);
    },
    refreshRootTree: async () => {
      calls.push("refresh-root");
      rootStarted.open();
      await rootBlocked.wait;
    },
    refreshTree: async () => {
      calls.push("refresh-full");
    },
  });
  const service = createReconciliationService(host);
  service.start();

  // Start a root-only sweep that blocks inside refreshRootTree, then ask for a
  // full refresh while it is in flight. The full refresh must NOT coalesce into
  // the root sweep (that would skip the full tree); it chains after it.
  const rootDone = service.reconcileRootContainersNow();
  await rootStarted.wait;
  const fullDone = service.reconcileNow();
  rootBlocked.open();
  await Promise.all([rootDone, fullDone]);

  expect(calls).toEqual([
    "refresh-root",
    "discover:c-1",
    "refresh-full",
    "discover:c-1",
  ]);
});

test("a root refresh during an in-flight root refresh coalesces into it", async () => {
  const calls: string[] = [];
  const rootStarted = createGate();
  const rootBlocked = createGate();
  const host = createHost({
    knownContainerIds: ["c-1"],
    discoverContainerDocuments: async (containerId) => {
      calls.push(`discover:${containerId}`);
    },
    refreshRootTree: async () => {
      calls.push("refresh-root");
      rootStarted.open();
      await rootBlocked.wait;
    },
  });
  const service = createReconciliationService(host);
  service.start();

  const first = service.reconcileRootContainersNow();
  await rootStarted.wait;
  const second = service.reconcileRootContainersNow();
  rootBlocked.open();
  await Promise.all([first, second]);

  // Only one root sweep ran; the second call joined the in-flight one.
  expect(calls).toEqual(["refresh-root", "discover:c-1"]);
});

test("resetDiscovered lets a previously-reconciled container refetch", async () => {
  const attempts: string[] = [];
  const host = createHost({
    knownContainerIds: ["c-1"],
    discoverContainerDocuments: async (containerId) => {
      attempts.push(containerId);
    },
  });
  const service = createReconciliationService(host);
  service.start();

  service.enqueueContainer("c-1", "active");
  await waitFor(() => attempts.length === 1, "Expected the initial reconcile");

  // Without a reset, a passive enqueue of a discovered container is suppressed.
  service.enqueueContainer("c-1", "active");
  await flushMicrotasks();
  expect(attempts.length).toBe(1);

  // After resetting the per-session discovered set (relogin/reconnect), the
  // same container reconciles again exactly once.
  service.resetDiscovered();
  service.enqueueContainer("c-1", "active");
  await waitFor(
    () => attempts.length === 2,
    "Expected a refetch after resetDiscovered",
  );
});

test("stop clears the discovered set so a restarted lane refetches", async () => {
  const attempts: string[] = [];
  const host = createHost({
    knownContainerIds: ["c-1"],
    discoverContainerDocuments: async (containerId) => {
      attempts.push(containerId);
    },
  });
  const service = createReconciliationService(host);
  service.start();

  service.enqueueContainer("c-1", "active");
  await waitFor(() => attempts.length === 1, "Expected the initial reconcile");

  service.stop();
  service.start();
  service.enqueueContainer("c-1", "active");
  await waitFor(
    () => attempts.length === 2,
    "Expected a refetch after stop()/start() cleared the discovered set",
  );
});

test("background reconcile requests a non-forced document content sync", async () => {
  const pulls: Array<{ containerId: string; force: boolean }> = [];
  const host = createHost({
    knownContainerIds: ["c-1"],
    loadContainerDelta: async (containerId) => deltaWithOneSummary(containerId),
    requestDocumentContentPull: (containerId, _documents, force) => {
      pulls.push({ containerId, force });
    },
  });
  const service = createReconciliationService(host);
  service.start();
  service.enqueueContainer("c-1", "active");

  await waitFor(
    () => pulls.length === 1,
    "Expected the background reconcile to request a content sync",
  );
  expect(pulls).toEqual([{ containerId: "c-1", force: false }]);
});

test("explicit refresh requests a forced document content sync", async () => {
  const pulls: Array<{ containerId: string; force: boolean }> = [];
  const host = createHost({
    knownContainerIds: ["c-1"],
    loadContainerDelta: async (containerId) => deltaWithOneSummary(containerId),
    requestDocumentContentPull: (containerId, _documents, force) => {
      pulls.push({ containerId, force });
    },
  });
  const service = createReconciliationService(host);
  service.start();
  await service.reconcileNow();

  expect(pulls).toEqual([{ containerId: "c-1", force: true }]);
});
