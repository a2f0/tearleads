import {
  createContainerMetadataDocument,
  getDefaultContainerName,
} from "../../data/containers/containerMetadataDocument";
import type { ContainerRecord } from "./containerPersistence";
import {
  addIndexedContainerChild,
  moveIndexedContainerChild,
} from "./remoteHydration/childIndex";
import { reattachDormantContainerMetadata } from "./remoteHydration/reattachMetadata";
import {
  reconcileLocalOnlyRootContainers,
  reconcileLocalOnlySystemContainers,
} from "./remoteHydration/reconciliation";
import type {
  ContainerChildIndex,
  ContainerState,
  RemoteContainer,
  RemoteContainerHydrationHost,
  RemoteContainerHydrationState,
  SaveContainerOptions,
} from "./remoteHydration/types";

function applyRemoteContainerTimestamps(
  container: ContainerRecord,
  remoteContainer: RemoteContainer,
): ContainerRecord {
  return {
    ...container,
    createdAt: remoteContainer.createdAt,
    effectiveAccessLevel: remoteContainer.effectiveAccessLevel,
    serverCreatedAt: remoteContainer.createdAt,
    serverUpdatedAt: remoteContainer.updatedAt,
    updatedAt: remoteContainer.updatedAt,
  };
}

function remoteContainerHydrationSaveOptions(input: {
  localUpdatedAt?: string | null | undefined;
  remoteContainer: RemoteContainer;
}): SaveContainerOptions {
  return {
    localUpdatedAt: input.localUpdatedAt ?? input.remoteContainer.updatedAt,
    serverTimestamps: {
      createdAt: input.remoteContainer.createdAt,
      updatedAt: input.remoteContainer.updatedAt,
    },
  };
}

function resolveRemoteContainerHydrationLocalUpdatedAt(input: {
  containerIdsWithPendingMetadataUpdates: ReadonlySet<string>;
  hasPendingStructuralIntent: boolean;
  previousLocalUpdatedAt: string | null | undefined;
  remoteContainer: RemoteContainer;
}): string {
  const {
    containerIdsWithPendingMetadataUpdates,
    hasPendingStructuralIntent,
    previousLocalUpdatedAt,
    remoteContainer,
  } = input;
  if (
    !previousLocalUpdatedAt ||
    previousLocalUpdatedAt.localeCompare(remoteContainer.updatedAt) <= 0
  ) {
    return remoteContainer.updatedAt;
  }

  return containerIdsWithPendingMetadataUpdates.has(remoteContainer.id) ||
    hasPendingStructuralIntent
    ? previousLocalUpdatedAt
    : remoteContainer.updatedAt;
}

// Container ids (restricted to the inbound page) that carry an unsynced local
// create or move intent. Such a container's parent and local-edit timestamp are
// owned by its structural-intent lane until that lane reconciles, so inbound
// hydration must not revert parentId to the server value nor collapse
// localUpdatedAt — doing so silently undoes a queued move and falsely reads
// "synced". Move intents are read via listUnsyncedMoveIntents so a blocked
// move — one whose destination parent has not synced yet, the common boot-time
// case — is protected too. Pending *metadata*
// updates are handled separately (listRemoteContainerIdsWithPendingMetadataUpdates);
// these live in dedicated create/move intent tables that that query does not cover.
export async function listRemoteContainerIdsWithPendingStructuralIntents(input: {
  remoteContainers: ReadonlyArray<RemoteContainer>;
  state: RemoteContainerHydrationState;
}): Promise<Set<string>> {
  if (input.remoteContainers.length === 0) {
    return new Set();
  }
  const remoteContainerIds = new Set(
    input.remoteContainers.map((remoteContainer) => remoteContainer.id),
  );

  const execSql = input.state.runtime.infra.execSql;
  const [pendingCreateIntents, unsyncedMoveIntents] = await Promise.all([
    input.state.persistence.listPendingCreateIntents(execSql),
    input.state.persistence.listUnsyncedMoveIntents(execSql),
  ]);
  const containerIdsWithPendingStructuralIntents = new Set<string>();
  for (const intent of pendingCreateIntents) {
    if (remoteContainerIds.has(intent.containerId)) {
      containerIdsWithPendingStructuralIntents.add(intent.containerId);
    }
  }
  for (const intent of unsyncedMoveIntents) {
    if (remoteContainerIds.has(intent.containerId)) {
      containerIdsWithPendingStructuralIntents.add(intent.containerId);
    }
  }
  return containerIdsWithPendingStructuralIntents;
}

