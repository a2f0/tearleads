import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { createChildContainerState } from "../../workflows/container-contents/container-state/createChild";
import { deleteContainerState } from "../../workflows/container-contents/container-state/delete";
import {
  shareContainerState,
  shareContainerStateWithGroup,
} from "../../workflows/container-contents/container-state/share";
import type { SharedContainerState } from "../../workflows/container-contents/container-state/types";
import type { ContainerDocumentRecord } from "../../workflows/container-contents/containerPersistence";
import {
  type ContainerMetadataPatch,
  persistContainerMetadataStateFromRuntime,
  renameContainerMetadataStateFromRuntime,
} from "../../workflows/container-contents/metadata";
import { getContainerContentsStoreLogLabel } from "./logLabel";
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
  ContainerContentsShareAccessLevel,
  ContainerContentsStoreState,
  EnsureSystemContainerOptions,
} from "./types";
import { isContainerInSubtree, toContainerNode } from "./utils";

type PersistContainerSaveOptions = Parameters<
  typeof persistContainerMetadataStateFromRuntime
>[0]["saveOptions"];

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
  if (!created) return null;

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
) {
  if ("icon" in options) {
    await applySystemContainerIcon({
      containerState: existing,
      icon: options.icon,
      persistIcon: async (containerState, icon) => {
        await persistContainerState(state, containerState, { icon });
      },
      state,
      syncAgent,
    });
  }
  await promoteExistingLocalSystemContainerSync({
    containerState: existing,
    logLabel: getContainerContentsStoreLogLabel(state),
    options,
    rootState: findRootContainerState(state),
    state,
    syncAgent,
  });
}

function canEnsureSystemContainer(
  state: ContainerContentsStoreState,
  name: string,
): boolean {
  return (
    state.runtime.infra.dbStatus === "ready" && state.snapshot.ready && !!name
  );
}

export async function ensureSystemContainer(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  systemSlot: ContainerSystemSlot,
  name: string,
  options: EnsureSystemContainerOptions = {},
) {
  const trimmedName = name.trim();
  if (!canEnsureSystemContainer(state, trimmedName)) {
    return null;
  }

  let rootState = findRootContainerState(state);
  const existing = findSystemContainerStateForRoot(
    state,
    systemSlot,
    rootState,
  );
  if (existing) {
    await updateExistingSystemContainer(state, syncAgent, existing, options);
    return toContainerNode(existing);
  }

  const allowSynchronousRemoteBootstrap = !options.deferRemoteBootstrap;
  if (
    state.runtime.auth.isAuthenticated &&
    state.runtime.state.online &&
    allowSynchronousRemoteBootstrap
  ) {
    await probeExistingSystemContainer({
      logLabel: getContainerContentsStoreLogLabel(state),
      rootState: findRootContainerState(state),
      state,
      syncAgent,
      systemSlot,
    });
    rootState = findRootContainerState(state);
    const hydrated = findSystemContainerStateForRoot(
      state,
      systemSlot,
      rootState,
    );
    if (hydrated) {
      await updateExistingSystemContainer(state, syncAgent, hydrated, options);
      return toContainerNode(hydrated);
    }
  }

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
  });
  if (!created) return null;

  const finalized = await finalizeCreatedSystemContainer({
    created,
    logLabel: getContainerContentsStoreLogLabel(state),
    state,
    syncAgent,
    systemSlot,
  });
  if (finalized.adopted) {
    await updateExistingSystemContainer(
      state,
      syncAgent,
      finalized.containerState,
      options,
    );
  }
  return toContainerNode(finalized.containerState);
}

export async function deleteContainer(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
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

// Shared core for the user/group share operations: guard remote authority and
// the target's shareable state, run the supplied share call, then apply the
// shared state, prime the subtree's documents, and log.
async function shareContainerUsing(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  containerId: string,
  share: (
    containerState: ContainerState,
  ) => Promise<SharedContainerState | null>,
  logMessage: string,
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

  const shared = await share(existingState);
  if (!shared) {
    return null;
  }

  existingState.container = shared.container;
  existingState.record = shared.record;
  updateContainerContentsSnapshot(state);
  await syncAgent.primeDocumentsForSharedSubtree(containerId);
  syncAgent.scheduleSync();
  state.runtime.util.log(
    `${getContainerContentsStoreLogLabel(state)}: ${logMessage}`,
  );
  return toContainerNode(existingState);
}

export async function shareContainerWithUser(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  containerId: string,
  userId: string,
) {
  return shareContainerUsing(
    state,
    syncAgent,
    containerId,
    (containerState) =>
      shareContainerState({
        accessLevel: "write",
        containerState,
        persistence: state.persistence,
        recipientUserId: userId,
        resolveProjectionUserKey: state.resolveProjectionUserKey,
        runtime: state.runtime,
      }),
    `shared container ${containerId} with ${userId}`,
  );
}

export async function shareContainerWithGroup(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  containerId: string,
  groupId: string,
  accessLevel: ContainerContentsShareAccessLevel,
  options: {
    knownContainerKeks?: ReadonlyMap<string, Uint8Array> | undefined;
    requireExistingGrant?: boolean | undefined;
  } = {},
) {
  return shareContainerUsing(
    state,
    syncAgent,
    containerId,
    (containerState) =>
      shareContainerStateWithGroup({
        accessLevel,
        containerState,
        knownContainerKeks: options.knownContainerKeks,
        persistence: state.persistence,
        recipientGroupId: groupId,
        requireExistingGrant: options.requireExistingGrant,
        resolveProjectionUserKey: state.resolveProjectionUserKey,
        runtime: state.runtime,
      }),
    `shared container ${containerId} with group ${groupId}`,
  );
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
