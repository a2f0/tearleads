import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import type { ContainerContentsStoreSyncState } from "./syncAgentTypes";

export function removeMissingSyncedContainerState(
  state: ContainerContentsStoreSyncState,
  expectedState: ContainerState,
  updateSnapshot: () => void,
): boolean {
  const containerId = expectedState.container.id;
  if (state.containersById.get(containerId) !== expectedState) {
    return false;
  }

  state.containersById.delete(containerId);
  updateSnapshot();
  return true;
}