export async function listRemoteContainerIdsWithPendingMetadataUpdates(input: {
  remoteContainers: ReadonlyArray<RemoteContainer>;
  state: RemoteContainerHydrationState;
}): Promise<Set<string>> {
  const containerIds = input.remoteContainers.flatMap((remoteContainer) => {
    const previousLocalUpdatedAt = input.state.containersById.get(
      remoteContainer.id,
    )?.container.localUpdatedAt;

    return previousLocalUpdatedAt &&
      previousLocalUpdatedAt.localeCompare(remoteContainer.updatedAt) > 0
      ? [remoteContainer.id]
      : [];
  });
  if (containerIds.length === 0) {
    return new Set();
  }

  const execSql = input.state.runtime.infra.execSql;
  return new Set(
    await input.state.persistence.listContainerIdsWithPendingUpdates(
      execSql,
      containerIds,
    ),
  );
}

async function updateExistingRemoteContainerState(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  containerIdsWithPendingMetadataUpdates: ReadonlySet<string>;
  containerIdsWithPendingStructuralIntents: ReadonlySet<string>;
  host: RemoteContainerHydrationHost;
  isCurrent?: (() => boolean) | undefined;
  existingState: ContainerState;
  remoteContainer: RemoteContainer;
  state: RemoteContainerHydrationState;
}): Promise<ContainerState> {
  const { childIdsByParentId, existingState, host, remoteContainer, state } =
    input;
  const previousParentId = existingState.container.parentId;
  const previousLocalUpdatedAt = existingState.container.localUpdatedAt;
  // A queued, not-yet-synced local move/create owns this container's parent
  // until its intent lane reconciles. Keep the local parent (and local-edit
  // timestamp) instead of the inbound server values, so hydration cannot revert
  // a pending move or report it as synced before the move actually syncs.
  const hasPendingStructuralIntent =
    input.containerIdsWithPendingStructuralIntents.has(remoteContainer.id);
  const nextParentId = hasPendingStructuralIntent
    ? previousParentId
    : remoteContainer.parentId;
  const localUpdatedAt = resolveRemoteContainerHydrationLocalUpdatedAt({
    containerIdsWithPendingMetadataUpdates:
      input.containerIdsWithPendingMetadataUpdates,
    hasPendingStructuralIntent,
    previousLocalUpdatedAt,
    remoteContainer,
  });
  const nextState: ContainerState = {
    ...existingState,
    container: applyRemoteContainerTimestamps(
      existingState.container,
      remoteContainer,
    ),
    containerWriterProjection: null,
    metadataReferencedPrincipals: remoteContainer.metadataReferencedPrincipals,
  };
  nextState.record = await host.persistContainerState(
    nextState,
    {
      accessEpoch: remoteContainer.metadataAccessEpoch,
      accessStateHash: remoteContainer.metadataAccessStateHash,
      documentId: remoteContainer.metadataDocumentId,
      metadataDocumentId: remoteContainer.metadataDocumentId,
      systemSlot: remoteContainer.systemSlot ?? null,
      organizationId: remoteContainer.organizationId,
      parentId: nextParentId,
    },
    false,
    remoteContainerHydrationSaveOptions({
      localUpdatedAt,
      remoteContainer,
    }),
  );
  if (input.isCurrent?.() === false) {
    return existingState;
  }
  nextState.container = {
    ...nextState.container,
    metadataDocumentId: remoteContainer.metadataDocumentId,
    organizationId: remoteContainer.organizationId,
    parentId: nextParentId,
  };

  existingState.container = nextState.container;
  existingState.containerWriterProjection = nextState.containerWriterProjection;
  existingState.metadataReferencedPrincipals =
    nextState.metadataReferencedPrincipals;
  existingState.metadataWriterProjection = nextState.metadataWriterProjection;
  existingState.record = nextState.record;
  moveIndexedContainerChild(
    childIdsByParentId,
    remoteContainer.id,
    previousParentId,
    existingState.container.parentId,
  );
  await reconcileLocalOnlyRootContainers({
    childIdsByParentId,
    isCurrent: input.isCurrent,
    remoteRootState: existingState,
    requestDocumentPriming: host.requestDocumentPriming,
    state,
  });
  return existingState;
}

