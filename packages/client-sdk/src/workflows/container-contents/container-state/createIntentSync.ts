import { errorMessage } from "../../../data/errorMessage";
import { reportAndRethrowKeyingVerificationError } from "../../../data/keyingProjectionVerification/error";
import { ContainerCreateIntentSupersededError } from "../../../data/persistence/container-contents/containerIntentPersistence";
import {
  createDetachedContainerMetadataState,
  installDetachedContainerMetadataState,
} from "../metadataStateIsolation";
import type { ContainerState } from "../remoteHydration";
import { hasRemoteContainerMetadataState } from "../remoteHydration/reconciliation";
import { CONTAINER_ALREADY_COMMITTED } from "./createWithMetadata";
import { createRemoteContainer, deleteRemoteContainer } from "./remote";
import type {
  ContainerCreateIntentSyncHost,
  ContainerCreateIntentSyncInput,
  ContainerCreateIntentSyncState,
  CreatedRemoteContainerState,
} from "./types";

type CreateIntentSyncResult = "abandoned" | "blocked" | "created" | "failed";

function currentCreateResult<
  Result extends Exclude<CreateIntentSyncResult, "abandoned">,
>(isCurrent: () => boolean, result: Result): "abandoned" | Result {
  return isCurrent() ? result : "abandoned";
}

async function reportContainerCreateIntegrityFailure(input: {
  readonly containerId: string;
  readonly error: unknown;
  readonly organizationId: string;
  readonly state: ContainerCreateIntentSyncState;
}): Promise<void> {
  await reportAndRethrowKeyingVerificationError(
    input.error,
    input.state.runtime.util.reportSecurityIncident,
    {
      objectId: input.containerId,
      objectKind: "container",
      operation: "container.create.replay",
      organizationId: input.organizationId,
    },
  );
}

async function recordContainerCreateFailure(input: {
  readonly error: unknown;
  readonly isCurrent: () => boolean;
  readonly intent: ContainerCreateIntentSyncInput["intent"];
  readonly organizationId: string;
  readonly state: ContainerCreateIntentSyncState;
}): Promise<"abandoned" | "failed"> {
  await reportContainerCreateIntegrityFailure({
    containerId: input.intent.containerId,
    error: input.error,
    organizationId: input.organizationId,
    state: input.state,
  });
  if (!input.isCurrent()) {
    return "abandoned";
  }
  await input.state.persistence.recordCreateIntentError(
    input.state.runtime.infra.execSql,
    {
      containerId: input.intent.containerId,
      expectedIntentId: input.intent.id,
      expectedUpdatedAt: input.intent.updatedAt,
      message: `Remote container create failed: ${errorMessage(input.error)}`,
      stillCurrent: input.isCurrent,
    },
  );
  return currentCreateResult(input.isCurrent, "failed");
}

async function markContainerContentsContainerCreateIntentAlreadySynced(input: {
  containerState: ContainerState;
  isCurrent: () => boolean;
  intent: ContainerCreateIntentSyncInput["intent"];
  state: ContainerCreateIntentSyncState;
}): Promise<boolean> {
  const { containerState, intent, state } = input;
  const remoteMetadataDocumentId = containerState.record.documentId;
  const remoteMetadataAccessStateHash = containerState.record.accessStateHash;

  if (!remoteMetadataDocumentId || !remoteMetadataAccessStateHash) {
    return false;
  }
  if (!input.isCurrent()) {
    return false;
  }
  const execSql = state.runtime.infra.execSql;

  const settled = await state.persistence.markCreateIntentSynced(execSql, {
    containerId: intent.containerId,
    expectedIntentId: intent.id,
    expectedUpdatedAt: intent.updatedAt,
    remoteContainerId: containerState.container.id,
    remoteMetadataAccessStateHash,
    remoteMetadataDocumentId,
    stillCurrent: input.isCurrent,
    supersededMovePreviousParentId: intent.parentContainerId,
  });
  return settled && input.isCurrent();
}

async function persistCreatedRemoteContainerStateFromIntent(input: {
  containerState: ContainerState;
  created: CreatedRemoteContainerState;
  host: ContainerCreateIntentSyncHost;
  isCurrent: () => boolean;
  intent: ContainerCreateIntentSyncInput["intent"];
  state: ContainerCreateIntentSyncState;
}): Promise<
  | "abandoned"
  | "identity-superseded"
  | "intent-superseded"
  | "missing"
  | "persisted"
