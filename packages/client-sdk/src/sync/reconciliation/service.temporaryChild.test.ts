import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/waitFor";
import {
  isDatabaseUnavailableError,
  waitForDomainSyncCoordinatorToSettle,
} from "../../data/sync/syncCoordinator";
import { createReconciliationService } from "./service";
import { createReconciliationTestHost } from "./service.testFixtures";

test("a temporarily unavailable child retains force and later converges without re-reading its settled sibling", async () => {
  const unavailable = Object.assign(new Error("temporarily unavailable"), {
    status: 404,
  });
  let childVisible = false;
  let online = false;
  const discoveries: string[] = [];
  const pulls: Array<{ containerId: string; force: boolean }> = [];
  const host = createReconciliationTestHost({
    listKnownContainerIds: () => ["child", "sibling"],
    listAutomaticRootCatchupContainerIds: () => ["child", "sibling"],
    getRuntimeStatus: () => ({
      dbStatus: "ready",
      isAuthenticated: true,
      online,
    }),
    isIgnorableError: isDatabaseUnavailableError,
    discoverContainerDocuments: async (containerId) => {
      discoveries.push(containerId);
      if (containerId === "child" && !childVisible) throw unavailable;
      return [];
    },
    requestDocumentContentPull: (containerId, _summaries, force) => {
      pulls.push({ containerId, force });
    },
  });
  const service = createReconciliationService(host);
  service.start();
  try {
    service.enqueueContainer("child", "active", true);
    online = true;
    await expect(service.reconcileRootContainersNow()).rejects.toBe(
      unavailable,
    );
    expect(discoveries).toEqual(["child", "sibling"]);
    expect(pulls).toEqual([{ containerId: "sibling", force: false }]);

    childVisible = true;
    await waitFor(
      () => pulls.length === 2,
      "Expected automatic child retry",
      2_000,
    );
    expect(
      await waitForDomainSyncCoordinatorToSettle(host.domainScope, {
        timeoutMs: 300,
      }),
    ).toBe(true);
    await service.reconcileRootContainersNow();
    expect(discoveries).toEqual(["child", "sibling", "child"]);
    expect(pulls).toEqual([
      { containerId: "sibling", force: false },
      { containerId: "child", force: true },
    ]);
  } finally {
    service.stop();
  }
});
