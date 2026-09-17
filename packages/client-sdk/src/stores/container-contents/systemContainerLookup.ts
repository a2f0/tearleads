import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { ContainerState } from "./syncAgent";
import type { ContainerContentsStoreState } from "./types";

function isRootState(containerState: ContainerState): boolean {
  return (
    containerState.container.parentId === null &&
    !containerState.container.systemSlot
  );
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

  // Remote root roles have been verified during hydration. An acknowledgement
  // selects the personal merge destination; other organizations may be first
  // encountered on this device after joining or creating them elsewhere.
  const organizationRoots = rootStates.filter(
    (entry) => entry.container.organizationId === organizationId,
  );
  const acknowledgedRootId = state.runtime.auth.rootContainerId;
  const organizationRootState = acknowledgedRootId
    ? organizationRoots.find(
        (entry) => entry.container.id === acknowledgedRootId,
      )
    : organizationRoots.length === 1
      ? organizationRoots[0]
      : null;
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
  const { rootContainerId } = state.runtime.auth;
  const organizationId =
    rootState?.container.organizationId || state.runtime.auth.organizationId;
  const expectedRootId = rootState?.container.id ?? rootContainerId;
  for (const containerState of state.containersById.values()) {
    const container = containerState.container;
    if (container.systemSlot !== systemSlot) continue;
    if (expectedRootId && container.parentId !== expectedRootId) continue;
    const isLocalCandidate =
      rootState && isPreAuthRootState(rootState) && !container.organizationId;
    if (
      organizationId &&
      !isLocalCandidate &&
      container.organizationId !== organizationId
    )
      continue;
    return containerState;
  }
  return null;
}

/** Callers must derive the metadata slot before using this as a destination. */
export function findOrganizationSystemRootState(
  state: ContainerContentsStoreState,
  organizationId: string,
  systemSlot: ContainerSystemSlot,
): ContainerState | null {
  for (const entry of state.containersById.values()) {
    const container = entry.container;
    if (
      container.parentId === null &&
      container.organizationId === organizationId &&
      container.systemSlot === systemSlot
    )
      return entry;
  }
  return null;
}
