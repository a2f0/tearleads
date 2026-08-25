import { errorMessage } from "../../../data/errorMessage";
import { reportAndRethrowKeyingVerificationError } from "../../../data/keyingProjectionVerification/error";
import { createRuntimePrincipalPolicyWarmer } from "../../principals/runtimePolicyWarmer";
import { installContainerMetadataRecord } from "../metadataPersistence";
import type { RemoteContainer } from "../remoteHydration";
import { hasRemoteContainerMetadataState } from "../remoteHydration/reconciliation";
import { moveRemoteContainer } from "./remote";
import type {
  ContainerMoveIntentSyncHost,
  ContainerMoveIntentSyncInput,
  ContainerMoveIntentSyncState,
} from "./types";

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
  expectedUpdatedAt: string;
  state: ContainerMoveIntentSyncState;
}) {
  const execSql = input.state.runtime.infra.execSql;
  await input.state.persistence.markMoveIntentSynced(execSql, {
    containerId: input.containerId,
    expectedUpdatedAt: input.expectedUpdatedAt,
  });
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

export async function persistAcceptedMoveIntent(input: {
  host: ContainerMoveIntentSyncHost;
  intent: ContainerMoveIntentSyncInput["intent"];
  moved: RemoteContainer;
  state: ContainerMoveIntentSyncState;
}): Promise<boolean> {
  const { host, intent, moved, state } = input;
  const containerState = state.containersById.get(intent.containerId);
  if (!containerState) {
    return false;
  }

  await createRuntimePrincipalPolicyWarmer(state.runtime)({
    organizationId: moved.organizationId,
    references: moved.metadataReferencedPrincipals,
  });
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
  const persistenceResult = await host.persistContainerState(
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
  if (persistenceResult.status !== "persisted") return false;
  const { record: nextRecord } = persistenceResult;
  installContainerMetadataRecord(containerState, nextRecord);
  containerState.container = {
    ...containerState.container,
    metadataDocumentId: moved.metadataDocumentId,
    organizationId: moved.organizationId,
    parentId: moved.parentId,
  };
  await markMoveIntentSynced({
    containerId: intent.containerId,
    expectedUpdatedAt: intent.updatedAt,
    state,
  });
  return true;
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
  if (input.isRemoteSyncBlocked(containerState.container.organizationId)) {
    return "blocked";
  }
  if (!hasRemoteContainerMetadataState(containerState)) {
    // Source not synced yet is TRANSIENT, exactly like the destination case
    // below: the source's own create intent syncs first (createIntentSync runs
    // before moveIntentSync in a pass), but if that create fails on this pass
    // the source still lacks remote metadata here. Keep the intent 'pending'
    // (not 'blocked') so the queue reports a retryable failure rather than a
    // missing-dependency block; either way listUnsyncedMoveIntents replays it
    // once the create lands.
    await recordPendingMoveIntentError({
      containerId: intent.containerId,
      message: "Container move source is not synced yet",
      state,
    });
    return "blocked";
  }
  if (!hasRemoteContainerMetadataState(parentState)) {
    await recordPendingMoveIntentError({
      containerId: intent.containerId,
      message: "Container move destination parent is not synced yet",
      state,
    });
    return "blocked";
  }

  try {
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

    const persisted = await persistAcceptedMoveIntent({
      host,
      intent,
      moved,
      state,
    });
    if (!persisted) {
      return "failed";
    }
    state.runtime.util.log(
      `Container contents: synced queued container move ${intent.containerId}`,
    );
    return "moved";
  } catch (error: unknown) {
    await reportAndRethrowKeyingVerificationError(
      error,
      state.runtime.util.reportSecurityIncident,
      {
        objectId: intent.containerId,
        objectKind: "container",
        operation: "container.move.replay",
        organizationId: parentState.container.organizationId,
      },
    );
    const message = errorMessage(error);
    await recordPendingMoveIntentError({
      containerId: intent.containerId,
      message: `Failed to sync container move: ${message}`,
      state,
    });
    return "failed";
  }
}

export async function syncPendingContainerMoveIntents(input: {
  host: ContainerMoveIntentSyncHost;
  isRemoteSyncBlocked: (organizationId: string) => boolean;
  state: ContainerMoveIntentSyncState;
}): Promise<number> {
  const { host, state } = input;
  const execSql = state.runtime.infra.execSql;
  const pendingIntents =
    await state.persistence.listUnsyncedMoveIntents(execSql);
  let movedCount = 0;

  for (const intent of pendingIntents) {
    const result = await trySyncPendingContainerMoveIntent({
      host,
      isRemoteSyncBlocked: input.isRemoteSyncBlocked,
      intent,
      state,
    });

    if (result === "moved") {
      movedCount += 1;
    }
  }

  return movedCount;
}
