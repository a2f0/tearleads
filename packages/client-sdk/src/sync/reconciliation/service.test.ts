import { expect, test } from "bun:test";
import type { DomainScope } from "../../data/domainScope";
import type { LocalProjectionReconciledDelta } from "../../stores/local-projection";
import { createReconcileQueue } from "./queue";
import {
  createReconciliationService,
  type ReconciliationHost,
  type ReconciliationRuntimeStatus,
} from "./service";
import { enqueueReconciliationForEvents } from "./triggers";

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
  const attempts: string[] = [];
  let failNext = true;
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
});

test("event triggers enqueue the named container at active priority", () => {
  const enqueued: Array<{ containerId: string; priority: string }> = [];
  const service = {
    enqueueContainer: (containerId: string, priority: string) => {
      enqueued.push({ containerId, priority });
    },
    enqueueIdleBackfill: () => {
      enqueued.push({ containerId: "*", priority: "idle" });
    },
  } as unknown as Parameters<
    typeof enqueueReconciliationForEvents
  >[0]["service"];

  enqueueReconciliationForEvents({
    events: [
      {
        type: "document_update_created",
        documentId: "d-1",
        containerIds: ["c-1"],
      },
      {
        type: "document_update_created",
        documentId: "d-2",
        containerIds: ["unknown"],
      },
    ],
    knownContainerIds: ["c-1", "c-2"],
    service,
  });

  expect(enqueued).toEqual([{ containerId: "c-1", priority: "active" }]);
});

test("event triggers backfill when an update has no container scope", () => {
  let idleBackfills = 0;
  const service = {
    enqueueContainer: () => {},
    enqueueIdleBackfill: () => {
      idleBackfills += 1;
    },
  } as unknown as Parameters<
    typeof enqueueReconciliationForEvents
  >[0]["service"];

  enqueueReconciliationForEvents({
    events: [{ type: "document_update_created", documentId: "d-1" }],
    knownContainerIds: ["c-1"],
    service,
  });

  expect(idleBackfills).toBe(1);
});
