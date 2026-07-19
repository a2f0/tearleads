import { updateContainerContentsSnapshot } from "./state";
import type { ContainerContentsStoreState } from "./types";
import { toContainerNode } from "./utils";

function getContainerContentsStoreLogLabel(
  state: ContainerContentsStoreState,
): string {
  return state.logLabel ?? "Container contents";
}

// Drop a container from the live tree state only — no persistence or server
// side effects. The eviction step after a write-queue discard, whose workflow
// already deleted the SQLite rows; without it the snapshot keeps rendering the
// discarded container and a later rename would re-persist it.
export async function evictContainer(
  state: ContainerContentsStoreState,
  containerId: string,
) {
  const existingState = state.containersById.get(containerId);
  if (!existingState) {
    return null;
  }

  state.containersById.delete(containerId);
  updateContainerContentsSnapshot(state);
  state.runtime.util.log(
    `${getContainerContentsStoreLogLabel(state)}: evicted container "${existingState.container.name}" from the live tree`,
  );
  return toContainerNode(existingState);
}
