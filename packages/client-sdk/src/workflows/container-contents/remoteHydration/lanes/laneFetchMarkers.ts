import type { ListContainersResponse } from "@tearleads/validators/response";
import { ContainerSyncWatermarkRepository } from "../../../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import type { ContainerSyncWatermarkLane } from "../../containerPersistence";
import type { RemoteContainerHydrationState } from "../types";

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
  const recorded = await new ContainerSyncWatermarkRepository(
    state.runtime.infra.execSql,
  ).recordLaneFetch(
    syncLane,
    { checked: !response.hasMore, watermark: response.nextWatermark },
    { stillCurrent: input.isCurrent },
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
