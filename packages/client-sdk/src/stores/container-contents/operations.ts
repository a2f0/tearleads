import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { createChildContainerState } from "../../workflows/container-contents/container-state/createChild";
import { deleteContainerState } from "../../workflows/container-contents/container-state/delete";
import {
  shareContainerState,
  shareContainerStateWithGroup,
} from "../../workflows/container-contents/container-state/share";
import type { ContainerDocumentRecord } from "../../workflows/container-contents/containerPersistence";
import {
  type ContainerMetadataPatch,
  persistContainerMetadataStateFromRuntime,
  renameContainerMetadataStateFromRuntime,
} from "../../workflows/container-contents/metadata";
import { isDestroyedDatabaseClientError } from "../../workflows/container-contents/syncLane";
import { updateContainerContentsSnapshot } from "./state";
import type {
  ContainerContentsStoreSyncAgent,
  ContainerState,
} from "./syncAgent";
import {
  hasAdvancedManagedPrincipalReference,
  promoteExistingLocalSystemContainerSync,
} from "./systemContainerPromotion";
import type {
  ContainerContentsShareAccessLevel,
  ContainerContentsStoreState,
  EnsureSystemContainerOptions,
} from "./types";
import { isContainerInSubtree, toContainerNode } from "./utils";

type PersistContainerSaveOptions = Parameters<
  typeof persistContainerMetadataStateFromRuntime
>[0]["saveOptions"];

function getContainerContentsStoreLogLabel(
  state: ContainerContentsStoreState,
): string {
  return state.logLabel ?? "Container contents";
}

export async function persistContainerState(
  state: ContainerContentsStoreState,
  containerState: ContainerState,
  patch: Partial<ContainerMetadataPatch> = {},
  updateView = true,
  saveOptions?: PersistContainerSaveOptions,
): Promise<ContainerDocumentRecord> {
  const persisted = await persistContainerMetadataStateFromRuntime({
    metadataState: containerState,
    patch,
    persistence: state.persistence,
    runtime: state.runtime,
    saveOptions,
  });
  containerState.container = persisted.container;
  containerState.record = persisted.record;
  if (updateView) {
    updateContainerContentsSnapshot(state);
  }
  return persisted.record;
}

export async function createChildContainer(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  parentId: string,
  name: string,
) {
  const trimmedName = name.trim();
  if (
    state.runtime.infra.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !trimmedName
  ) {
    return null;
  }

  const parentState = state.containersById.get(parentId);
  if (!parentState) {
    return null;
  }

  const created = await createChildContainerState({
    createRemote: false,
    name: trimmedName,
    parentState,
    persistence: state.persistence,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
  });
  if (!created) {
    return null;
  }

  state.containersById.set(
    created.containerState.container.id,
    created.containerState,
  );
  updateContainerContentsSnapshot(state);
  if (created.shouldRequestSync) {
    syncAgent.scheduleSync();
  }
  state.runtime.util.log(
    `${getContainerContentsStoreLogLabel(state)}: created container "${trimmedName}"`,
  );
  return toContainerNode(created.containerState);
}

function findSystemContainerState(
  state: ContainerContentsStoreState,
  systemSlot: ContainerSystemSlot,
): ContainerState | null {
  for (const containerState of state.containersById.values()) {
    if ((containerState.container.systemSlot ?? null) === systemSlot) {
      return containerState;
    }
  }

  return null;
}

function findRootContainerState(
  state: ContainerContentsStoreState,
): ContainerState | null {
  const defaultContainerId = state.runtime.state.containerId;
  if (defaultContainerId) {
    const defaultRootState = state.containersById.get(defaultContainerId);
    if (defaultRootState?.container.parentId === null) {
      return defaultRootState;
    }
  }

  for (const containerState of state.containersById.values()) {
    if (containerState.container.parentId === null) {
      return containerState;
    }
  }

  return null;
}

// Best-effort remote probe for an already-existing system container. System
// containers only live under the root, so this probes the root lanes (not a
// full-tree refresh). Device-first: a network failure must not abort
// provisioning, or a caller that waits on this container never observes it —
// the caller falls through to a local create whose intent reconciles later.
async function hydrateExistingSystemContainer(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  systemSlot: ContainerSystemSlot,
) {
  const existingRoot = findRootContainerState(state);
  try {
    await syncAgent.requestRemoteHydration({
      parentIds: existingRoot ? [null, existingRoot.container.id] : [null],
    });
  } catch (error) {
    if (!isDestroyedDatabaseClientError(error)) {
      const reason = error instanceof Error ? error.message : String(error);
      state.runtime.util.log(
        `${getContainerContentsStoreLogLabel(state)}: remote probe for "${systemSlot}" failed (${reason}); creating it locally`,
      );
    }
  }
  const hydrated = findSystemContainerState(state, systemSlot);
  return hydrated ? toContainerNode(hydrated) : null;
}

