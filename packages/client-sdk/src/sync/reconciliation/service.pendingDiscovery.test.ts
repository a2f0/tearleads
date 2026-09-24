import { expect, test } from "bun:test";
import { createInitialDocumentProbe } from "./initialDocumentProbe";
import { reconcileMarkedContainer } from "./knownContainerSweep";
import { createReconcileQueue } from "./queue";
import { createReconciliationService } from "./service";
import {
  createGate,
  createReconciliationTestHost,
} from "./service.testFixtures";

for (const stop of [false, true]) {
  test(`partial discovery publishes its delta and schedules a scoped retry (stop=${stop})`, async () => {
    let calls = 0;
    let applied = 0;
    const firstApply = createGate();
    const secondApply = createGate();
    const service = createReconciliationService(
      createReconciliationTestHost({
        discoverContainerDocuments: async (_id, _onFull, onPending) => {
          calls++;
          if (calls === 1) onPending?.(50);
          return [];
        },
        applyReconciled: () => {
          applied++;
          firstApply.open();
          if (applied === 2) secondApply.open();
        },
      }),
    );
    try {
      service.start();
      service.enqueueContainer("pending", "active", true);
      await firstApply.wait;
      expect(applied).toBe(1);
      if (stop) service.stop();
      if (stop) await new Promise((resolve) => setTimeout(resolve, 100));
      else await secondApply.wait;
      expect(calls).toBe(stop ? 1 : 2);
      expect(applied).toBe(stop ? 1 : 2);
    } finally {
      service.stop();
    }
  });
}

test("a pending discovery for the open container retries ahead of idle work", async () => {
  const scheduled = createGate();
  const host = createReconciliationTestHost({
    discoverContainerDocuments: async (_id, _onFull, onPending) => {
      onPending?.(0);
      return [];
    },
  });
  const queue = createReconcileQueue();
  queue.enqueue("background", "idle");
  const state = {
    active: true,
    activeContainerId: "open",
    automaticRetryGenerations: new Map<string, number>(),
    discoveredContainerIds: new Set<string>(),
    forcedContainerGenerations: new Map<string, number>(),
    initialDocumentProbe: createInitialDocumentProbe(host),
    nextForceGeneration: 0,
    queue,
    lifecycleGeneration: 0,
    lane: { requestSync: scheduled.open, requestSyncAfter: () => {} },
  };
  await reconcileMarkedContainer(host, state, "open", false);
  await scheduled.wait;
  expect(queue.dequeue()).toBe("open");
  expect(queue.dequeue()).toBe("background");
});
