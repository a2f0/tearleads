import { ContainerSyncWatermarkRepository } from "../../../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import { createContainerParentSyncLane } from "../../containerPersistence";
import { createContainerStateFingerprint } from "../remoteContainers/containerStateFingerprint";
import type {
  ContainerParentHydrationLane,
  FetchedContainerParentLanePage,
  RemoteContainerHydrationState,
} from "../types";

async function prepareContainerParentLanePage(input: {
  lane: ContainerParentHydrationLane;
  laneId: string;
  state: RemoteContainerHydrationState;
}) {
  const { lane, laneId, state } = input;
  const syncLane = createContainerParentSyncLane(lane.parentId);
  const watermark =
    lane.watermark === undefined
      ? await new ContainerSyncWatermarkRepository(
          state.runtime.infra.execSql,
        ).loadWatermark(syncLane)
      : lane.watermark;
  return {
    lane: { ...lane, watermark },
    request: { laneId, parentId: lane.parentId, watermark },
    syncLane,
  };
}

export async function fetchContainerParentLaneBatch(input: {
  batch: ReadonlyArray<ContainerParentHydrationLane>;
  laneIdPrefix?: string | undefined;
  isCurrent?: (() => boolean) | undefined;
  state: RemoteContainerHydrationState;
}): Promise<ReadonlyArray<FetchedContainerParentLanePage> | null> {
  const { batch, state } = input;
  const prefix = input.laneIdPrefix ?? state.parentLaneRequestPrefix ?? "lane";
  const expectedContainerStates = new Map(
    Array.from(state.containersById, ([containerId, containerState]) => [
      containerId,
      {
        container: { ...containerState.container },
        fingerprint: createContainerStateFingerprint(containerState),
      },
    ]),
  );
  const preparedPages = await Promise.all(
    batch.map((lane, index) =>
      prepareContainerParentLanePage({
        lane,
        laneId: `${prefix}-${index}`,
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

  const pagesByLaneId = new Map(
    response.results.map((result) => [result.laneId, result.page]),
  );
  if (
    pagesByLaneId.size !== preparedPages.length ||
    response.results.length !== preparedPages.length
  ) {
    throw new Error("Container parent lane batch response mismatch");
  }

  return preparedPages.map((preparedPage) => {
    const page = pagesByLaneId.get(preparedPage.request.laneId);
    if (!page) {
      throw new Error("Container parent lane batch response mismatch");
    }
    return {
      expectedContainerStates,
      expectedHydrationTombstones,
      lane: preparedPage.lane,
      response: page,
      syncLane: preparedPage.syncLane,
    };
  });
}