export async function ensureSystemContainer(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  systemSlot: ContainerSystemSlot,
  name: string,
  options: EnsureSystemContainerOptions = {},
) {
  const trimmedName = name.trim();
  if (
    state.runtime.infra.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !trimmedName
  ) {
    return null;
  }

  const existing = findSystemContainerState(state, systemSlot);
  if (existing) {
    await promoteExistingLocalSystemContainerSync({
      containerState: existing,
      logLabel: getContainerContentsStoreLogLabel(state),
      options,
      rootState: findRootContainerState(state),
      state,
      syncAgent,
    });
    return toContainerNode(existing);
  }

  const allowSynchronousRemoteBootstrap = !options.deferRemoteBootstrap;
  if (
    state.runtime.auth.isAuthenticated &&
    state.runtime.state.online &&
    allowSynchronousRemoteBootstrap
  ) {
    const hydrated = await hydrateExistingSystemContainer(
      state,
      syncAgent,
      systemSlot,
    );
    if (hydrated) {
      return hydrated;
    }
  }

  const rootState = findRootContainerState(state);
  if (!rootState) {
    return null;
  }
  if (
    options.skipAdvancedManagedRoot &&
    hasAdvancedManagedPrincipalReference(rootState)
  ) {
    state.runtime.util.log(
      `${getContainerContentsStoreLogLabel(state)}: skipped background system container "${systemSlot}" because the root has advanced managed-principal references`,
    );
    return null;
  }

  const created = await createChildContainerState({
    systemSlot,
    createRemote:
      allowSynchronousRemoteBootstrap &&
      state.runtime.auth.isAuthenticated &&
      Boolean(state.runtime.crypto.encapsulationKeyPair),
    name: trimmedName,
    parentState: rootState,
    persistence: state.persistence,
    queueRemoteSync: !options.deferRemoteSync,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
  });
  if (!created) {
    return null;
  }

  state.containersById.set(
    created.containerState.container.id,
    created.containerState,
  );
  updateContainerContentsSnapshot(state);
  if (created.shouldRequestSync) {
    syncAgent.scheduleSync();
  }
  state.runtime.util.log(
    `${getContainerContentsStoreLogLabel(state)}: ensured system container "${systemSlot}"`,
  );
  return toContainerNode(created.containerState);
}

export async function deleteContainer(
  state: ContainerContentsStoreState,
  containerId: string,
) {
  if (state.runtime.infra.dbStatus !== "ready" || !state.snapshot.ready) {
    return null;
  }

  const existingState = state.containersById.get(containerId);
  if (
    !existingState ||
    existingState.container.parentId === null ||
    (existingState.container.systemSlot ?? null) !== null ||
    Array.from(state.containersById.values()).some(
      (containerState) => containerState.container.parentId === containerId,
    )
  ) {
    return null;
  }

  const isRemoteContainer = Boolean(existingState.record.documentId);
  if (isRemoteContainer) {
    if (!state.runtime.auth.isAuthenticated || !state.runtime.state.online) {
      return null;
    }
  }

  const deletedNode = toContainerNode(existingState);
  const deleted = await deleteContainerState({
    containerState: existingState,
    persistence: state.persistence,
    runtime: state.runtime,
  });
  if (!deleted) {
    return null;
  }

  state.containersById.delete(existingState.container.id);
  updateContainerContentsSnapshot(state);
  state.runtime.util.log(
    `${getContainerContentsStoreLogLabel(state)}: deleted container "${existingState.container.name}"`,
  );
  return deletedNode;
}

