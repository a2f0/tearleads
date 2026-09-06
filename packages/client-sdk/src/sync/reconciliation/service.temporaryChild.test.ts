import { expect, test } from "bun:test";
import { createReconciliationService } from "./service";
import { createReconciliationTestHost } from "./service.testFixtures";

test("a temporarily unavailable child retains force and later converges without re-reading its settled sibling", async () => {
  const unavailable = Object.assign(new Error("temporarily unavailable"), {
    status: 404,
  });
  let childVisible = false;
  const discoveries: string[] = [];
  const pulls: Array<{ containerId: string; force: boolean }> = [];
  const service = createReconciliationService(
    createReconciliationTestHost({
      listKnownContainerIds: () => ["child", "sibling"],
      listAutomaticRootCatchupContainerIds: () => ["child", "sibling"],
      isIgnorableError: (error) => error === unavailable,
      discoverContainerDocuments: async (containerId) => {
        discoveries.push(containerId);
        if (containerId === "child" && !childVisible) throw unavailable;
        return [];
      },
      requestDocumentContentPull: (containerId, _summaries, force) => {
        pulls.push({ containerId, force });
      },
    }),
  );
  service.enqueueContainer("child", "active", true);
  await service.reconcileRootContainersNow();
  expect(discoveries).toEqual(["child", "sibling"]);
  expect(pulls).toEqual([{ containerId: "sibling", force: false }]);

  childVisible = true;
  await service.reconcileRootContainersNow();
  await service.reconcileRootContainersNow();
  expect(discoveries).toEqual(["child", "sibling", "child"]);
  expect(pulls).toEqual([
    { containerId: "sibling", force: false },
    { containerId: "child", force: true },
  ]);
  service.stop();
});
