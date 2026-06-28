import { expect, test } from "bun:test";
import type { DomainScope } from "../../data/domainScope";
import type { LocalProjectionReconciledDelta } from "../../stores/local-projection";
import { createReconcileQueue } from "./queue";
import {
  createReconciliationService,
  type ReconciliationHost,
  type ReconciliationRuntimeStatus,
} from "./service";

function createHost(
  overrides: Partial<ReconciliationHost> & {
    status?: ReconciliationRuntimeStatus;
    discovered?: string[];
    knownContainerIds?: ReadonlyArray<string>;
  } = {},
): ReconciliationHost {
  const discovered = overrides.discovered ?? [];
  const status = overrides.status ?? {
    dbStatus: "ready",
    isAuthenticated: true,
    online: true,
  };

  return {
    domainScope: {} as DomainScope,
    getRuntimeStatus: () => status,
    listKnownContainerIds: () => overrides.knownContainerIds ?? [],
    discoverContainerDocuments: async (containerId) => {
      discovered.push(containerId);
    },
    loadContainerDelta: async (
      containerId,
    ): Promise<LocalProjectionReconciledDelta> => ({
      containerId,
      documentSummaries: [],
    }),
    applyReconciled: () => {},
    refreshTree: async () => {},
    refreshRootTree: async () => {},
    isIgnorableError: () => false,
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
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

function silenceExpectedTransientDiscoveryError(): () => void {
  const originalConsoleError = console.error;
  let expectedErrorCount = 0;

  console.error = (...args: unknown[]) => {
    const isExpectedDiscoveryFailure =
      args[0] === "Device-first reconciliation failed:" &&
      args.some(
        (arg) =>
          arg instanceof Error && arg.message === "transient discovery failure",
      );
    if (isExpectedDiscoveryFailure) {
      expectedErrorCount += 1;
      return;
    }

    originalConsoleError(...args);
  };

  return () => {
    console.error = originalConsoleError;
    expect(expectedErrorCount).toBe(1);
  };
}

test("reconcile queue serves active priority before idle", () => {
  const queue = createReconcileQueue();
  queue.enqueue("idle-1", "idle");
  queue.enqueue("active-1", "active");
  queue.enqueue("idle-2", "idle");

  expect(queue.dequeue()).toBe("active-1");
  expect(queue.dequeue()).toBe("idle-1");
  expect(queue.dequeue()).toBe("idle-2");
  expect(queue.dequeue()).toBeNull();
});

test("reconcile queue upgrades an idle container to active without duplicating", () => {
  const queue = createReconcileQueue();
  queue.enqueue("c-1", "idle");
  queue.enqueue("c-2", "idle");
  queue.enqueue("c-1", "active");

  expect(queue.size).toBe(2);
  expect(queue.dequeue()).toBe("c-1");
  expect(queue.dequeue()).toBe("c-2");
});

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
  const host = createHost({
    knownContainerIds: ["c-1"],
    discoverContainerDocuments: async (containerId) => {
      attempts.push(containerId);
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

test("root refresh reconciles known containers without a full tree refresh", async () => {
  const calls: string[] = [];
  const host = createHost({
    knownContainerIds: ["c-1"],
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

  expect(calls).toEqual(["refresh-root", "discover:c-1"]);
});

/** A promise plus its resolver, for gating a mock host call open by hand. */
function createGate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, wait };
}

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
