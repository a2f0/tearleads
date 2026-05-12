import {
  listPendingExplorerContainerCreateIntents,
  markExplorerContainerCreateIntentSynced,
  recordExplorerContainerCreateIntentError,
} from "../containerPersistence";
import type { ExplorerContainerState } from "../remoteHydration";
import { getExplorerWorkflowRuntimeExecSql } from "../runtime";
import { createRemoteExplorerContainer } from "./remote";
import type {
  CreatedExplorerContainer,
  ExplorerContainerCreateIntentSyncHost,
  ExplorerContainerCreateIntentSyncInput,
  ExplorerContainerCreateIntentSyncState,
} from "./types";

function hasRemoteExplorerContainerMetadataState(
  containerState: ExplorerContainerState,
): boolean {
  return (
    typeof containerState.record.documentId === "string" &&
    containerState.record.documentId.length > 0 &&
    typeof containerState.record.accessStateHash === "string" &&
    containerState.record.accessStateHash.length > 0
  );
}

async function markExplorerContainerCreateIntentAlreadySynced(input: {
  containerState: ExplorerContainerState;
  intent: ExplorerContainerCreateIntentSyncInput["intent"];
  state: ExplorerContainerCreateIntentSyncState;
}) {
  const { containerState, intent, state } = input;
  const remoteMetadataDocumentId = containerState.record.documentId;
  const remoteMetadataAccessStateHash = containerState.record.accessStateHash;

  if (!remoteMetadataDocumentId || !remoteMetadataAccessStateHash) {
    return;
  }
  const execSql = getExplorerWorkflowRuntimeExecSql(state.runtime);

  await markExplorerContainerCreateIntentSynced(execSql, state.persistence, {
    containerId: intent.containerId,
    remoteContainerId: containerState.container.id,
    remoteMetadataAccessStateHash,
    remoteMetadataDocumentId,
  });
}

async function persistCreatedExplorerContainerFromIntent(input: {
  containerState: ExplorerContainerState;
  created: CreatedExplorerContainer;
  host: ExplorerContainerCreateIntentSyncHost;
  state: ExplorerContainerCreateIntentSyncState;
}) {
  const { containerState, created, host, state } = input;

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
  };
  const execSql = getExplorerWorkflowRuntimeExecSql(state.runtime);

  await markExplorerContainerCreateIntentSynced(execSql, state.persistence, {
    containerId: containerState.container.id,
    remoteContainerId: created.containerId,
    remoteMetadataAccessStateHash: created.accessManifestHash,
    remoteMetadataDocumentId: created.metadataDocumentId,
  });
}

async function trySyncPendingExplorerContainerCreateIntent(
  input: ExplorerContainerCreateIntentSyncInput,
): Promise<"created" | "blocked" | "failed"> {
  const { host, intent, state } = input;
  const containerState = state.containersById.get(intent.containerId);
  const parentState = state.containersById.get(intent.parentContainerId);

  if (!containerState || !parentState) {
    const execSql = getExplorerWorkflowRuntimeExecSql(state.runtime);
    await recordExplorerContainerCreateIntentError(
      execSql,
      state.persistence,
      intent.containerId,
      "Container create intent references a missing local container",
    );
    return "failed";
  }

  if (hasRemoteExplorerContainerMetadataState(containerState)) {
    await markExplorerContainerCreateIntentAlreadySynced({
      containerState,
      intent,
      state,
    });
    return "created";
  }

  if (!hasRemoteExplorerContainerMetadataState(parentState)) {
    return "blocked";
  }

  const created = await createRemoteExplorerContainer({
    containerId: containerState.container.id,
    parentContainerId: parentState.container.id,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
  });

  if (!created) {
    const execSql = getExplorerWorkflowRuntimeExecSql(state.runtime);
    await recordExplorerContainerCreateIntentError(
      execSql,
      state.persistence,
      intent.containerId,
      "Remote container create was rejected or unavailable",
    );
    return "failed";
  }

  await persistCreatedExplorerContainerFromIntent({
    containerState,
    created,
    host,
    state,
  });
  state.runtime.log(
    `Explorer: synced local container create ${containerState.container.id}`,
  );
  return "created";
}

export async function syncPendingExplorerContainerCreateIntents(input: {
  host: ExplorerContainerCreateIntentSyncHost;
  state: ExplorerContainerCreateIntentSyncState;
}): Promise<number> {
  const { host, state } = input;
  const execSql = getExplorerWorkflowRuntimeExecSql(state.runtime);
  const pendingIntents = await listPendingExplorerContainerCreateIntents(
    execSql,
    state.persistence,
  );
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

      const result = await trySyncPendingExplorerContainerCreateIntent({
        host,
        intent,
        state,
      });

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
