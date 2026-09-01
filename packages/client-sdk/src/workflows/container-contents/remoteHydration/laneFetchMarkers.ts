import type { ListContainersResponse } from "@tearleads/validators/response";
import {
  type ContainerSyncWatermarkLane,
  markContainerSyncLaneCheckedIfCurrent,
  saveContainerSyncWatermarkIfCurrent,
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
    const saved = await saveContainerSyncWatermarkIfCurrent(
      execSql,
      syncLane,
      response.nextWatermark,
      input.isCurrent,
    );
    if (!saved || input.isCurrent?.() === false) {
      return false;
    }
  }
  // A check marker suppresses startup polling, so write it only after the
  // server confirms this parent lane is fully drained.
  if (!response.hasMore) {
    const marked = await markContainerSyncLaneCheckedIfCurrent(
      execSql,
      syncLane,
      input.isCurrent,
    );
    if (!marked || input.isCurrent?.() === false) {
      return false;
    }
    if (syncLane.kind === "container_parent" && syncLane.parentId === null) {
      state.rootLaneHydrated = true;
    }
  }

  return true;
}
