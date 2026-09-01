import type { ListContainersResponse } from "@tearleads/validators/response";
import {
  type ContainerSyncWatermarkLane,
  markContainerSyncLaneChecked,
  saveContainerSyncWatermark,
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

  const execSql = state.runtime.infra.execSql;
  if (response.nextWatermark) {
    await saveContainerSyncWatermark(execSql, syncLane, response.nextWatermark);
    if (input.isCurrent?.() === false) {
      return false;
    }
  }
  // A check marker suppresses startup polling, so write it only after the
  // server confirms this parent lane is fully drained.
  if (!response.hasMore) {
    await markContainerSyncLaneChecked(execSql, syncLane);
    if (input.isCurrent?.() === false) {
      return false;
    }
    if (syncLane.kind === "container_parent" && syncLane.parentId === null) {
      state.rootLaneHydrated = true;
    }
  }

  return true;
}
