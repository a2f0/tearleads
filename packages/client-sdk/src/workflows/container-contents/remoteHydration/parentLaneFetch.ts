import {
  createContainerParentSyncLane,
  loadContainerSyncWatermark,
} from "../containerPersistence";
import { createContainerStateFingerprint } from "./containerStateFingerprint";
import type {
  ContainerParentHydrationLane,
  FetchedContainerParentLanePage,
  RemoteContainerHydrationState,
} from "./types";

async function prepareContainerParentLanePage(input: {
  lane: ContainerParentHydrationLane;
  laneId: string;
  state: RemoteContainerHydrationState;
}) {
  const { lane, laneId, state } = input;
  const syncLane = createContainerParentSyncLane(
    lane.parentId,
    state.runtime.auth?.organizationId ?? undefined,
  );
  const watermark =
    lane.watermark === undefined
      ? await loadContainerSyncWatermark(state.runtime.infra.execSql, syncLane)
      : lane.watermark;
  return {
    lane,
    request: { laneId, parentId: lane.parentId, watermark },
    syncLane,
  };
}

export async function fetchContainerParentLaneBatch(input: {
  batch: ReadonlyArray<ContainerParentHydrationLane>;
  isCurrent?: (() => boolean) | undefined;
  state: RemoteContainerHydrationState;
}): Promise<ReadonlyArray<FetchedContainerParentLanePage> | null> {
  const { batch, state } = input;
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
        laneId: `lane-${index}`,
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
