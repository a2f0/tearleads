import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { ContainerState } from "./syncAgent";
import type { ContainerContentsStoreState } from "./types";

export function findSystemContainerStateForRoot(
  state: ContainerContentsStoreState,
  systemSlot: ContainerSystemSlot,
  rootState: ContainerState | null,
): ContainerState | null {
  let fallback: ContainerState | null = null;
  for (const containerState of state.containersById.values()) {
    if ((containerState.container.systemSlot ?? null) === systemSlot) {
      if (
        rootState &&
        containerState.container.parentId === rootState.container.id
      ) {
        return containerState;
      }
      fallback ??= containerState;
    }
  }

  return rootState ? null : fallback;
}
