import {
  DEFAULT_CONTAINER_PARENT_LANE_PAGE_LIMIT,
  MAX_CONTAINER_PARENT_LANE_PAGE_TOTAL,
} from "@tearleads/validators/request";
import { ContainerSyncWatermarkRepository } from "../../../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import { createContainerParentSyncLane } from "../../containerPersistence";
import { createContainerStateFingerprint } from "../remoteContainers/containerStateFingerprint";
import type {
  ContainerParentHydrationLane,
  FetchedContainerParentLaneResult,
  RemoteContainerHydrationState,
} from "../types";

/**
 * Rows each lane may return so a full batch stays within the single-page
 * maximum; a batch of up to five lanes keeps the ordinary page size.
 */
function laneLimit(laneCount: number): number {
  return Math.max(
    1,
    Math.min(
      DEFAULT_CONTAINER_PARENT_LANE_PAGE_LIMIT,
      Math.floor(MAX_CONTAINER_PARENT_LANE_PAGE_TOTAL / laneCount),
    ),
  );
}

async function prepareContainerParentLanePage(input: {
  lane: ContainerParentHydrationLane;
  laneId: string;
  limit: number;
  state: RemoteContainerHydrationState;
}) {
  const { lane, laneId, limit, state } = input;
  const syncLane = createContainerParentSyncLane(lane.parentId);
  const watermark =
    lane.watermark === undefined
      ? await new ContainerSyncWatermarkRepository(
          state.runtime.infra.execSql,
        ).loadWatermark(syncLane)
      : lane.watermark;
  return {
    lane: { ...lane, watermark },
    request: {
      ...(lane.idsOnly ? { idsOnly: true as const } : {}),
      laneId,
      limit,
      parentId: lane.parentId,
      watermark,
    },
    syncLane,
  };
}

function mapParentLaneBatchResults(input: {
  readonly expectedContainerStates: ReadonlyMap<
    string,
    {
      container: ReturnType<typeof createContainerStateSnapshot>;
      fingerprint: string;
    }
  >;
  readonly expectedHydrationTombstones: ReadonlyMap<
    string,
    Awaited<
      ReturnType<
        RemoteContainerHydrationState["persistence"]["loadContainerHydrationTombstones"]
      >
    >[number]
  >;
  readonly preparedPages: ReadonlyArray<
    Awaited<ReturnType<typeof prepareContainerParentLanePage>>
  >;
  readonly results: NonNullable<
    Awaited<
      ReturnType<
        RemoteContainerHydrationState["runtime"]["apiClient"]["listContainerParentLanes"]
      >
    >
  >["results"];
}): {
  readonly fetched: FetchedContainerParentLaneResult[];
  readonly hasLaneFailure: boolean;
} {
  const resultsByLaneId = new Map(
    input.results.map((result) => [result.laneId, result]),
  );
  if (
    resultsByLaneId.size !== input.preparedPages.length ||
    input.results.length !== input.preparedPages.length
  ) {
    throw new Error("Container parent lane batch response mismatch");
  }

  let hasLaneFailure = false;
  const fetched: FetchedContainerParentLaneResult[] = input.preparedPages.map(
    (preparedPage) => {
      const result = resultsByLaneId.get(preparedPage.request.laneId);
      if (!result) {
        throw new Error("Container parent lane batch response mismatch");
      }
      if ("failure" in result) {
        hasLaneFailure = true;
        return {
          failure: result.failure,
          kind: "failure",
          lane: preparedPage.lane,
          syncLane: preparedPage.syncLane,
        };
      }
      if ("idsPage" in result) {
        if (!preparedPage.lane.idsOnly) {
          throw new Error("Container parent lane batch response mismatch");
        }
        return {
          kind: "idsPage",
          lane: preparedPage.lane,
          response: result.idsPage,
          syncLane: preparedPage.syncLane,
        };
      }
      if (preparedPage.lane.idsOnly) {
        throw new Error("Container parent lane batch response mismatch");
      }
      return {
        expectedContainerStates: input.expectedContainerStates,
        expectedHydrationTombstones: input.expectedHydrationTombstones,
        kind: "page",
        lane: preparedPage.lane,
        response: result.page,
        syncLane: preparedPage.syncLane,
      };
    },
  );
  return { fetched, hasLaneFailure };
}

function createContainerStateSnapshot(
  containerState: NonNullable<
    ReturnType<RemoteContainerHydrationState["containersById"]["get"]>
  >,
) {
  return { ...containerState.container };
}

export async function fetchContainerParentLaneBatch(input: {
  batch: ReadonlyArray<ContainerParentHydrationLane>;
  laneIdPrefix?: string | undefined;
  isCurrent?: (() => boolean) | undefined;
  state: RemoteContainerHydrationState;
}): Promise<ReadonlyArray<FetchedContainerParentLaneResult> | null> {
  const { batch, state } = input;
  const prefix = input.laneIdPrefix ?? state.parentLaneRequestPrefix ?? "lane";
  const expectedContainerStates = new Map(
    Array.from(state.containersById, ([containerId, containerState]) => [
      containerId,
      {
        container: createContainerStateSnapshot(containerState),
        fingerprint: createContainerStateFingerprint(containerState),
      },
    ]),
  );
  const preparedPages = await Promise.all(
    batch.map((lane, index) =>
      prepareContainerParentLanePage({
        lane,
        laneId: `${prefix}-${index}`,
        limit: laneLimit(batch.length),
        state,
      }),
    ),
  );
  if (input.isCurrent?.() === false) {
    return null;
  }
  const expectedHydrationTombstones = new Map(
    (
      await state.persistence.loadContainerHydrationTombstones(
        state.runtime.infra.execSql,
      )
    ).map((tombstone) => [tombstone.containerId, tombstone]),
  );
  if (input.isCurrent?.() === false) {
    return null;
  }
  const response = await state.runtime.apiClient.listContainerParentLanes({
    lanes: preparedPages.map((page) => page.request),
  });
  if (!response) {
    // A superseded crawl's failure says nothing about the current tree.
    if (input.isCurrent?.() !== false) {
      state.containerListingFailures =
        (state.containerListingFailures ?? 0) + 1;
    }
    return null;
  }

  const { fetched, hasLaneFailure } = mapParentLaneBatchResults({
    expectedContainerStates,
    expectedHydrationTombstones,
    preparedPages,
    results: response.results,
  });
  if (hasLaneFailure && input.isCurrent?.() !== false) {
    state.containerListingFailures = (state.containerListingFailures ?? 0) + 1;
  }
  return fetched;
}