async function insertRemoteContainerState(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  host: RemoteContainerHydrationHost;
  isCurrent?: (() => boolean) | undefined;
  remoteContainer: RemoteContainer;
  state: RemoteContainerHydrationState;
}): Promise<ContainerState> {
  const { childIdsByParentId, host, remoteContainer, state } = input;
  const doc = await createContainerMetadataDocument(remoteContainer.id);
  const execSql = state.runtime.infra.execSql;
  // A container inserted with dormant retained metadata (row 4's
  // access_revoked branch) is a re-attach, not a fresh discovery: import the
  // retained content and markers instead of overwriting them with an empty
  // document. Access and keying fields still come from the remote container —
  // revocation may have rotated them.
  let dormantRecord = await state.persistence.loadContainerMetadataRecord(
    execSql,
    remoteContainer.id,
  );
  if (
    dormantRecord?.documentId != null &&
    dormantRecord.documentId !== remoteContainer.metadataDocumentId
  ) {
    // The remote metadata document was replaced while access was revoked:
    // the dormant scope's queued updates belong to the dead stream and would
    // otherwise resurface once the container row returns (the write-queue
    // guard keys on the container row alone). Purge before inserting fresh.
    await state.persistence.purgeDormantContainerMetadata(
      execSql,
      remoteContainer.id,
    );
    dormantRecord = null;
  }
  const reattached = reattachDormantContainerMetadata({
    defaultName: getDefaultContainerName(remoteContainer.parentId),
    doc,
    dormantRecord,
    remoteMetadataDocumentId: remoteContainer.metadataDocumentId,
  });
  const initialSnapshot = reattached.initialSnapshot;
  const containerState: ContainerState = {
    container: applyRemoteContainerTimestamps(
      {
        id: remoteContainer.id,
        effectiveAccessLevel: remoteContainer.effectiveAccessLevel,
        organizationId: remoteContainer.organizationId,
        parentId: remoteContainer.parentId,
        metadataDocumentId: remoteContainer.metadataDocumentId,
        systemSlot: remoteContainer.systemSlot ?? null,
        name: reattached.name,
        icon: reattached.icon,
      },
      remoteContainer,
    ),
    metadataReferencedPrincipals: remoteContainer.metadataReferencedPrincipals,
    doc,
    record: {
      accessEpoch: remoteContainer.metadataAccessEpoch,
      accessStateHash: remoteContainer.metadataAccessStateHash,
      documentId: remoteContainer.metadataDocumentId,
      id: remoteContainer.id,
      lastCommitLsn: reattached.lastCommitLsn,
      metadataUpdates: initialSnapshot,
      snapshotEndVersion: reattached.snapshotEndVersion,
      contentKeyBundle: null,
      documentKekTargets: null,
      documentManifestBundle: null,
    },
  };

  containerState.container = await state.persistence.saveContainer(
    execSql,
    containerState.container,
    containerState.record,
    remoteContainerHydrationSaveOptions({ remoteContainer }),
  );
  if (input.isCurrent?.() === false) {
    return containerState;
  }
  state.containersById.set(remoteContainer.id, containerState);
  if (childIdsByParentId) {
    addIndexedContainerChild(
      childIdsByParentId,
      remoteContainer.id,
      remoteContainer.parentId,
    );
  }
  await reconcileLocalOnlyRootContainers({
    childIdsByParentId,
    isCurrent: input.isCurrent,
    remoteRootState: containerState,
    requestDocumentPriming: host.requestDocumentPriming,
    state,
  });
  return containerState;
}

export async function upsertRemoteContainerState(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  containerIdsWithPendingMetadataUpdates: ReadonlySet<string>;
  containerIdsWithPendingStructuralIntents: ReadonlySet<string>;
  host: RemoteContainerHydrationHost;
  isCurrent?: (() => boolean) | undefined;
  remoteContainer: RemoteContainer;
  state: RemoteContainerHydrationState;
}): Promise<ContainerState> {
  const existingState = input.state.containersById.get(
    input.remoteContainer.id,
  );
  const remoteState = existingState
    ? await updateExistingRemoteContainerState({
        childIdsByParentId: input.childIdsByParentId,
        containerIdsWithPendingMetadataUpdates:
          input.containerIdsWithPendingMetadataUpdates,
        containerIdsWithPendingStructuralIntents:
          input.containerIdsWithPendingStructuralIntents,
        existingState,
        host: input.host,
        isCurrent: input.isCurrent,
        remoteContainer: input.remoteContainer,
        state: input.state,
      })
    : await insertRemoteContainerState({
        childIdsByParentId: input.childIdsByParentId,
        host: input.host,
        isCurrent: input.isCurrent,
        remoteContainer: input.remoteContainer,
        state: input.state,
      });
  await reconcileLocalOnlySystemContainers({
    childIdsByParentId: input.childIdsByParentId,
    isCurrent: input.isCurrent,
    requestDocumentPriming: input.host.requestDocumentPriming,
    remoteSystemState: remoteState,
    state: input.state,
  });
  return remoteState;
}
