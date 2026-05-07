import { bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportAllUpdates,
  exportUpdatesSince,
} from "@tearleads/loro";
import {
  createInitializedContainerMetadataDocument,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers";
import type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";
import type { DocumentRecord } from "../../data/sqlite/documentPersistence";
import {
  createRemoteExplorerContainer,
  moveRemoteExplorerContainer,
  shareRemoteExplorerContainer,
} from "../../workflows/explorer";
import { requestDomainDocumentSync } from "../documents/DocumentsProvider";
import {
  type ContainerMetadataDocument,
  type ContainerState,
  type ExplorerContainerPatch,
  type ExplorerSyncAgent,
  getDefaultContainerName,
} from "./explorerSyncAgent";
import { updateExplorerSnapshot } from "./state";
import type { ExplorerStoreState } from "./types";
import {
  isContainerInSubtree,
  resolveNullableExplorerDocumentField,
  toContainerNode,
} from "./utils";

export async function persistContainerState(
  state: ExplorerStoreState,
  containerState: ContainerState,
  patch: Partial<ExplorerContainerPatch> = {},
  updateView = true,
): Promise<DocumentRecord> {
  const currentDocumentId = containerState.record.documentId ?? null;
  const nextDocumentId = patch.documentId ?? currentDocumentId;
  const documentIdChanged = nextDocumentId !== currentDocumentId;
  const nextAccessEpoch =
    patch.accessEpoch ?? containerState.record.accessEpoch;
  const securityContextChanged =
    documentIdChanged || nextAccessEpoch !== containerState.record.accessEpoch;
  const metadata = readContainerMetadataValue(
    containerState.doc,
    getDefaultContainerName(containerState.container.parentId),
  );
  const nextContainer: ContainerRecord = {
    ...containerState.container,
    organizationId:
      patch.organizationId ?? containerState.container.organizationId,
    parentId: patch.parentId ?? containerState.container.parentId,
    metadataDocumentId:
      patch.metadataDocumentId ??
      patch.documentId ??
      containerState.container.metadataDocumentId,
    name: patch.name ?? metadata.name,
    icon: patch.icon ?? metadata.icon,
  };
  const nextRecord: DocumentRecord = {
    id: containerState.container.id,
    documentId: nextDocumentId,
    loroSnapshot:
      patch.loroSnapshot ?? bytesToBase64(exportAllUpdates(containerState.doc)),
    accessEpoch: nextAccessEpoch,
    accessStateHash: resolveNullableExplorerDocumentField(
      patch,
      "accessStateHash",
      containerState.record.accessStateHash,
      securityContextChanged,
    ),
    lastCommitLsn: resolveNullableExplorerDocumentField(
      patch,
      "lastCommitLsn",
      containerState.record.lastCommitLsn,
      documentIdChanged,
    ),
    contentKeyBundle: resolveNullableExplorerDocumentField(
      patch,
      "contentKeyBundle",
      containerState.record.contentKeyBundle,
      securityContextChanged,
    ),
    documentKekTargets: resolveNullableExplorerDocumentField(
      patch,
      "documentKekTargets",
      containerState.record.documentKekTargets,
      securityContextChanged,
    ),
    documentManifestBundle: resolveNullableExplorerDocumentField(
      patch,
      "documentManifestBundle",
      containerState.record.documentManifestBundle,
      securityContextChanged,
    ),
  };

  await state.persistence.saveContainer(
    state.runtime.execSql,
    nextContainer,
    nextRecord,
  );
  containerState.container = nextContainer;
  containerState.record = nextRecord;
  if (updateView) {
    updateExplorerSnapshot(state);
  }
  return nextRecord;
}

async function buildRemoteChildContainerState(
  state: ExplorerStoreState,
  parentState: ContainerState,
  childId: string,
  trimmedName: string,
  doc: ContainerMetadataDocument,
  initialRecord: DocumentRecord,
) {
  const created = await createRemoteExplorerContainer({
    containerId: childId,
    parentContainerId: parentState.container.id,
    runtime: state.runtime,
  });

  if (!created) {
    return null;
  }

  return {
    container: {
      id: created.containerId,
      organizationId: created.organizationId,
      parentId: created.parentId,
      metadataDocumentId: created.metadataDocumentId,
      name: trimmedName,
      icon: null,
    },
    doc,
    record: {
      ...initialRecord,
      accessEpoch: 1,
      accessStateHash: created.accessManifestHash,
      ...created.persistedMetadataState,
    },
  };
}

function buildLocalChildContainerState(
  parentState: ContainerState,
  childId: string,
  trimmedName: string,
  doc: ContainerMetadataDocument,
  initialRecord: DocumentRecord,
): ContainerState {
  return {
    container: {
      id: childId,
      organizationId: parentState.container.organizationId,
      parentId: parentState.container.id,
      metadataDocumentId: null,
      name: trimmedName,
      icon: null,
    },
    doc,
    record: initialRecord,
  };
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

  const childId = crypto.randomUUID();
  const { doc, initialUpdate } =
    await createInitializedContainerMetadataDocument(childId, {
      icon: null,
      name: trimmedName,
    });
  const initialRecord: DocumentRecord = {
    accessEpoch: 1,
    accessStateHash: null,
    documentId: null,
    id: childId,
    lastCommitLsn: null,
    loroSnapshot: bytesToBase64(initialUpdate),
  };
  const childState =
    state.runtime.isAuthenticated && state.runtime.encapsulationKeyPair
      ? await buildRemoteChildContainerState(
          state,
          parentState,
          childId,
          trimmedName,
          doc,
          initialRecord,
        )
      : buildLocalChildContainerState(
          parentState,
          childId,
          trimmedName,
          doc,
          initialRecord,
        );

  const resolvedChildState =
    childState ??
    buildLocalChildContainerState(
      parentState,
      childId,
      trimmedName,
      doc,
      initialRecord,
    );
  const createIntent =
    !resolvedChildState.record.documentId &&
    resolvedChildState.container.parentId
      ? { parentContainerId: resolvedChildState.container.parentId }
      : undefined;

  await state.persistence.saveContainer(
    state.runtime.execSql,
    resolvedChildState.container,
    resolvedChildState.record,
    createIntent ? { createIntent } : undefined,
  );

  if (
    !resolvedChildState.record.documentId ||
    resolvedChildState.record.contentKeyBundle
  ) {
    await syncAgent.enqueuePendingContainerUpdate(
      resolvedChildState.container.id,
      initialUpdate,
    );
    syncAgent.scheduleSync();
  }

  state.containersById.set(resolvedChildState.container.id, resolvedChildState);
  updateExplorerSnapshot(state);
  state.runtime.log(`Explorer: created container "${trimmedName}"`);
  return toContainerNode(resolvedChildState.container);
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

  const isRemoteContainer =
    typeof existingState.record.documentId === "string" &&
    existingState.record.documentId.length > 0;
  if (isRemoteContainer) {
    if (!state.runtime.isAuthenticated || !state.runtime.online) {
      return null;
    }

    const deleteResult = await state.runtime.apiClient.deleteContainerResult(
      existingState.container.id,
      { reportErrors: false },
    );
    if (!deleteResult.ok && deleteResult.status !== 404) {
      deleteResult.report();
      return null;
    }
  }

  const deletedNode = toContainerNode(existingState.container);
  await state.persistence.deleteContainer(
    state.runtime.execSql,
    existingState.container.id,
  );
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

  const previousVersion = encodeVersionVector(existingState.doc);
  writeContainerMetadataValue(existingState.doc, {
    icon: existingState.container.icon,
    name: trimmedName,
  });
  const update = exportUpdatesSince(existingState.doc, previousVersion);

  await syncAgent.enqueuePendingContainerUpdate(
    existingState.container.id,
    update,
  );
  await persistContainerState(state, existingState, { name: trimmedName });
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

  const shared = await shareRemoteExplorerContainer({
    accessLevel: "write",
    containerId,
    recipientUserId: userId,
    runtime: state.runtime,
  });

  if (!shared) {
    return null;
  }

  await state.runtime.cacheReferencedPrincipalPolicies(
    shared.referencedPrincipalHeads,
  );
  await persistContainerState(state, existingState, {
    accessEpoch: shared.accessEpoch,
    accessStateHash: shared.accessManifestHash,
    documentId: shared.metadataDocumentId,
    metadataDocumentId: shared.metadataDocumentId,
    contentKeyBundle: null,
    documentKekTargets: null,
    documentManifestBundle: null,
  });
  await syncAgent.primeDocumentsForSharedSubtree(containerId);
  requestDomainDocumentSync(state.runtime.domainScope);
  syncAgent.scheduleSync();
  state.runtime.log(`Explorer: shared container ${containerId} with ${userId}`);
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