export async function renameContainer(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  containerId: string,
  name: string,
) {
  const trimmedName = name.trim();
  if (
    state.runtime.infra.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !trimmedName
  ) {
    return null;
  }

  const existingState = state.containersById.get(containerId);
  if (!existingState) {
    return null;
  }

  if (existingState.container.name === trimmedName) {
    return toContainerNode(existingState);
  }

  const renamed = await renameContainerMetadataStateFromRuntime({
    metadataState: existingState,
    name: trimmedName,
    persistence: state.persistence,
    runtime: state.runtime,
  });
  if (!renamed) {
    return null;
  }

  existingState.container = renamed.container;
  existingState.record = renamed.record;
  updateContainerContentsSnapshot(state);
  syncAgent.scheduleSync();
  state.runtime.util.log(
    `${getContainerContentsStoreLogLabel(state)}: renamed container to "${trimmedName}"`,
  );
  return toContainerNode(existingState);
}

export async function shareContainerWithUser(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  containerId: string,
  userId: string,
) {
  if (
    state.runtime.infra.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !state.runtime.auth.isAuthenticated ||
    !state.runtime.state.online
  ) {
    return null;
  }

  const existingState = state.containersById.get(containerId);
  const expectedAccessStateHash = existingState?.record.accessStateHash;
  if (
    !existingState?.record.documentId ||
    typeof expectedAccessStateHash !== "string" ||
    expectedAccessStateHash.length === 0
  ) {
    return null;
  }

  const shared = await shareContainerState({
    accessLevel: "write",
    containerState: existingState,
    persistence: state.persistence,
    recipientUserId: userId,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
  });

  if (!shared) {
    return null;
  }

  existingState.container = shared.container;
  existingState.record = shared.record;
  updateContainerContentsSnapshot(state);
  await syncAgent.primeDocumentsForSharedSubtree(containerId);
  syncAgent.scheduleSync();
  state.runtime.util.log(
    `${getContainerContentsStoreLogLabel(state)}: shared container ${containerId} with ${userId}`,
  );
  return toContainerNode(existingState);
}

export async function shareContainerWithGroup(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  containerId: string,
  groupId: string,
  accessLevel: ContainerContentsShareAccessLevel,
) {
  if (
    state.runtime.infra.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !state.runtime.auth.isAuthenticated ||
    !state.runtime.state.online
  ) {
    return null;
  }

  const existingState = state.containersById.get(containerId);
  const expectedAccessStateHash = existingState?.record.accessStateHash;
  if (
    !existingState?.record.documentId ||
    typeof expectedAccessStateHash !== "string" ||
    expectedAccessStateHash.length === 0
  ) {
    return null;
  }

  const shared = await shareContainerStateWithGroup({
    accessLevel,
    containerState: existingState,
    persistence: state.persistence,
    recipientGroupId: groupId,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
  });

  if (!shared) {
    return null;
  }

  existingState.container = shared.container;
  existingState.record = shared.record;
  updateContainerContentsSnapshot(state);
  await syncAgent.primeDocumentsForSharedSubtree(containerId);
  syncAgent.scheduleSync();
  state.runtime.util.log(
    `${getContainerContentsStoreLogLabel(state)}: shared container ${containerId} with group ${groupId}`,
  );
  return toContainerNode(existingState);
}

export async function moveContainer(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  containerId: string,
  parentId: string,
) {
  if (state.runtime.infra.dbStatus !== "ready" || !state.snapshot.ready) {
    return null;
  }

  const existingState = state.containersById.get(containerId);
  const targetParentState = state.containersById.get(parentId);
  if (
    !existingState ||
    !targetParentState ||
    existingState.container.parentId === null ||
    (existingState.container.systemSlot ?? null) !== null ||
    isContainerInSubtree(state.containersById, parentId, containerId)
  ) {
    return null;
  }

  if (existingState.container.parentId === parentId) {
    return toContainerNode(existingState);
  }

  const isRemoteContainer = Boolean(existingState.record.documentId);
  const previousParentId = existingState.container.parentId;
  if (!isRemoteContainer) {
    await persistContainerState(state, existingState, { parentId }, true, {
      createIntent: { parentContainerId: parentId },
    });
    syncAgent.scheduleSync();
    state.runtime.util.log(
      `${getContainerContentsStoreLogLabel(state)}: moved container ${containerId} under ${parentId}`,
    );
    return toContainerNode(existingState);
  }

  await persistContainerState(state, existingState, { parentId }, true, {
    moveIntent: {
      parentContainerId: parentId,
      previousParentContainerId: previousParentId,
    },
  });
  syncAgent.scheduleSync();
  state.runtime.util.log(
    `${getContainerContentsStoreLogLabel(state)}: queued container move ${containerId} under ${parentId}`,
  );
  return toContainerNode(existingState);
}
