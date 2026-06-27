import type { ContainerState } from "../remoteHydration";
import { createRemoteContainer, deleteRemoteContainer } from "./remote";
import type {
  ContainerCreateIntentSyncHost,
  ContainerCreateIntentSyncInput,
  ContainerCreateIntentSyncState,
  CreatedRemoteContainerState,
} from "./types";

function hasRemoteContainerMetadataState(
  containerState: ContainerState,
): boolean {
  return (
    typeof containerState.record.documentId === "string" &&
    containerState.record.documentId.length > 0 &&
    typeof containerState.record.accessStateHash === "string" &&
    containerState.record.accessStateHash.length > 0
  );
}

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
    // Plan construction (e.g. an uncached principal policy or a key-unwrap
    // failure) can throw. Record the error for this one intent and keep it
    // pending so the next pass retries it, rather than aborting the whole sweep
    // and stranding every other pending create.
    const message = error instanceof Error ? error.message : String(error);
    await state.persistence.recordCreateIntentError(
      state.runtime.infra.execSql,
      intent.containerId,
      `Remote container create failed: ${message}`,
    );
    return "failed";
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
    await deleteRemoteContainer({
      containerId: created.containerId,
      runtime: state.runtime,
    }).catch((error: unknown) => {
      state.runtime.util.log(
        `Container contents: failed to discard orphaned remote container ${created.containerId} after local delete: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
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
