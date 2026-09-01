import type { ContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
import { createChildContainerState } from "../../workflows/container-contents/container-state/createChild";
import { deleteContainerState } from "../../workflows/container-contents/container-state/delete";
import {
  installContainerMetadataRecord,
  renameContainerMetadataStateFromRuntime,
} from "../../workflows/container-contents/metadata";
import {
  createDetachedContainerMetadataState,
  installDetachedContainerMetadataState,
} from "../../workflows/container-contents/metadataStateIsolation";
import { persistContainerState } from "./containerStatePersistence";
import { getContainerContentsStoreLogLabel } from "./logLabel";
import { removeMissingContainerState } from "./missingContainerState";
import { updateContainerContentsSnapshot } from "./state";
import type {
  ContainerContentsStoreSyncAgent,
  ContainerState,
} from "./syncAgent";
import { probeExistingSystemContainer } from "./systemContainerHydration";
import { applySystemContainerIcon } from "./systemContainerIcon";
import {
  findRootContainerState,
  findSystemContainerStateForRoot,
} from "./systemContainerLookup";
import { finalizeCreatedSystemContainer } from "./systemContainerPostCreate";
import {
  hasAdvancedManagedPrincipalReference,
  promoteExistingLocalSystemContainerSync,
} from "./systemContainerPromotion";
import type {
  ContainerContentsStoreState,
  EnsureSystemContainerOptions,
} from "./types";
import { isContainerInSubtree, toContainerNode } from "./utils";
import type { ContainerWriteGuard } from "./writeGeneration";

export async function createChildContainer(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  parentId: string,
  name: string,
  isCurrent: ContainerWriteGuard = () => true,
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
    stillCurrent: isCurrent,
  });
  if (!created || !isCurrent()) return null;

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

async function updateExistingSystemContainer(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  existing: ContainerState,
  options: EnsureSystemContainerOptions,
  isCurrent: ContainerWriteGuard,
) {
  if ("icon" in options) {
    const iconApplied = await applySystemContainerIcon({
      containerState: existing,
      icon: options.icon,
      persistIcon: async (containerState, icon, update) =>
        (
          await persistContainerState(
            state,
            containerState,
            { icon },
            false,
            undefined,
            { localMetadataPatch: { icon }, localUpdate: update },
            { isCurrent },
          )
        ).status,
      state,
      syncAgent,
      isCurrent,
    });
    if (!iconApplied || !isCurrent()) {
      return null;
    }
  }
  const promoted = await promoteExistingLocalSystemContainerSync({
    containerState: existing,
    logLabel: getContainerContentsStoreLogLabel(state),
    options,
    persistCreateIntent: async (containerState, parentContainerId) =>
      (
        await persistContainerState(
          state,
          containerState,
          {},
          true,
          {
            createIntent: { parentContainerId },
          },
          undefined,
          { isCurrent },
        )
      ).status === "persisted",
    rootState: findRootContainerState(state),
    state,
    syncAgent,
    isCurrent,
  });
  return promoted && isCurrent() ? toContainerNode(existing) : null;
}

function canEnsureSystemContainer(
  state: ContainerContentsStoreState,
  name: string,
): boolean {
  return (
    state.runtime.infra.dbStatus === "ready" && state.snapshot.ready && !!name
  );
}

async function findOrHydrateSystemContainer(input: {
  isCurrent: ContainerWriteGuard;
  state: ContainerContentsStoreState;
  syncAgent: ContainerContentsStoreSyncAgent;
  systemSlot: ContainerSystemSlot;
}): Promise<ContainerState | null> {
  const { isCurrent, state, syncAgent, systemSlot } = input;
  const existing = findSystemContainerStateForRoot(
    state,
    systemSlot,
    findRootContainerState(state),
  );
  if (
    existing ||
    !state.runtime.auth.isAuthenticated ||
    !state.runtime.state.online
  ) {
    return existing;
  }
  await probeExistingSystemContainer({
    logLabel: getContainerContentsStoreLogLabel(state),
    rootState: findRootContainerState(state),
    state,
    syncAgent,
    systemSlot,
  });
  return isCurrent()
    ? findSystemContainerStateForRoot(
        state,
        systemSlot,
        findRootContainerState(state),
      )
    : null;
}

