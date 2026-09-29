import type { AccessManifestCheckpoint } from "@tearleads/crypto";
import { heldContainerBinding } from "../../data/containers/containerBinding";
import {
  isKeyingVerificationError,
  runWithSecurityIncidentReporting,
} from "../../data/keyingProjectionVerification/error";
import type { ContainerHydrationTombstone } from "./containerPersistence";
import { installContainerMetadataRecord } from "./metadataPersistence";
import { projectionGeneration } from "./projectionGeneration";
import {
  moveIndexedContainerChild,
  removeIndexedContainerChild,
} from "./remoteHydration/childIndex";
import type { PrefetchedDestinationProjection } from "./remoteHydration/destinationPrefetch";
import { rebindReHomedContainer } from "./remoteHydration/heldContainerRebind";
import { insertRemoteContainerState } from "./remoteHydration/insertRemoteContainer";
import {
  reconcileLocalOnlyRootContainers,
  reconcileLocalOnlySystemContainers,
} from "./remoteHydration/reconciliation";
import {
  applyRemoteContainerTimestamps,
  remoteContainerHydrationSaveOptions,
  resolveRemoteContainerHydrationLocalUpdatedAt,
} from "./remoteHydration/remoteContainerTimestamps";
import type {
  ContainerChildIndex,
  ContainerState,
  RemoteContainer,
  RemoteContainerHydrationHost,
  RemoteContainerHydrationState,
} from "./remoteHydration/types";
import { verifyRemoteContainerDestination } from "./remoteHydration/verifiedDestination";

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

function removeMissingHydratedContainer(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  existingState: ContainerState;
  host: RemoteContainerHydrationHost;
  previousParentId: string | null;
  remoteContainer: RemoteContainer;
  state: RemoteContainerHydrationState;
}): void {
  const { existingState, remoteContainer, state } = input;
  if (state.containersById.get(remoteContainer.id) !== existingState) {
    return;
  }

  state.containersById.delete(remoteContainer.id);
  if (input.childIdsByParentId) {
    removeIndexedContainerChild(
      input.childIdsByParentId,
      remoteContainer.id,
      input.previousParentId,
    );
    input.childIdsByParentId.delete(remoteContainer.id);
  }
  input.host.updateSnapshot();
}

function createUpdatedRemoteContainerState(
  existingState: ContainerState,
  remoteContainer: RemoteContainer,
): ContainerState {
  return {
    ...existingState,
    container: applyRemoteContainerTimestamps(
      existingState.container,
      remoteContainer,
    ),
    containerWriterProjection: null,
    metadataReferencedPrincipals: remoteContainer.metadataReferencedPrincipals,
  };
}

