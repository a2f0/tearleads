import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import { updateContainerContentsSnapshot } from "./state";
import type { ContainerContentsStoreState } from "./types";

export function removeMissingContainerState(
  state: ContainerContentsStoreState,
  expectedState: ContainerState,
): void {
  const containerId = expectedState.container.id;
  if (state.containersById.get(containerId) !== expectedState) {
    return;
  }
  state.containersById.delete(containerId);
  updateContainerContentsSnapshot(state);
}
