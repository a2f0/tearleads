import type { ContainerState, RemoteContainer } from "../remoteHydration";
import { moveRemoteContainer } from "./remote";
import type {
  ContainerMoveIntentSyncHost,
  ContainerMoveIntentSyncInput,
  ContainerMoveIntentSyncState,
} from "./types";

function hasRemoteContainerMetadataState(
  containerState: ContainerState,
): boolean {
  return (
    typeof containerState.record.documentId === "string" &&
    containerState.record.documentId.length > 0 &&
    typeof containerState.record.accessStateHash === "string" &&
    containerState.record.accessStateHash.length > 0 &&
    typeof containerState.container.metadataDocumentId === "string" &&
    containerState.container.metadataDocumentId.length > 0
  );
}

async function recordPendingMoveIntentError(input: {
  blocked?: boolean | undefined;
  containerId: string;
  message: string;
  state: ContainerMoveIntentSyncState;
}) {
  const execSql = input.state.runtime.infra.execSql;
  await input.state.persistence.recordMoveIntentError(execSql, {
    blocked: input.blocked,
    containerId: input.containerId,
    message: input.message,
  });
}

async function markMoveIntentSynced(input: {
  containerId: string;
  state: ContainerMoveIntentSyncState;
}) {
  const execSql = input.state.runtime.infra.execSql;
  await input.state.persistence.markMoveIntentSynced(
    execSql,
    input.containerId,
  );
}

async function resolveMoveIntentLocalUpdatedAt(input: {
  containerId: string;
  remoteUpdatedAt: string;
  state: ContainerMoveIntentSyncState;
}): Promise<string> {
  const previousLocalUpdatedAt =
    input.state.containersById.get(input.containerId)?.container
      .localUpdatedAt ?? null;
  if (
    !previousLocalUpdatedAt ||
    previousLocalUpdatedAt.localeCompare(input.remoteUpdatedAt) <= 0
  ) {
    return input.remoteUpdatedAt;
  }

  const execSql = input.state.runtime.infra.execSql;
  const containersWithPendingMetadataUpdates =
    await input.state.persistence.listContainerIdsWithPendingUpdates(execSql, [
      input.containerId,
    ]);

  return containersWithPendingMetadataUpdates.includes(input.containerId)
    ? previousLocalUpdatedAt
    : input.remoteUpdatedAt;
}

async function persistAcceptedMoveIntent(input: {
  host: ContainerMoveIntentSyncHost;
  intent: ContainerMoveIntentSyncInput["intent"];
  moved: RemoteContainer;
  state: ContainerMoveIntentSyncState;
}): Promise<void> {
  const { host, intent, moved, state } = input;
  const containerState = state.containersById.get(intent.containerId);
  if (!containerState) {
    return;
  }

  await state.runtime.util.cacheReferencedPrincipalPolicies(
    moved.metadataReferencedPrincipals ?? [],
  );
  const localUpdatedAt = await resolveMoveIntentLocalUpdatedAt({
    containerId: intent.containerId,
    remoteUpdatedAt: moved.updatedAt,
    state,
  });
  containerState.container = {
    ...containerState.container,
    createdAt: moved.createdAt,
    serverCreatedAt: moved.createdAt,
    serverUpdatedAt: moved.updatedAt,
    updatedAt: moved.updatedAt,
  };
  containerState.record = await host.persistContainerState(
    containerState,
    {
      accessEpoch: moved.metadataAccessEpoch,
      accessStateHash: moved.metadataAccessStateHash,
      documentId: moved.metadataDocumentId,
      metadataDocumentId: moved.metadataDocumentId,
      organizationId: moved.organizationId,
      parentId: moved.parentId,
      systemSlot: moved.systemSlot ?? null,
    },
    false,
    {
      localUpdatedAt,
      serverTimestamps: {
        createdAt: moved.createdAt,
        updatedAt: moved.updatedAt,
      },
    },
  );
  containerState.container = {
    ...containerState.container,
    metadataDocumentId: moved.metadataDocumentId,
    organizationId: moved.organizationId,
    parentId: moved.parentId,
  };
  await markMoveIntentSynced({
    containerId: intent.containerId,
    state,
  });
}

async function trySyncPendingContainerMoveIntent(
  input: ContainerMoveIntentSyncInput,
): Promise<"moved" | "blocked" | "failed"> {
  const { host, intent, state } = input;
  const containerState = state.containersById.get(intent.containerId);
  const parentState = state.containersById.get(intent.parentContainerId);

  if (!containerState) {
    await recordPendingMoveIntentError({
      blocked: true,
      containerId: intent.containerId,
      message: "Container move intent references a missing local container",
      state,
    });
    return "failed";
  }
  if (!parentState) {
    await recordPendingMoveIntentError({
      blocked: true,
      containerId: intent.containerId,
      message:
        "Container move intent references a missing destination parent container",
      state,
    });
    return "failed";
  }
  if (!hasRemoteContainerMetadataState(containerState)) {
    await recordPendingMoveIntentError({
      blocked: true,
      containerId: intent.containerId,
      message: "Container move source is not synced",
      state,
    });
    return "failed";
  }
  if (!hasRemoteContainerMetadataState(parentState)) {
    await recordPendingMoveIntentError({
      containerId: intent.containerId,
      message: "Container move destination parent is not synced yet",
      state,
    });
    return "blocked";
  }

  const moved = await moveRemoteContainer({
    containerId: intent.containerId,
    parentContainerId: intent.parentContainerId,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
  });
  if (!moved) {
    await recordPendingMoveIntentError({
      containerId: intent.containerId,
      message: "Remote container move was rejected or unavailable",
      state,
    });
    return "failed";
  }

  await persistAcceptedMoveIntent({
    host,
    intent,
    moved,
    state,
  });
  state.runtime.util.log(
    `Container contents: synced queued container move ${intent.containerId}`,
  );
  return "moved";
}

export async function syncPendingContainerMoveIntents(input: {
  host: ContainerMoveIntentSyncHost;
  state: ContainerMoveIntentSyncState;
}): Promise<number> {
  const { host, state } = input;
  const execSql = state.runtime.infra.execSql;
  const pendingIntents =
    await state.persistence.listPendingMoveIntents(execSql);
  let movedCount = 0;

  for (const intent of pendingIntents) {
    const result = await trySyncPendingContainerMoveIntent({
      host,
      intent,
      state,
    });

    if (result === "moved") {
      movedCount += 1;
    }
  }

  return movedCount;
}
