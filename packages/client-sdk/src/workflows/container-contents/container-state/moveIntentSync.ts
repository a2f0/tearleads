import { errorMessage } from "../../../data/errorMessage";
import { reportAndRethrowKeyingVerificationError } from "../../../data/keyingProjectionVerification/error";
import { createRuntimePrincipalPolicyWarmer } from "../../principals/runtimePolicyWarmer";
import { installContainerMetadataRecord } from "../metadataPersistence";
import {
  createDetachedContainerMetadataState,
  installDetachedContainerMetadataState,
} from "../metadataStateIsolation";
import type { ContainerState, RemoteContainer } from "../remoteHydration";
import { hasRemoteContainerMetadataState } from "../remoteHydration/reconciliation";
import { moveRemoteContainer } from "./remote";
import type {
  ContainerMoveIntentSyncHost,
  ContainerMoveIntentSyncInput,
  ContainerMoveIntentSyncState,
} from "./types";

type MoveIntentSyncResult = "abandoned" | "blocked" | "failed" | "moved";

function currentMoveResult<
  Result extends Exclude<MoveIntentSyncResult, "abandoned">,
>(isCurrent: () => boolean, result: Result): "abandoned" | Result {
  return isCurrent() ? result : "abandoned";
}

async function recordPendingMoveIntentError(input: {
  blocked?: boolean | undefined;
  containerId: string;
  isCurrent: () => boolean;
  message: string;
  state: ContainerMoveIntentSyncState;
}): Promise<boolean> {
  if (!input.isCurrent()) {
    return false;
  }
  const execSql = input.state.runtime.infra.execSql;
  await input.state.persistence.recordMoveIntentError(execSql, {
    blocked: input.blocked,
    containerId: input.containerId,
    message: input.message,
  });
  return input.isCurrent();
}

async function markMoveIntentSynced(input: {
  containerId: string;
  expectedUpdatedAt: string;
  isCurrent: () => boolean;
  state: ContainerMoveIntentSyncState;
}): Promise<boolean> {
  if (!input.isCurrent()) {
    return false;
  }
  const execSql = input.state.runtime.infra.execSql;
  await input.state.persistence.markMoveIntentSynced(execSql, {
    containerId: input.containerId,
    expectedUpdatedAt: input.expectedUpdatedAt,
  });
  return input.isCurrent();
}

async function resolveMoveIntentLocalUpdatedAt(input: {
  containerId: string;
  isCurrent: () => boolean;
  remoteUpdatedAt: string;
  state: ContainerMoveIntentSyncState;
}): Promise<string | null> {
  if (!input.isCurrent()) {
    return null;
  }
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
  if (!input.isCurrent()) {
    return null;
  }

  return containersWithPendingMetadataUpdates.includes(input.containerId)
    ? previousLocalUpdatedAt
    : input.remoteUpdatedAt;
}

export async function persistAcceptedMoveIntent(input: {
  host: ContainerMoveIntentSyncHost;
  isCurrent: () => boolean;
  intent: ContainerMoveIntentSyncInput["intent"];
  moved: RemoteContainer;
  state: ContainerMoveIntentSyncState;
}): Promise<boolean> {
  const { host, intent, moved, state } = input;
  if (!input.isCurrent()) {
    return false;
  }
  const containerState = state.containersById.get(intent.containerId);
  if (!containerState) {
    return false;
  }

  await createRuntimePrincipalPolicyWarmer(state.runtime)({
    organizationId: moved.organizationId,
    references: moved.metadataReferencedPrincipals,
  });
  if (!input.isCurrent()) {
    return false;
  }
  const localUpdatedAt = await resolveMoveIntentLocalUpdatedAt({
    containerId: intent.containerId,
    isCurrent: input.isCurrent,
    remoteUpdatedAt: moved.updatedAt,
    state,
  });
  if (!input.isCurrent() || localUpdatedAt === null) {
    return false;
  }
  const persistenceCandidate =
    await createDetachedContainerMetadataState(containerState);
  if (!input.isCurrent()) {
    return false;
  }
  persistenceCandidate.container = {
    ...persistenceCandidate.container,
    createdAt: moved.createdAt,
    serverCreatedAt: moved.createdAt,
    serverUpdatedAt: moved.updatedAt,
    updatedAt: moved.updatedAt,
  };
  const persistenceResult = await host.persistContainerState(
    persistenceCandidate,
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
    {
      expectedStateWhenMissing: containerState,
      isCurrent: input.isCurrent,
    },
  );
  if (!input.isCurrent() || persistenceResult.status === "stale-generation") {
    return false;
  }
  if (persistenceResult.status !== "persisted") return false;
  const { record: nextRecord } = persistenceResult;
  if (
    !(await markMoveIntentSynced({
      containerId: intent.containerId,
      expectedUpdatedAt: intent.updatedAt,
      isCurrent: input.isCurrent,
      state,
    }))
  ) {
    return false;
  }

  installDetachedContainerMetadataState(containerState, persistenceCandidate);
  installContainerMetadataRecord(containerState, nextRecord);
  containerState.container = {
    ...containerState.container,
    metadataDocumentId: moved.metadataDocumentId,
    organizationId: moved.organizationId,
    parentId: moved.parentId,
  };
  return true;
}

