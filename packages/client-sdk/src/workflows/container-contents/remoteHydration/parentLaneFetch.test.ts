import { expect, test } from "bun:test";
import type { ListContainerParentLanesRequest } from "@tearleads/validators/request";
import type {
  ListContainerParentLanesResponse,
  ListContainersResponse,
} from "@tearleads/validators/response";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { fetchContainerParentLaneBatch } from "./parentLaneFetch";
import type {
  ContainerParentHydrationLane,
  RemoteContainerHydrationState,
} from "./types";

const UPDATED_AT = "2026-07-18T12:00:00.000Z";
const PARENT_IDS = [
  null,
  "550e8400-e29b-41d4-a716-446655440000",
  "550e8400-e29b-42d4-a716-446655440000",
  "550e8400-e29b-43d4-a716-446655440000",
] as const;

type ListContainerParentLanes =
  RemoteContainerHydrationState["runtime"]["apiClient"]["listContainerParentLanes"];

const unusedExecSql = (async () => {
  throw new Error("The test supplied every lane watermark");
}) as ExecSql;

function createState(
  listContainerParentLanes: ListContainerParentLanes,
): RemoteContainerHydrationState {
  return {
    containersById: new Map(),
    persistence: {
      loadContainerHydrationTombstones: async () => [],
    },
    runtime: {
      apiClient: { listContainerParentLanes },
      infra: { execSql: unusedExecSql },
    },
  } as unknown as RemoteContainerHydrationState;
}

function page(laneId: string): ListContainersResponse {
  return {
    hasMore: false,
    items: [],
    nextWatermark: { id: `response-${laneId}`, updatedAt: UPDATED_AT },
    tombstones: [],
  };
}

function lanes(): ContainerParentHydrationLane[] {
  return PARENT_IDS.map((parentId, index) => ({
    parentId,
    watermark:
      index % 2 === 0
        ? { id: `request-lane-${index}`, updatedAt: UPDATED_AT }
        : null,
  }));
}

test("fetches four parent lanes once and restores request order", async () => {
  const requests: ListContainerParentLanesRequest[] = [];
  const state = createState(async (request) => {
    requests.push(request);
    return {
      results: request.lanes
        .map(({ laneId }) => ({ laneId, page: page(laneId) }))
        .reverse(),
    };
  });

  const fetched = await fetchContainerParentLaneBatch({
    batch: lanes(),
    state,
  });

  expect(requests).toHaveLength(1);
  expect(requests[0]).toEqual({
    lanes: PARENT_IDS.map((parentId, index) => ({
      laneId: `lane-${index}`,
      parentId,
      watermark:
        index % 2 === 0
          ? { id: `request-lane-${index}`, updatedAt: UPDATED_AT }
          : null,
    })),
  });
  expect(
    fetched?.map(({ expectedContainerStates, lane, response, syncLane }) => ({
      expectedContainerStateCount: expectedContainerStates.size,
      parentId: lane.parentId,
      responseWatermarkId: response.nextWatermark?.id,
      syncLane,
    })),
  ).toEqual(
    PARENT_IDS.map((parentId, index) => ({
      expectedContainerStateCount: 0,
      parentId,
      responseWatermarkId: `response-lane-${index}`,
      syncLane: { kind: "container_parent", parentId },
    })),
  );
});

test("rejects missing and extra response lane ids without returning pages", async () => {
  const batch = lanes().slice(0, 2);
  const invalidResponses: ListContainerParentLanesResponse[] = [
    { results: [{ laneId: "lane-0", page: page("lane-0") }] },
    {
      results: [
        { laneId: "lane-0", page: page("lane-0") },
        { laneId: "lane-1", page: page("lane-1") },
        { laneId: "lane-extra", page: page("lane-extra") },
      ],
    },
  ];

  for (const response of invalidResponses) {
    const state = createState(() => Promise.resolve(response));
    await expect(
      fetchContainerParentLaneBatch({ batch, state }),
    ).rejects.toThrow("Container parent lane batch response mismatch");
  }
});
