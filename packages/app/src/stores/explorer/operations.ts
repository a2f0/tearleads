import {
  createChildContainerState as createExplorerChildContainer,
  deleteContainerState as deleteExplorerContainerState,
  type ContainerMetadataPatch as ExplorerContainerMetadataPatch,
  type ContainerDocumentRecord as ExplorerDocumentRecord,
  moveRemoteContainer as moveRemoteExplorerContainer,
  persistContainerMetadataStateFromRuntime as persistExplorerContainerMetadataStateFromRuntime,
  renameContainerMetadataStateFromRuntime as renameExplorerContainerMetadataStateFromRuntime,
  shareContainerState as shareExplorerContainerState,
  shareContainerStateWithGroup as shareExplorerContainerStateWithGroup,
} from "@tearleads/client-sdk/workflows/container-contents";
import { requestDomainDocumentSync } from "../documents/DocumentsProvider";
import type { ContainerState, ExplorerSyncAgent } from "./explorerSyncAgent";
import { updateExplorerSnapshot } from "./state";
import type { ExplorerShareAccessLevel, ExplorerStoreState } from "./types";
import { isContainerInSubtree, toContainerNode } from "./utils";

export async function persistContainerState(
  state: ExplorerStoreState,
  containerState: ContainerState,
  patch: Partial<ExplorerContainerMetadataPatch> = {},
  updateView = true,
): Promise<ExplorerDocumentRecord> {
  const persisted = await persistExplorerContainerMetadataStateFromRuntime({
    metadataState: containerState,
    patch,
    persistence: state.persistence,
    runtime: state.runtime,
  });
  containerState.container = persisted.container;
  containerState.record = persisted.record;
  if (updateView) {
    updateExplorerSnapshot(state);
  }
  return persisted.record;
}

export async function createChildContainer(
  state: ExplorerStoreState,
  syncAgent: ExplorerSyncAgent,
  parentId: string,
  name: string,
) {
  const trimmedName = name.trim();
  if (
    state.runtime.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !trimmedName
  ) {
    return null;
  }

  const parentState = state.containersById.get(parentId);
  if (!parentState) {
    return null;
  }

  const created = await createExplorerChildContainer({
    createRemote:
      state.runtime.isAuthenticated &&
      Boolean(state.runtime.encapsulationKeyPair),
    name: trimmedName,
    parentState,
    persistence: state.persistence,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
  });
  if (!created) {
    return null;
  }

  if (created.shouldRequestSync) {
    syncAgent.scheduleSync();
  }

  state.containersById.set(
    created.containerState.container.id,
    created.containerState,
  );
  updateExplorerSnapshot(state);
  state.runtime.log(`Explorer: created container "${trimmedName}"`);
  return toContainerNode(created.containerState);
}

export async function deleteExplorerContainer(
  state: ExplorerStoreState,
  containerId: string,
) {
  if (state.runtime.dbStatus !== "ready" || !state.snapshot.ready) {
    return null;
  }

  const existingState = state.containersById.get(containerId);
  if (
    !existingState ||
    existingState.container.parentId === null ||
    Array.from(state.containersById.values()).some(
      (containerState) => containerState.container.parentId === containerId,
    )
  ) {
    return null;
  }

  const isRemoteContainer = Boolean(existingState.record.documentId);
  if (isRemoteContainer) {
    if (!state.runtime.isAuthenticated || !state.runtime.online) {
      return null;
    }
  }

  const deletedNode = toContainerNode(existingState);
  const deleted = await deleteExplorerContainerState({
    containerState: existingState,
    persistence: state.persistence,
    runtime: state.runtime,
  });
  if (!deleted) {
    return null;
  }

  state.containersById.delete(existingState.container.id);
  updateExplorerSnapshot(state);
  state.runtime.log(
    `Explorer: deleted container "${existingState.container.name}"`,
  );
  return deletedNode;
}

export async function renameExplorerContainer(
  state: ExplorerStoreState,
  syncAgent: ExplorerSyncAgent,
  containerId: string,
  name: string,
) {
  const trimmedName = name.trim();
  if (
    state.runtime.dbStatus !== "ready" ||
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

  const renamed = await renameExplorerContainerMetadataStateFromRuntime({
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
  updateExplorerSnapshot(state);
  syncAgent.scheduleSync();
  state.runtime.log(`Explorer: renamed container to "${trimmedName}"`);
  return toContainerNode(existingState);
}

export async function shareExplorerContainerWithUser(
  state: ExplorerStoreState,
  syncAgent: ExplorerSyncAgent,
  containerId: string,
  userId: string,
) {
  if (
    state.runtime.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !state.runtime.isAuthenticated ||
    !state.runtime.online
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

  const shared = await shareExplorerContainerState({
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
  updateExplorerSnapshot(state);
  await syncAgent.primeDocumentsForSharedSubtree(containerId);
  requestDomainDocumentSync(state.runtime.domainScope);
  syncAgent.scheduleSync();
  state.runtime.log(`Explorer: shared container ${containerId} with ${userId}`);
  return toContainerNode(existingState);
}

export async function shareExplorerContainerWithGroup(
  state: ExplorerStoreState,
  syncAgent: ExplorerSyncAgent,
  containerId: string,
  groupId: string,
  accessLevel: ExplorerShareAccessLevel,
) {
  if (
    state.runtime.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !state.runtime.isAuthenticated ||
    !state.runtime.online
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

  const shared = await shareExplorerContainerStateWithGroup({
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
  updateExplorerSnapshot(state);
  await syncAgent.primeDocumentsForSharedSubtree(containerId);
  requestDomainDocumentSync(state.runtime.domainScope);
  syncAgent.scheduleSync();
  state.runtime.log(
    `Explorer: shared container ${containerId} with group ${groupId}`,
  );
  return toContainerNode(existingState);
}

export async function moveExplorerContainer(
  state: ExplorerStoreState,
  syncAgent: ExplorerSyncAgent,
  containerId: string,
  parentId: string,
) {
  if (
    state.runtime.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !state.runtime.isAuthenticated ||
    !state.runtime.online
  ) {
    return null;
  }

  const existingState = state.containersById.get(containerId);
  const targetParentState = state.containersById.get(parentId);
  if (
    !existingState ||
    !targetParentState ||
    existingState.container.parentId === null ||
    isContainerInSubtree(state.containersById, parentId, containerId) ||
    typeof existingState.record.accessStateHash !== "string" ||
    existingState.record.accessStateHash.length === 0
  ) {
    return null;
  }

  const moved = await moveRemoteExplorerContainer({
    containerId,
    parentContainerId: parentId,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
  });
  if (!moved) {
    return null;
  }

  await syncAgent.ingestRemoteContainer(moved);
  await syncAgent.requestRemoteHydration();
  requestDomainDocumentSync(state.runtime.domainScope);
  syncAgent.scheduleSync();
  state.runtime.log(
    `Explorer: moved container ${containerId} under ${parentId}`,
  );
  return toContainerNode(existingState);
}