function installUpdatedRemoteContainerState(
  existingState: ContainerState,
  nextState: ContainerState,
  host: RemoteContainerHydrationHost,
): void {
  const wasLocalOnly = existingState.container.serverCreatedAt == null;
  existingState.container = nextState.container;
  existingState.containerWriterProjection = nextState.containerWriterProjection;
  existingState.metadataReferencedPrincipals =
    nextState.metadataReferencedPrincipals;
  // The snapshot copied the live generation when it was taken; a hint that
  // landed during the persist leaves the live metadata projection dropped.
  if (projectionGeneration(existingState) === projectionGeneration(nextState))
    existingState.metadataWriterProjection = nextState.metadataWriterProjection;
  installContainerMetadataRecord(existingState, nextState.record);
  // A document pass may have deferred while this root was awaiting proof.
  // The first durable remote acknowledgement makes its pending creates runnable.
  if (wasLocalOnly && existingState.container.serverCreatedAt != null)
    host.requestDocumentPriming?.();
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
}): Promise<ContainerState | null> {
  const { childIdsByParentId, existingState, host, remoteContainer, state } =
    input;
  const previousParentId = existingState.container.parentId;
  const previousLocalUpdatedAt = existingState.container.localUpdatedAt;
  // A queued, not-yet-synced local move/create owns this container's parent
  // until its intent lane reconciles. Omit the remote parent when the page scan
  // saw one; persistence also rechecks the intent transactionally so a move
  // created after that scan wins. Both paths preserve the durable local clock.
  const hasPendingStructuralIntent =
    input.containerIdsWithPendingStructuralIntents.has(remoteContainer.id);
  const nextParentId = hasPendingStructuralIntent
    ? undefined
    : remoteContainer.parentId;
  const localUpdatedAt = resolveRemoteContainerHydrationLocalUpdatedAt({
    containerIdsWithPendingMetadataUpdates:
      input.containerIdsWithPendingMetadataUpdates,
    hasPendingStructuralIntent,
    previousLocalUpdatedAt,
    remoteContainer,
  });
  const nextState = createUpdatedRemoteContainerState(
    existingState,
    remoteContainer,
  );
  const persistenceResult = await host.persistContainerState(
    nextState,
    {
      accessEpoch: remoteContainer.metadataAccessEpoch,
      accessStateHash: remoteContainer.metadataAccessStateHash,
      documentId: remoteContainer.metadataDocumentId,
      effectiveAccessLevel: remoteContainer.effectiveAccessLevel,
      metadataDocumentId: remoteContainer.metadataDocumentId,
      systemSlot: remoteContainer.systemSlot ?? null,
      organizationId: remoteContainer.organizationId,
      ...(nextParentId !== undefined ? { parentId: nextParentId } : {}),
    },
    false,
    remoteContainerHydrationSaveOptions({
      localUpdatedAt,
      remoteContainer,
    }),
    {
      preserveDurableStructureWhenPending: true,
    },
  );
  if (persistenceResult.status === "missing") {
    // Hydration persists a detached candidate so an in-flight response cannot
    // mutate mapped state before its guards settle. Retire the exact state this
    // hydration read because store-level reference cleanup cannot see the clone.
    removeMissingHydratedContainer({
      childIdsByParentId,
      existingState,
      host,
      previousParentId,
      remoteContainer,
      state,
    });
    return null;
  }
  if (persistenceResult.status !== "persisted") return null;
  const { record: nextRecord } = persistenceResult;
  installContainerMetadataRecord(nextState, nextRecord);
  if (input.isCurrent?.() === false) {
    return existingState;
  }
  nextState.container = {
    ...nextState.container,
    metadataDocumentId: remoteContainer.metadataDocumentId,
    organizationId: remoteContainer.organizationId,
    parentId: nextState.container.parentId,
  };

  installUpdatedRemoteContainerState(existingState, nextState, host);
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

interface UpsertRemoteContainerStateInput {
  childIdsByParentId?: ContainerChildIndex | undefined;
  containerIdsWithPendingMetadataUpdates: ReadonlySet<string>;
  containerIdsWithPendingStructuralIntents: ReadonlySet<string>;
  host: RemoteContainerHydrationHost;
  expectedHydrationTombstone?: ContainerHydrationTombstone | null | undefined;
  isCurrent?: (() => boolean) | undefined;
  prefetchedProjection?: PrefetchedDestinationProjection | undefined;
  remoteContainer: RemoteContainer;
  state: RemoteContainerHydrationState;
}

export async function upsertRemoteContainerState(
  input: UpsertRemoteContainerStateInput,
): Promise<ContainerState | null> {
  let expectedPlacementCheckpoint: AccessManifestCheckpoint | undefined;
  const heldState = input.state.containersById.get(input.remoteContainer.id);
  const heldBinding = heldState
    ? heldContainerBinding(heldState)
    : await input.state.persistence.loadHeldContainerBinding(
        input.state.runtime.infra.execSql,
        input.remoteContainer.id,
      );
  if (input.isCurrent?.() === false) return null;
  const verified = await verifyRemoteContainerDestination({
    ...input,
    heldBinding,
    refresh: !!input.expectedHydrationTombstone,
    onVerifiedCheckpoint: (checkpoint) => {
      expectedPlacementCheckpoint = checkpoint;
    },
  });
  if (!verified || input.isCurrent?.() === false) return null;
  input = { ...input, remoteContainer: verified };
  const existingState = input.state.containersById.get(
    input.remoteContainer.id,
  );
  const remoteState = await runWithSecurityIncidentReporting(
    input.state.runtime.util.reportSecurityIncident,
    {
      objectId: verified.id,
      objectKind: "container",
      operation: "container.binding.persist",
      organizationId: verified.organizationId,
    },
    async () =>
      (await rebindReHomedContainer({
        existingState,
        heldBinding,
        isCurrent: input.isCurrent,
        state: input.state,
        verified,
      }))
        ? persistVerifiedRemoteContainer({
            ...input,
            existingState,
            expectedPlacementCheckpoint,
          })
        : null,
  );
  if (!remoteState) {
    return null;
  }
  await reconcileLocalOnlySystemContainers({
    childIdsByParentId: input.childIdsByParentId,
    isCurrent: input.isCurrent,
    requestDocumentPriming: input.host.requestDocumentPriming,
    remoteSystemState: remoteState,
    state: input.state,
  });
  return remoteState;
}

/**
 * Upsert one listed folder, isolating a rejected proof or binding. The refusal
 * was already reported; returning no state leaves the item unapplied without
 * blocking independent folders.
 */
export async function upsertIsolatedRemoteContainerState(
  input: UpsertRemoteContainerStateInput,
): Promise<ContainerState | null> {
  try {
    return await upsertRemoteContainerState(input);
  } catch (error) {
    if (!isKeyingVerificationError(error)) throw error;
    return null;
  }
}

function persistVerifiedRemoteContainer(
  input: UpsertRemoteContainerStateInput & {
    existingState: ContainerState | undefined;
    expectedPlacementCheckpoint: AccessManifestCheckpoint | undefined;
  },
): Promise<ContainerState | null> {
  const { existingState, expectedPlacementCheckpoint } = input;
  return existingState
    ? updateExistingRemoteContainerState({
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
    : insertRemoteContainerState({
        childIdsByParentId: input.childIdsByParentId,
        host: input.host,
        expectedHydrationTombstone: input.expectedHydrationTombstone ?? null,
        expectedPlacementCheckpoint,
        isCurrent: input.isCurrent,
        remoteContainer: input.remoteContainer,
        state: input.state,
      });
}