export async function ensureSystemContainer(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  systemSlot: ContainerSystemSlot,
  name: string,
  options: EnsureSystemContainerOptions = {},
  isCurrent: ContainerWriteGuard = () => true,
) {
  const trimmedName = name.trim();
  if (!canEnsureSystemContainer(state, trimmedName)) {
    return null;
  }

  const allowSynchronousRemoteBootstrap = !options.deferRemoteBootstrap;
  const existing = allowSynchronousRemoteBootstrap
    ? await findOrHydrateSystemContainer({
        isCurrent,
        state,
        syncAgent,
        systemSlot,
      })
    : findSystemContainerStateForRoot(
        state,
        systemSlot,
        findRootContainerState(state),
      );
  if (!isCurrent()) return null;
  if (existing) {
    return updateExistingSystemContainer(
      state,
      syncAgent,
      existing,
      options,
      isCurrent,
    );
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
    icon: options.icon,
    name: trimmedName,
    parentState: rootState,
    persistence: state.persistence,
    queueRemoteSync: !options.deferRemoteSync,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
    stillCurrent: isCurrent,
  });
  if (!created || !isCurrent()) return null;

  const finalized = await finalizeCreatedSystemContainer({
    created,
    logLabel: getContainerContentsStoreLogLabel(state),
    state,
    syncAgent,
    systemSlot,
    isCurrent,
  });
  if (!finalized || !isCurrent()) return null;
  if (finalized.adopted) {
    const updated = await updateExistingSystemContainer(
      state,
      syncAgent,
      finalized.containerState,
      options,
      isCurrent,
    );
    if (!updated) return null;
  }
  return toContainerNode(finalized.containerState);
}

export async function deleteContainer(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  containerId: string,
  isCurrent: ContainerWriteGuard = () => true,
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
  if (!isCurrent()) {
    state.localContainersNeedRefresh = true;
    await syncAgent.refreshLocalContainers();
    // The delete committed before this operation lost its generation. Evict
    // only the exact state it deleted: a concurrent replacement with the same
    // id owns a different object and must survive.
    if (
      state.containersById.get(existingState.container.id) === existingState
    ) {
      state.containersById.delete(existingState.container.id);
      state.documentStoresNeedPriming = true;
      if (state.initialized) {
        updateContainerContentsSnapshot(state);
      }
    }
    return null;
  }

  state.containersById.delete(existingState.container.id);
  // The persistence cascade may have orphaned descendant documents (row 3);
  // re-arm document priming and nudge the lane so their null-scoped passes
  // run now rather than on the next unrelated trigger.
  state.documentStoresNeedPriming = true;
  syncAgent.scheduleSync();
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
  isCurrent: ContainerWriteGuard = () => true,
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

  const detachedState =
    await createDetachedContainerMetadataState(existingState);
  if (!isCurrent()) return null;
  const renamed = await renameContainerMetadataStateFromRuntime({
    metadataState: detachedState,
    name: trimmedName,
    persistence: state.persistence,
    runtime: state.runtime,
    stillCurrent: isCurrent,
  });
  if (!isCurrent()) return null;
  if (!renamed) {
    removeMissingContainerState(state, existingState);
    return null;
  }

  detachedState.container = renamed.container;
  installContainerMetadataRecord(detachedState, renamed.record);
  installDetachedContainerMetadataState(existingState, detachedState);
  updateContainerContentsSnapshot(state);
  syncAgent.scheduleSync();
  state.runtime.util.log(
    `${getContainerContentsStoreLogLabel(state)}: renamed container to "${trimmedName}"`,
  );
  return toContainerNode(existingState);
}

export async function moveContainer(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  containerId: string,
  parentId: string,
  isCurrent: ContainerWriteGuard = () => true,
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
    const persisted = await persistContainerState(
      state,
      existingState,
      { parentId },
      true,
      {
        createIntent: { parentContainerId: parentId },
      },
      undefined,
      { isCurrent },
    );
    if (persisted.status !== "persisted" || !isCurrent()) return null;
    syncAgent.scheduleSync();
    state.runtime.util.log(
      `${getContainerContentsStoreLogLabel(state)}: moved container ${containerId} under ${parentId}`,
    );
    return toContainerNode(existingState);
  }

  const persisted = await persistContainerState(
    state,
    existingState,
    { parentId },
    true,
    {
      moveIntent: {
        parentContainerId: parentId,
        previousParentContainerId: previousParentId,
      },
    },
    undefined,
    { isCurrent },
  );
  if (persisted.status !== "persisted" || !isCurrent()) return null;
  syncAgent.scheduleSync();
  state.runtime.util.log(
    `${getContainerContentsStoreLogLabel(state)}: queued container move ${containerId} under ${parentId}`,
  );
  return toContainerNode(existingState);
}
