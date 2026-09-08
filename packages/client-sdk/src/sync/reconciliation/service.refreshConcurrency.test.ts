import { expect, test } from "bun:test";
import { createReconciliationService } from "./service";
import {
  createGate,
  createReconciliationTestHost,
} from "./service.testFixtures";

test("requests share a queued full refresh even when the root refresh fails", async () => {
  const calls: string[] = [];
  const rootStarted = createGate();
  const finishRoot = createGate();
  const fullStarted = createGate();
  const finishFull = createGate();
  const rootError = new Error("root refresh failed");
  const service = createReconciliationService(
    createReconciliationTestHost({
      listKnownContainerIds: () => ["child"],
      refreshRootTree: async () => {
        calls.push("root");
        rootStarted.open();
        await finishRoot.wait;
        throw rootError;
      },
      refreshTree: async () => {
        calls.push("full");
        fullStarted.open();
        await finishFull.wait;
      },
      discoverContainerDocuments: async (containerId) => {
        calls.push(`discover:${containerId}`);
        return [];
      },
    }),
  );

  const root = service.reconcileRootContainersNow();
  const rootFailure = root.catch((error: unknown) => error);
  await rootStarted.wait;
  const full = service.reconcileNow();
  expect(service.reconcileNow()).toBe(full);
  expect(service.reconcileRootContainersNow()).toBe(full);
  expect(calls).toEqual(["root"]);

  finishRoot.open();
  await expect(rootFailure).resolves.toBe(rootError);
  await fullStarted.wait;
  expect(service.reconcileNow()).toBe(full);
  expect(service.reconcileRootContainersNow()).toBe(full);
  expect(calls).toEqual(["root", "full"]);

  finishFull.open();
  await full;
  expect(calls).toEqual(["root", "full", "discover:child"]);

  await service.reconcileNow();
  expect(calls).toEqual([
    "root",
    "full",
    "discover:child",
    "full",
    "discover:child",
  ]);
});

test("a failed full refresh can be retried", async () => {
  const failure = new Error("full refresh failed");
  let attempts = 0;
  const service = createReconciliationService(
    createReconciliationTestHost({
      refreshTree: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw failure;
        }
      },
    }),
  );

  const first = service.reconcileNow();
  expect(service.reconcileRootContainersNow()).toBe(first);
  await expect(first).rejects.toBe(failure);
  await service.reconcileNow();
  expect(attempts).toBe(2);
});

test("an old refresh cannot clear the pending refresh after restart", async () => {
  const oldStarted = createGate();
  const finishOld = createGate();
  const currentStarted = createGate();
  const finishCurrent = createGate();
  const discovered: string[] = [];
  let refreshes = 0;
  const service = createReconciliationService(
    createReconciliationTestHost({
      listKnownContainerIds: () => ["current-container"],
      refreshTree: async () => {
        refreshes += 1;
        if (refreshes === 1) {
          oldStarted.open();
          await finishOld.wait;
        } else {
          currentStarted.open();
          await finishCurrent.wait;
        }
      },
      discoverContainerDocuments: async (containerId) => {
        discovered.push(containerId);
        return [];
      },
    }),
  );

  service.start();
  try {
    const old = service.reconcileNow();
    await oldStarted.wait;
    service.stop();
    service.start();
    const current = service.reconcileNow();
    await currentStarted.wait;

    finishOld.open();
    await old;
    expect(discovered).toEqual([]);
    expect(service.reconcileNow()).toBe(current);
    expect(service.reconcileRootContainersNow()).toBe(current);

    finishCurrent.open();
    await current;
    expect(refreshes).toBe(2);
    expect(discovered).toEqual(["current-container"]);
  } finally {
    finishOld.open();
    finishCurrent.open();
    service.stop();
  }
});