> {
  const { containerState, created, host, intent, state } = input;
  if (!input.isCurrent()) {
    return "abandoned";
  }
  const persistenceCandidate =
    await createDetachedContainerMetadataState(containerState);
  if (!input.isCurrent()) {
    return "abandoned";
  }
  persistenceCandidate.container = {
    ...persistenceCandidate.container,
    createdAt: created.createdAt,
    serverCreatedAt: created.createdAt,
    serverUpdatedAt: created.updatedAt,
    updatedAt: created.updatedAt,
  };

  let persistenceResult: Awaited<
    ReturnType<ContainerCreateIntentSyncHost["persistContainerState"]>
  >;
  try {
    persistenceResult = await host.persistContainerState(
      persistenceCandidate,
      {
        accessEpoch: 1,
        accessStateHash: created.accessManifestHash,
        lastCommitLsn: null,
        metadataDocumentId: created.metadataDocumentId,
        systemSlot:
          created.systemSlot ?? containerState.container.systemSlot ?? null,
        organizationId: created.organizationId,
        parentId: created.parentId,
        ...created.persistedMetadataState,
      },
      false,
      {
        serverTimestamps: {
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
        },
      },
      {
        createIntentSettlement: {
          containerId: intent.containerId,
          expectedIntentId: intent.id,
          expectedUpdatedAt: intent.updatedAt,
          remoteContainerId: created.containerId,
          remoteMetadataAccessStateHash: created.accessManifestHash,
          remoteMetadataDocumentId: created.metadataDocumentId,
          supersededMovePreviousParentId: created.parentId,
        },
        expectedStateWhenMissing: containerState,
        isCurrent: input.isCurrent,
        preserveDurableStructureWhenPending: true,
      },
    );
  } catch (error) {
    if (error instanceof ContainerCreateIntentSupersededError) {
      return "intent-superseded";
    }
    throw error;
  }
  if (!input.isCurrent() || persistenceResult.status === "stale-generation") {
    return "abandoned";
  }
  if (persistenceResult.status !== "persisted") {
    return persistenceResult.status;
  }
  const { record: nextRecord } = persistenceResult;
  if (!input.isCurrent()) return "abandoned";
  const currentContainerState = state.containersById.get(intent.containerId);
  if (!currentContainerState) return "missing";
  if (currentContainerState !== containerState) return "identity-superseded";

  installDetachedContainerMetadataState(containerState, persistenceCandidate, {
    candidateRecord: nextRecord,
    preserveConcurrentMetadataEdit: true,
  });
  containerState.container = {
    ...containerState.container,
    metadataDocumentId: created.metadataDocumentId,
    systemSlot:
      created.systemSlot ?? containerState.container.systemSlot ?? null,
    organizationId: created.organizationId,
    parentId: persistenceCandidate.container.parentId,
    serverCreatedAt: created.createdAt,
    serverUpdatedAt: created.updatedAt,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
  return "persisted";
}

async function discardOrphanedRemoteContainer(input: {
  created: CreatedRemoteContainerState;
  isCurrent: () => boolean;
  state: ContainerCreateIntentSyncState;
}): Promise<void> {
  if (!input.isCurrent()) {
    return;
  }
  const discardFailure = await deleteRemoteContainer({
    containerId: input.created.containerId,
    runtime: input.state.runtime,
  }).then(
    (deleted) => (deleted ? null : "the server rejected the delete"),
    (error: unknown) => errorMessage(error),
  );
  if (input.isCurrent() && discardFailure !== null) {
    input.state.runtime.util.log(
      `Container contents: failed to discard orphaned remote container ${input.created.containerId} after local delete: ${discardFailure}`,
    );
  }
}

async function settleRemoteContainerCreate(input: {
  containerState: ContainerState;
  created: Awaited<ReturnType<typeof createRemoteContainer>>;
  syncInput: ContainerCreateIntentSyncInput;
}): Promise<CreateIntentSyncResult> {
  const { containerState, created, syncInput } = input;
  const { host, intent, state } = syncInput;
  if (created === CONTAINER_ALREADY_COMMITTED) {
    // A lost create response leaves the intent pending until hydration installs
    // the committed remote metadata state.
    state.runtime.util.log(
      `Container contents: deferred create intent for ${intent.containerId}; container already committed remotely, awaiting hydration.`,
    );
    syncInput.requestRemoteReconciliation(intent.parentContainerId);
    return "blocked";
  }
  if (!created) {
    await state.persistence.recordCreateIntentError(
      state.runtime.infra.execSql,
      {
        containerId: intent.containerId,
        expectedIntentId: intent.id,
        expectedUpdatedAt: intent.updatedAt,
        message: "Remote container create was rejected or unavailable",
        stillCurrent: syncInput.isCurrent,
      },
    );
    return currentCreateResult(syncInput.isCurrent, "failed");
  }
  if (!state.containersById.has(intent.containerId)) {
    // A same-generation local delete wins; discard the remote orphan instead
    // of resurrecting the deleted local container.
    await discardOrphanedRemoteContainer({
      created,
      isCurrent: syncInput.isCurrent,
      state,
    });
    return currentCreateResult(syncInput.isCurrent, "failed");
  }

  const persistenceStatus = await persistCreatedRemoteContainerStateFromIntent({
    containerState,
    created,
    host,
    isCurrent: syncInput.isCurrent,
    intent,
    state,
  });
  if (persistenceStatus === "abandoned") {
    syncInput.requestRemoteReconciliation(intent.parentContainerId);
    return "abandoned";
  }
  if (persistenceStatus === "missing") {
    await discardOrphanedRemoteContainer({
      created,
      isCurrent: syncInput.isCurrent,
      state,
    });
    return currentCreateResult(syncInput.isCurrent, "failed");
  }
  if (persistenceStatus === "identity-superseded") {
    state.runtime.util.log(
      `Container contents: deferred create intent for ${intent.containerId}; another writer persisted its remote identity.`,
    );
    syncInput.requestRemoteReconciliation(intent.parentContainerId);
    return "blocked";
  }
  if (persistenceStatus === "intent-superseded") {
    state.runtime.util.log(
      `Container contents: deferred create intent for ${intent.containerId}; a newer local intent superseded this pass.`,
    );
    return "blocked";
  }
  state.runtime.util.log(
    `Container contents: synced local container create ${containerState.container.id}`,
  );
  return "created";
}

async function createPendingRemoteContainer(input: {
  containerState: ContainerState;
  parentState: ContainerState;
  syncInput: ContainerCreateIntentSyncInput;
}): Promise<CreateIntentSyncResult> {
  const { containerState, parentState, syncInput } = input;
  const { intent, state } = syncInput;
  let created: Awaited<ReturnType<typeof createRemoteContainer>>;
  try {
    created = await createRemoteContainer({
      systemSlot: containerState.container.systemSlot,
      containerId: containerState.container.id,
      parentContainerId: parentState.container.id,
      resolveProjectionUserKey: state.resolveProjectionUserKey,
      runtime: state.runtime,
      stillCurrent: syncInput.isCurrent,
    });
  } catch (error) {
    return recordContainerCreateFailure({
      error,
      isCurrent: syncInput.isCurrent,
      intent,
      organizationId: parentState.container.organizationId,
      state,
    });
  }
  if (!syncInput.isCurrent()) {
    syncInput.requestRemoteReconciliation(intent.parentContainerId);
    return "abandoned";
  }
  return settleRemoteContainerCreate({ containerState, created, syncInput });
}

async function trySyncPendingContainerContentsContainerCreateIntent(
  input: ContainerCreateIntentSyncInput,
): Promise<CreateIntentSyncResult> {
  const { intent, state } = input;
  if (!input.isCurrent()) {
    return "abandoned";
  }
  const containerState = state.containersById.get(intent.containerId);
  const parentState = state.containersById.get(intent.parentContainerId);

  if (!containerState || !parentState) {
    const execSql = state.runtime.infra.execSql;
    await state.persistence.recordCreateIntentError(execSql, {
      containerId: intent.containerId,
      expectedIntentId: intent.id,
      expectedUpdatedAt: intent.updatedAt,
      message: "Container create intent references a missing local container",
      stillCurrent: input.isCurrent,
    });
    return currentCreateResult(input.isCurrent, "failed");
  }

  if (hasRemoteContainerMetadataState(containerState)) {
    const marked =
      await markContainerContentsContainerCreateIntentAlreadySynced({
        containerState,
        isCurrent: input.isCurrent,
        intent,
        state,
      });
    return marked ? "created" : currentCreateResult(input.isCurrent, "blocked");
  }

  if (input.isRemoteSyncBlocked(parentState.container.organizationId)) {
    return "blocked";
  }

  if (!hasRemoteContainerMetadataState(parentState)) {
    return "blocked";
  }

  return createPendingRemoteContainer({
    containerState,
    parentState,
    syncInput: input,
  });
}

export async function syncPendingContainerCreateIntents(input: {
  host: ContainerCreateIntentSyncHost;
  isCurrent: () => boolean;
  isRemoteSyncBlocked: (organizationId: string) => boolean;
  requestRemoteReconciliation: (parentContainerId: string | null) => void;
  state: ContainerCreateIntentSyncState;
}): Promise<number> {
  if (!input.isCurrent()) {
    return 0;
  }
  const { host } = input;
  const state = { ...input.state };
  const execSql = state.runtime.infra.execSql;
  const pendingIntents =
    await state.persistence.listPendingCreateIntents(execSql);
  if (!input.isCurrent()) {
    return 0;
  }
  const remainingContainerIds = new Set(
    pendingIntents.map((intent) => intent.containerId),
  );
  let createdCount = 0;
  let progressed = true;

  while (progressed && input.isCurrent()) {
    progressed = false;

    for (const intent of pendingIntents) {
      if (!remainingContainerIds.has(intent.containerId)) {
        continue;
      }

      const result = await trySyncPendingContainerContentsContainerCreateIntent(
        {
          host,
          isCurrent: input.isCurrent,
          isRemoteSyncBlocked: input.isRemoteSyncBlocked,
          intent,
          requestRemoteReconciliation: input.requestRemoteReconciliation,
          state,
        },
      );
      if (result === "abandoned") {
        return createdCount;
      }

      if (result === "blocked") {
        continue;
      }

      remainingContainerIds.delete(intent.containerId);
      progressed = result === "created" || progressed;
      if (result === "created") {
        createdCount += 1;
      }
    }
  }

  return createdCount;
}
