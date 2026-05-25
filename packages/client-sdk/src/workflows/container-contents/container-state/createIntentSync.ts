import type { ContainerState } from "../remoteHydration";
import { createRemoteContainer } from "./remote";
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
    remoteContainerId: containerState.container.id,
    remoteMetadataAccessStateHash,
    remoteMetadataDocumentId,
  });
}

async function persistCreatedRemoteContainerStateFromIntent(input: {
  containerState: ContainerState;
  created: CreatedRemoteContainerState;
  host: ContainerCreateIntentSyncHost;
  state: ContainerCreateIntentSyncState;
}) {
  const { containerState, created, host, state } = input;
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

  const created = await createRemoteContainer({
    containerId: containerState.container.id,
    parentContainerId: parentState.container.id,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
  });

  if (!created) {
    const execSql = state.runtime.infra.execSql;
    await state.persistence.recordCreateIntentError(
      execSql,
      intent.containerId,
      "Remote container create was rejected or unavailable",
    );
    return "failed";
  }

  await persistCreatedRemoteContainerStateFromIntent({
    containerState,
    created,
    host,
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
