import type { ListContainersResponse } from "@tearleads/validators/response";
import {
  type ContainerSyncWatermarkLane,
  recordContainerSyncLaneFetchIfCurrent,
} from "../containerPersistence";
import type { RemoteContainerHydrationState } from "./types";

export async function markContainerParentLaneFetched(input: {
  isCurrent?: (() => boolean) | undefined;
  response: ListContainersResponse;
  state: RemoteContainerHydrationState;
  syncLane: ContainerSyncWatermarkLane;
}): Promise<boolean> {
  const { response, state, syncLane } = input;
  if (response.hasMore && !response.nextWatermark) {
    return false;
  }

  // A check marker suppresses startup polling, so record it only after the
  // server confirms this parent lane is fully drained. The cursor and marker
  // share one row and land in one guarded statement.
  const recorded = await recordContainerSyncLaneFetchIfCurrent(
    state.runtime.infra.execSql,
    syncLane,
    { checked: !response.hasMore, watermark: response.nextWatermark },
    input.isCurrent,
  );
  if (!recorded || input.isCurrent?.() === false) {
    return false;
  }
  if (
    !response.hasMore &&
    syncLane.kind === "container_parent" &&
    syncLane.parentId === null
  ) {
    state.rootLaneHydrated = true;
  }

  return true;
}
