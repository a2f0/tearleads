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

test("ordinary discovery resets only the root-lane watermark", () => {
  const { lanes } = createContainerParentHydrationQueue({
    containerIds: ["known-parent"],
    resetRootLaneWatermark: true,
  });

  expect(lanes).toEqual([
    { parentId: null, watermark: null },
    { parentId: "known-parent" },
  ]);
});
