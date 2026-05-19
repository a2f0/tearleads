import {
  getTargetContainerContext,
  readContainerState,
} from "@tearleads/client-sdk/data/containers/shared/projection";
import {
  createExplorerChildContainer,
  deleteExplorerContainerState,
  type ExplorerContainerMetadataPatch,
  type ExplorerDocumentRecord,
  moveRemoteExplorerContainer,
  persistExplorerContainerMetadataStateFromRuntime,
  renameExplorerContainerMetadataStateFromRuntime,
  shareExplorerContainerState,
  shareExplorerContainerStateWithGroup,
} from "@tearleads/client-sdk/workflows/explorer/index";
import { requestDomainDocumentSync } from "../documents/DocumentsProvider";
import type { ContainerState, ExplorerSyncAgent } from "./explorerSyncAgent";
import { updateExplorerSnapshot } from "./state";
import type { ExplorerShareAccessLevel, ExplorerStoreState } from "./types";
import { isContainerInSubtree, toContainerNode } from "./utils";

interface MatchingRemoteContainerGrant {
  accessEpoch: number;
  accessStateHash: string;
  metadataDocumentId: string;
}

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

async function loadMatchingRemoteContainerGrant(input: {
  accessLevel: ExplorerShareAccessLevel;
  containerId: string;
  state: ExplorerStoreState;
  subjectId: string;
  subjectType: "group" | "user";
}): Promise<MatchingRemoteContainerGrant | null> {
  const projection =
    await input.state.runtime.apiClient.getContainerWriterProjection(
      input.containerId,
    );
  if (!projection) {
    return null;
  }

  const target = getTargetContainerContext(projection);
  const remoteState = readContainerState(target.manifest);
  const hasMatchingGrant = remoteState.directGrants.some(
    (grant) =>
      grant.subjectType === input.subjectType &&
      grant.subjectId === input.subjectId &&
      grant.accessLevel === input.accessLevel,
  );
  if (!hasMatchingGrant) {
    return null;
  }

  return {
    accessEpoch: remoteState.epoch,
    accessStateHash: target.manifest.manifestHash,
    metadataDocumentId: remoteState.metadataDocumentId,
  };
}

async function persistDuplicateShareNoop(input: {
  containerState: ContainerState;
  grant: MatchingRemoteContainerGrant;
  state: ExplorerStoreState;
}): Promise<void> {
  const securityContextChanged =
    input.containerState.record.documentId !== input.grant.metadataDocumentId ||
    input.containerState.record.accessEpoch !== input.grant.accessEpoch ||
    input.containerState.record.accessStateHash !== input.grant.accessStateHash;
  const patch: Partial<ExplorerContainerMetadataPatch> = {
    accessEpoch: input.grant.accessEpoch,
    accessStateHash: input.grant.accessStateHash,
    documentId: input.grant.metadataDocumentId,
    metadataDocumentId: input.grant.metadataDocumentId,
    ...(securityContextChanged
      ? {
          contentKeyBundle: null,
          documentKekTargets: null,
          documentManifestBundle: null,
        }
      : {}),
  };

  await persistContainerState(input.state, input.containerState, patch);
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

  if (created.shouldEnqueueInitialUpdate) {
    await syncAgent.enqueuePendingContainerUpdate(
      created.containerState.container.id,
      created.initialUpdate,
    );
    syncAgent.scheduleSync();
  }

  state.containersById.set(
    created.containerState.container.id,
    created.containerState,
  );
  updateExplorerSnapshot(state);
  state.runtime.log(`Explorer: created container "${trimmedName}"`);
  return toContainerNode(created.containerState.container);
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

  const deletedNode = toContainerNode(existingState.container);
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
    return toContainerNode(existingState.container);
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
  return toContainerNode(existingState.container);
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

  const duplicateGrant = await loadMatchingRemoteContainerGrant({
    accessLevel: "write",
    containerId,
    state,
    subjectId: userId,
    subjectType: "user",
  });
  if (duplicateGrant) {
    state.runtime.log(
      `Explorer: skipped duplicate share for container ${containerId} with ${userId}`,
    );
    await persistDuplicateShareNoop({
      containerState: existingState,
      grant: duplicateGrant,
      state,
    });
  } else {
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
  }

  await syncAgent.primeDocumentsForSharedSubtree(containerId);
  requestDomainDocumentSync(state.runtime.domainScope);
  syncAgent.scheduleSync();
  state.runtime.log(`Explorer: shared container ${containerId} with ${userId}`);
  return toContainerNode(existingState.container);
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

  const duplicateGrant = await loadMatchingRemoteContainerGrant({
    accessLevel,
    containerId,
    state,
    subjectId: groupId,
    subjectType: "group",
  });
  if (duplicateGrant) {
    state.runtime.log(
      `Explorer: skipped duplicate share for container ${containerId} with group ${groupId}`,
    );
    await persistDuplicateShareNoop({
      containerState: existingState,
      grant: duplicateGrant,
      state,
    });
  } else {
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
  }

  await syncAgent.primeDocumentsForSharedSubtree(containerId);
  requestDomainDocumentSync(state.runtime.domainScope);
  syncAgent.scheduleSync();
  state.runtime.log(
    `Explorer: shared container ${containerId} with group ${groupId}`,
  );
  return toContainerNode(existingState.container);
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
  return toContainerNode(existingState.container);
}
