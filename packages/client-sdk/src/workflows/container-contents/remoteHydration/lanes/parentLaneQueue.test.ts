import { expect, test } from "bun:test";
import { createContainerParentHydrationQueue } from "./parentLaneQueue";

test("restoration crawls reset every parent-lane watermark", () => {
  const { lanes } = createContainerParentHydrationQueue({
    containerIds: ["known-parent"],
    resetAllLaneWatermarks: true,
    resetRootLaneWatermark: true,
  });

  expect(lanes).toEqual([
    { parentId: null, watermark: null },
    { parentId: "known-parent", watermark: null },
  ]);
});

test("ordinary discovery lists the root lane from its watermark and, for membership, from none", () => {
  const { lanes, queueParentLane } = createContainerParentHydrationQueue({
    containerIds: ["known-parent"],
    resetRootLaneWatermark: true,
  });

  expect(lanes).toEqual([
    { parentId: null },
    {
      membershipOnly: true,
      parentId: null,
      skipWatermarkWrite: true,
      watermark: null,
    },
    { parentId: "known-parent" },
  ]);
  // The root lane is queued once, however often it is asked for.
  queueParentLane(null);
  expect(lanes).toHaveLength(3);
});

test("a crawl that keeps the root watermark lists the root lane once", () => {
  const { lanes } = createContainerParentHydrationQueue({
    containerIds: [],
    parentIds: [null, "known-parent"],
  });

  expect(lanes).toEqual([{ parentId: null }, { parentId: "known-parent" }]);
});