async function movePendingRemoteContainer(input: {
  parentState: ContainerState;
  syncInput: ContainerMoveIntentSyncInput;
}): Promise<MoveIntentSyncResult> {
  const { parentState, syncInput } = input;
  const { host, intent, state } = syncInput;
  try {
    const moved = await moveRemoteContainer({
      containerId: intent.containerId,
      parentContainerId: intent.parentContainerId,
      resolveProjectionUserKey: state.resolveProjectionUserKey,
      runtime: state.runtime,
    });
    if (!syncInput.isCurrent()) {
      return "abandoned";
    }
    if (!moved) {
      await recordPendingMoveIntentError({
        containerId: intent.containerId,
        isCurrent: syncInput.isCurrent,
        message: "Remote container move was rejected or unavailable",
        state,
      });
      return currentMoveResult(syncInput.isCurrent, "failed");
    }

    const persisted = await persistAcceptedMoveIntent({
      host,
      isCurrent: syncInput.isCurrent,
      intent,
      moved,
      state,
    });
    if (!persisted) {
      return currentMoveResult(syncInput.isCurrent, "failed");
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
    if (!syncInput.isCurrent()) {
      return "abandoned";
    }
    await recordPendingMoveIntentError({
      containerId: intent.containerId,
      isCurrent: syncInput.isCurrent,
      message: `Failed to sync container move: ${errorMessage(error)}`,
      state,
    });
    return currentMoveResult(syncInput.isCurrent, "failed");
  }
}

async function trySyncPendingContainerMoveIntent(
  input: ContainerMoveIntentSyncInput,
): Promise<MoveIntentSyncResult> {
  const { intent, state } = input;
  if (!input.isCurrent()) {
    return "abandoned";
  }
  const containerState = state.containersById.get(intent.containerId);
  const parentState = state.containersById.get(intent.parentContainerId);

  if (!containerState) {
    await recordPendingMoveIntentError({
      blocked: true,
      containerId: intent.containerId,
      isCurrent: input.isCurrent,
      message: "Container move intent references a missing local container",
      state,
    });
    return currentMoveResult(input.isCurrent, "failed");
  }
  if (!parentState) {
    await recordPendingMoveIntentError({
      blocked: true,
      containerId: intent.containerId,
      isCurrent: input.isCurrent,
      message:
        "Container move intent references a missing destination parent container",
      state,
    });
    return currentMoveResult(input.isCurrent, "failed");
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
      isCurrent: input.isCurrent,
      message: "Container move source is not synced yet",
      state,
    });
    return currentMoveResult(input.isCurrent, "blocked");
  }
  if (!hasRemoteContainerMetadataState(parentState)) {
    await recordPendingMoveIntentError({
      containerId: intent.containerId,
      isCurrent: input.isCurrent,
      message: "Container move destination parent is not synced yet",
      state,
    });
    return currentMoveResult(input.isCurrent, "blocked");
  }

  return movePendingRemoteContainer({ parentState, syncInput: input });
}

export async function syncPendingContainerMoveIntents(input: {
  host: ContainerMoveIntentSyncHost;
  isCurrent: () => boolean;
  isRemoteSyncBlocked: (organizationId: string) => boolean;
  state: ContainerMoveIntentSyncState;
}): Promise<number> {
  if (!input.isCurrent()) {
    return 0;
  }
  const { host } = input;
  const state = { ...input.state };
  const execSql = state.runtime.infra.execSql;
  const pendingIntents =
    await state.persistence.listUnsyncedMoveIntents(execSql);
  if (!input.isCurrent()) {
    return 0;
  }
  let movedCount = 0;

  for (const intent of pendingIntents) {
    if (!input.isCurrent()) {
      return movedCount;
    }
    const result = await trySyncPendingContainerMoveIntent({
      host,
      isCurrent: input.isCurrent,
      isRemoteSyncBlocked: input.isRemoteSyncBlocked,
      intent,
      state,
    });
    if (result === "abandoned") {
      return movedCount;
    }

    if (result === "moved") {
      movedCount += 1;
    }
  }

  return movedCount;
}
