import { errorMessage } from "../../../data/errorMessage";
import { rethrowKeyingVerificationError } from "../../../data/keyingProjectionVerification/error";
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

async function markContainerContentsContainerCreateIntentAlreadySynced(input: {
  containerState: ContainerState;
  intent: ContainerCreateIntentSyncInput["intent"];
  state: ContainerCreateIntentSyncState;
}) {
  const { containerState, intent, state } = input;
  const remoteMetadataDocumentId = containerState.record.documentId;
  const remoteMetadataAccessStateHash = containerState.record.accessStateHash;

  if (!remoteMetadataDocumentId || !remoteMetadataAccessStateHash) {
    return;
  }
  const execSql = state.runtime.infra.execSql;

  await state.persistence.markCreateIntentSynced(execSql, {
    containerId: intent.containerId,
    expectedUpdatedAt: intent.updatedAt,
    remoteContainerId: containerState.container.id,
    remoteMetadataAccessStateHash,
    remoteMetadataDocumentId,
  });
}

async function persistCreatedRemoteContainerStateFromIntent(input: {
  containerState: ContainerState;
  created: CreatedRemoteContainerState;
  host: ContainerCreateIntentSyncHost;
  intent: ContainerCreateIntentSyncInput["intent"];
  state: ContainerCreateIntentSyncState;
}) {
  const { containerState, created, host, intent, state } = input;
  containerState.container = {
    ...containerState.container,
    createdAt: created.createdAt,
    serverCreatedAt: created.createdAt,
    serverUpdatedAt: created.updatedAt,
    updatedAt: created.updatedAt,
  };

  const nextRecord = await host.persistContainerState(
    containerState,
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
  );

  containerState.record = nextRecord;
  containerState.container = {
    ...containerState.container,
    metadataDocumentId: created.metadataDocumentId,
    systemSlot:
      created.systemSlot ?? containerState.container.systemSlot ?? null,
    organizationId: created.organizationId,
    parentId: created.parentId,
    serverCreatedAt: created.createdAt,
    serverUpdatedAt: created.updatedAt,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
  const execSql = state.runtime.infra.execSql;

  await state.persistence.markCreateIntentSynced(execSql, {
    containerId: containerState.container.id,
    expectedUpdatedAt: intent.updatedAt,
    remoteContainerId: created.containerId,
    remoteMetadataAccessStateHash: created.accessManifestHash,
    remoteMetadataDocumentId: created.metadataDocumentId,
  });
}

async function trySyncPendingContainerContentsContainerCreateIntent(
  input: ContainerCreateIntentSyncInput,
): Promise<"created" | "blocked" | "failed"> {
  const { host, intent, state } = input;
  const containerState = state.containersById.get(intent.containerId);
  const parentState = state.containersById.get(intent.parentContainerId);

  if (!containerState || !parentState) {
    const execSql = state.runtime.infra.execSql;
    await state.persistence.recordCreateIntentError(
      execSql,
      intent.containerId,
      "Container create intent references a missing local container",
    );
    return "failed";
  }

  if (hasRemoteContainerMetadataState(containerState)) {
    await markContainerContentsContainerCreateIntentAlreadySynced({
      containerState,
      intent,
      state,
    });
    return "created";
  }

  if (input.isRemoteSyncBlocked(parentState.container.organizationId)) {
    return "blocked";
  }

  if (!hasRemoteContainerMetadataState(parentState)) {
    return "blocked";
  }

  let created: Awaited<ReturnType<typeof createRemoteContainer>>;
  try {
    created = await createRemoteContainer({
      systemSlot: containerState.container.systemSlot,
      containerId: containerState.container.id,
      parentContainerId: parentState.container.id,
      resolveProjectionUserKey: state.resolveProjectionUserKey,
      runtime: state.runtime,
    });
  } catch (error) {
    rethrowKeyingVerificationError(error);
    // Plan construction (e.g. an uncached principal policy or a key-unwrap
    // failure) can throw. Record the error for this one intent and keep it
    // pending so the next pass retries it, rather than aborting the whole sweep
    // and stranding every other pending create.
    const message = errorMessage(error);
    await state.persistence.recordCreateIntentError(
      state.runtime.infra.execSql,
      intent.containerId,
      `Remote container create failed: ${message}`,
    );
    return "failed";
  }

  if (created === CONTAINER_ALREADY_COMMITTED) {
    // The container's create response was lost but the server committed it; the
    // re-submit reported the manifest already exists. This is not a failure — the
    // remote container is real. Its metadata state lands when the parent's
    // contents are next hydrated, which marks this intent synced via the
    // hasRemoteContainerMetadataState check above. Leave the intent pending
    // without recording an error so it reconciles quietly instead of surfacing a
    // spurious write-queue failure.
    state.runtime.util.log(
      `Container contents: deferred create intent for ${intent.containerId}; container already committed remotely, awaiting hydration.`,
    );
    return "blocked";
  }

  if (!created) {
    const execSql = state.runtime.infra.execSql;
    await state.persistence.recordCreateIntentError(
      execSql,
      intent.containerId,
      "Remote container create was rejected or unavailable",
    );
    return "failed";
  }

  if (!state.containersById.has(intent.containerId)) {
    // The container was deleted locally while its remote create was in flight:
    // frontend writes run on the store's write chain, outside this sync lane, so
    // a delete can land between the createRemoteContainer await above and the
    // persist below. Re-inserting the container's just-deleted rows here would
    // resurrect a container the user removed. The local delete already cascaded
    // away this create intent (see deleteContainer), so there is nothing to mark
    // synced — discard the now-orphaned remote container we created instead.
    // deleteRemoteContainer resolves false (not throws) when the server rejects
    // the delete, so log both the false result and any thrown error.
    const discardFailure = await deleteRemoteContainer({
      containerId: created.containerId,
      runtime: state.runtime,
    }).then(
      (deleted) => (deleted ? null : "the server rejected the delete"),
      (error: unknown) => errorMessage(error),
    );
    if (discardFailure !== null) {
      state.runtime.util.log(
        `Container contents: failed to discard orphaned remote container ${created.containerId} after local delete: ${discardFailure}`,
      );
    }
    return "failed";
  }

  await persistCreatedRemoteContainerStateFromIntent({
    containerState,
    created,
    host,
    intent,
    state,
  });
  state.runtime.util.log(
    `Container contents: synced local container create ${containerState.container.id}`,
  );
  return "created";
}

export async function syncPendingContainerCreateIntents(input: {
  host: ContainerCreateIntentSyncHost;
  isRemoteSyncBlocked: (organizationId: string) => boolean;
  state: ContainerCreateIntentSyncState;
}): Promise<number> {
  const { host, state } = input;
  const execSql = state.runtime.infra.execSql;
  const pendingIntents =
    await state.persistence.listPendingCreateIntents(execSql);
  const remainingContainerIds = new Set(
    pendingIntents.map((intent) => intent.containerId),
  );
  let createdCount = 0;
  let progressed = true;

  while (progressed) {
    progressed = false;

    for (const intent of pendingIntents) {
      if (!remainingContainerIds.has(intent.containerId)) {
        continue;
      }

      const result = await trySyncPendingContainerContentsContainerCreateIntent(
        {
          host,
          isRemoteSyncBlocked: input.isRemoteSyncBlocked,
          intent,
          state,
        },
      );

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
