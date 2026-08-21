import type { ContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
import type { ContainerState } from "./syncAgent";
import type { ContainerContentsStoreState } from "./types";

function isRootState(containerState: ContainerState): boolean {
  return containerState.container.parentId === null;
}

function isPreAuthRootState(containerState: ContainerState): boolean {
  return (
    isRootState(containerState) &&
    !containerState.container.organizationId &&
    !containerState.container.metadataDocumentId
  );
}

export function findRootContainerState(
  state: ContainerContentsStoreState,
): ContainerState | null {
  const rootStates = Array.from(state.containersById.values()).filter(
    isRootState,
  );
  const defaultRootState =
    rootStates.find(
      (containerState) =>
        containerState.container.id === state.runtime.state.containerId,
    ) ?? null;
  const organizationId = state.runtime.auth.organizationId;
  if (!organizationId) {
    return defaultRootState ?? rootStates[0] ?? null;
  }

  const organizationRootState = rootStates.find(
    (containerState) =>
      containerState.container.organizationId === organizationId,
  );
  if (organizationRootState) {
    return organizationRootState;
  }

  if (defaultRootState && isPreAuthRootState(defaultRootState)) {
    return defaultRootState;
  }
  return rootStates.find(isPreAuthRootState) ?? null;
}

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
