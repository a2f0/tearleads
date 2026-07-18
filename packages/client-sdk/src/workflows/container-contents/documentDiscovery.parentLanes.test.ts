import { expect, test } from "bun:test";
import { listAllRemoteContainerIds } from "./documentDiscovery";
import { createDiscoveryParentLaneBatchMock } from "./documentDiscovery.testUtils";

test("remote discovery batches parent lanes four at a time", async () => {
  const childContainerIds = Array.from(
    { length: 9 },
    (_, index) => `container-${index}`,
  );
  const parentIds: Array<string | null> = [];
  const batchSizes: number[] = [];

  const containerIds = await listAllRemoteContainerIds(
    createDiscoveryParentLaneBatchMock(
      async ({ parentId }) => {
        parentIds.push(parentId);
        return {
          hasMore: false,
          items:
            parentId === null ? childContainerIds.map((id) => ({ id })) : [],
          nextWatermark: null,
        };
      },
      (lanes) => batchSizes.push(lanes.length),
    ),
  );

  expect(containerIds).toEqual(childContainerIds);
  expect(new Set(parentIds)).toEqual(new Set([null, ...childContainerIds]));
  expect(batchSizes).toEqual([1, 4, 4, 1]);
});

test("remote discovery matches reordered results by lane id", async () => {
  const containerIds = await listAllRemoteContainerIds(async ({ lanes }) => ({
    results: lanes
      .map((lane) => ({
        laneId: lane.laneId,
        page: {
          hasMore: false,
          items:
            lane.parentId === null
              ? [{ id: "parent-a" }, { id: "parent-b" }]
              : lane.parentId === "parent-a" || lane.parentId === "parent-b"
                ? [{ id: `${lane.parentId}-child` }]
                : [],
          nextWatermark: null,
        },
      }))
      .reverse(),
  }));

  expect(containerIds).toEqual([
    "parent-a",
    "parent-b",
    "parent-a-child",
    "parent-b-child",
  ]);
});

test("remote discovery rejects missing, unexpected, and duplicate lane ids", async () => {
  await expect(
    listAllRemoteContainerIds(async () => ({ results: [] })),
  ).resolves.toBeNull();

  await expect(
    listAllRemoteContainerIds(async () => ({
      results: [
        {
          laneId: "unexpected-lane",
          page: { hasMore: false, items: [], nextWatermark: null },
        },
      ],
    })),
  ).resolves.toBeNull();

  let batchIndex = 0;
  await expect(
    listAllRemoteContainerIds(async ({ lanes }) => {
      batchIndex += 1;
      if (batchIndex === 1) {
        return {
          results: [
            {
              laneId: lanes[0]?.laneId ?? "missing-root-lane",
              page: {
                hasMore: false,
                items: [{ id: "parent-a" }, { id: "parent-b" }],
                nextWatermark: null,
              },
            },
          ],
        };
      }

      const duplicateLaneId = lanes[0]?.laneId ?? "missing-parent-lane";
      return {
        results: lanes.map(() => ({
          laneId: duplicateLaneId,
          page: { hasMore: false, items: [], nextWatermark: null },
        })),
      };
    }),
  ).resolves.toBeNull();
});
