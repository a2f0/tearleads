import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/waitFor";
import { createReconciliationService } from "./service";
import {
  createGate,
  createReconciliationTestHost,
} from "./service.testFixtures";
import type { ReconciliationHost } from "./serviceTypes";

interface RootRefreshHarness {
  readonly calls: string[];
  readonly host: ReconciliationHost;
  readonly pulls: Array<{ containerId: string; force: boolean }>;
}

function createRootRefreshHarness(input: {
  automaticContainerIds: () => ReadonlyArray<string>;
  canDiscoverContainerDocuments?: (containerId: string) => boolean;
  onRefreshRoot?: () => Promise<void> | void;
}): RootRefreshHarness {
  const calls: string[] = [];
  const pulls: Array<{ containerId: string; force: boolean }> = [];
  return {
    calls,
    pulls,
    host: createReconciliationTestHost({
      canDiscoverContainerDocuments:
        input.canDiscoverContainerDocuments ?? (() => true),
      discoverContainerDocuments: async (containerId) => {
        calls.push(`discover:${containerId}`);
        return [];
      },
      listAutomaticRootCatchupContainerIds: input.automaticContainerIds,
      listKnownContainerIds: input.automaticContainerIds,
      refreshRootTree: async () => {
        calls.push("refresh-root");
        await input.onRefreshRoot?.();
      },
      requestDocumentContentPull: (containerId, _documents, force) => {
        pulls.push({ containerId, force });
      },
    }),
  };
}

test("automatic root refresh skips settled containers but retains targeted force", async () => {
  const harness = createRootRefreshHarness({
    automaticContainerIds: () => ["root", "directly-granted-child"],
  });
  const service = createReconciliationService(harness.host);
  service.enqueueContainer("directly-granted-child", "active", true);

  await service.reconcileRootContainersNow();
  await service.reconcileRootContainersNow();

  expect(harness.calls).toEqual([
    "refresh-root",
    "discover:root",
    "discover:directly-granted-child",
    "refresh-root",
  ]);
  expect(harness.pulls).toEqual([
    { containerId: "root", force: false },
    { containerId: "directly-granted-child", force: true },
  ]);
});

test("automatic root refresh reconciles a newly surfaced container once", async () => {
  let containerIds: ReadonlyArray<string> = ["existing"];
  let refreshCount = 0;
  const harness = createRootRefreshHarness({
    automaticContainerIds: () => containerIds,
    onRefreshRoot: () => {
      refreshCount += 1;
      if (refreshCount === 2) {
        containerIds = ["existing", "new-share"];
      }
    },
  });
  const service = createReconciliationService(harness.host);

  await service.reconcileRootContainersNow();
  await service.reconcileRootContainersNow();
  await service.reconcileRootContainersNow();

  expect(harness.calls).toEqual([
    "refresh-root",
    "discover:existing",
    "refresh-root",
    "discover:new-share",
    "refresh-root",
  ]);
});

test("repeated root hints do not fan out across a settled container tree", async () => {
  const containerIds = Array.from(
    { length: 128 },
    (_, index) => `container-${index}`,
  );
  const harness = createRootRefreshHarness({
    automaticContainerIds: () => containerIds,
  });
  const service = createReconciliationService(harness.host);

  await service.reconcileRootContainersNow();
  harness.calls.length = 0;
  harness.pulls.length = 0;
  await service.reconcileRootContainersNow();

  expect(harness.calls).toEqual(["refresh-root"]);
  expect(harness.pulls).toEqual([]);
});

test("a targeted force arriving during root hydration is retained", async () => {
  const rootStarted = createGate();
  const finishRoot = createGate();
  const harness = createRootRefreshHarness({
    automaticContainerIds: () => ["root"],
    onRefreshRoot: async () => {
      rootStarted.open();
      await finishRoot.wait;
    },
  });
  const service = createReconciliationService(harness.host);

  const rootRefresh = service.reconcileRootContainersNow();
  await rootStarted.wait;
  service.enqueueContainer("root", "active", true);
  finishRoot.open();
  await rootRefresh;

  expect(harness.calls).toEqual(["refresh-root", "discover:root"]);
  expect(harness.pulls).toEqual([{ containerId: "root", force: true }]);
});

test("a revoked then re-shared container is reconciled again", async () => {
  let containerIds: ReadonlyArray<string> = ["shared-root"];
  let reshareOnRefresh = false;
  const harness = createRootRefreshHarness({
    automaticContainerIds: () => containerIds,
    canDiscoverContainerDocuments: (containerId) =>
      containerIds.includes(containerId),
    onRefreshRoot: () => {
      if (reshareOnRefresh) {
        containerIds = ["shared-root"];
      }
    },
  });
  const service = createReconciliationService(harness.host);
  service.start();

  await service.reconcileRootContainersNow();
  // Model the event race where the targeted document lane wins before root
  // hydration applies the revocation. The force is consumed successfully while
  // the old tree still exposes the container.
  service.enqueueContainer("shared-root", "active", true);
  await waitFor(
    () =>
      harness.calls.filter((call) => call === "discover:shared-root").length ===
      2,
    "expected the pre-revocation forced reconciliation",
  );

  // resyncContainerAccess applies its structural tombstone outside this
  // reconciliation service. The next shared_with_you root refresh can then
  // re-add the same id in its hydration callback; pruning only after hydration
  // would miss the revoked interval and suppress rediscovery.
  containerIds = [];
  reshareOnRefresh = true;
  await service.reconcileRootContainersNow();

  expect(
    harness.calls.filter((call) => call === "discover:shared-root"),
  ).toHaveLength(3);
  service.stop();
});

test("resetting discovery makes reconnect root catch-up exhaustive again", async () => {
  const harness = createRootRefreshHarness({
    automaticContainerIds: () => ["root", "child"],
  });
  const service = createReconciliationService(harness.host);

  await service.reconcileRootContainersNow();
  service.resetDiscovered();
  await service.reconcileRootContainersNow();

  expect(harness.calls.filter((call) => call.startsWith("discover:"))).toEqual([
    "discover:root",
    "discover:child",
    "discover:root",
    "discover:child",
  ]);
});
