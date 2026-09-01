import { errorMessage } from "../../../data/errorMessage";
import { reportAndRethrowKeyingVerificationError } from "../../../data/keyingProjectionVerification/error";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { createRuntimePrincipalPolicyWarmer } from "../../principals/runtimePolicyWarmer";
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
  expectedIntentId: string;
  expectedUpdatedAt: string;
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
    expectedIntentId: input.expectedIntentId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    message: input.message,
    stillCurrent: input.isCurrent,
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

async function settleAcceptedMoveIntentAfterPersistence(input: {
  alreadySettled: boolean;
  execSql: ExecSql;
  intent: ContainerMoveIntentSyncInput["intent"];
  isCurrent: () => boolean;
  state: ContainerMoveIntentSyncState;
}): Promise<boolean> {
  if (input.alreadySettled) {
    return true;
  }
  const settled = await input.state.persistence.markMoveIntentRevisionSynced(
    input.execSql,
    {
      containerId: input.intent.containerId,
      expectedIntentId: input.intent.id,
      expectedUpdatedAt: input.intent.updatedAt,
      stillCurrent: input.isCurrent,
    },
  );
  return input.isCurrent() && settled;
}

export async function persistAcceptedMoveIntent(input: {
  host: ContainerMoveIntentSyncHost;
  isCurrent: () => boolean;
  intent: ContainerMoveIntentSyncInput["intent"];
  moved: RemoteContainer;
  requestRemoteReconciliation: (parentContainerId: string | null) => void;
  state: ContainerMoveIntentSyncState;
}): Promise<boolean> {
  const { host, intent, moved, state } = input;
  const abandon = () => {
    input.requestRemoteReconciliation(moved.parentId);
    return false;
  };
  if (!input.isCurrent()) {
    return abandon();
  }
  const containerState = state.containersById.get(intent.containerId);
  if (!containerState) {
    return false;
  }

  await createRuntimePrincipalPolicyWarmer(state.runtime)({
    organizationId: moved.organizationId,
    references: moved.metadataReferencedPrincipals,
    stillCurrent: input.isCurrent,
  });
  if (!input.isCurrent()) {
    return abandon();
  }
  const localUpdatedAt = await resolveMoveIntentLocalUpdatedAt({
    containerId: intent.containerId,
    isCurrent: input.isCurrent,
    remoteUpdatedAt: moved.updatedAt,
    state,
  });
  if (!input.isCurrent() || localUpdatedAt === null) {
    return abandon();
  }
  const persistenceCandidate =
    await createDetachedContainerMetadataState(containerState);
  if (!input.isCurrent()) {
    return abandon();
  }
  persistenceCandidate.container = {
    ...persistenceCandidate.container,
    createdAt: moved.createdAt,
    serverCreatedAt: moved.createdAt,
    serverUpdatedAt: moved.updatedAt,
    updatedAt: moved.updatedAt,
  };
  const execSql = state.runtime.infra.execSql;
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
      moveIntentSettlement: {
        containerId: intent.containerId,
        expectedIntentId: intent.id,
        expectedUpdatedAt: intent.updatedAt,
      },
    },
  );
  if (!input.isCurrent() || persistenceResult.status === "stale-generation") {
    return abandon();
  }
  if (persistenceResult.status !== "persisted") return false;
  const intentSettled = await settleAcceptedMoveIntentAfterPersistence({
    alreadySettled: persistenceResult.moveIntentSettled === true,
    execSql,
    intent,
    isCurrent: input.isCurrent,
    state,
  });
  if (!intentSettled) return abandon();
  const { record: nextRecord } = persistenceResult;
  installDetachedContainerMetadataState(containerState, persistenceCandidate, {
    candidateRecord: nextRecord,
    preserveConcurrentMetadataEdit: true,
  });
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
  let remoteMoveApplied = false;
  let remoteParentId: string | null = intent.parentContainerId;
  const abandonAppliedMove = () => {
    if (remoteMoveApplied) {
      syncInput.requestRemoteReconciliation(remoteParentId);
    }
    return "abandoned" as const;
  };
  if (typeof state.persistence.markMoveIntentRevisionSynced !== "function") {
    await recordPendingMoveIntentError({
      containerId: intent.containerId,
      expectedIntentId: intent.id,
      expectedUpdatedAt: intent.updatedAt,
      isCurrent: syncInput.isCurrent,
      message: "Container move replay requires revision-CAS persistence",
      state,
    });
    return currentMoveResult(syncInput.isCurrent, "failed");
  }
  try {
    const moved = await moveRemoteContainer({
      containerId: intent.containerId,
      parentContainerId: intent.parentContainerId,
      resolveProjectionUserKey: state.resolveProjectionUserKey,
      runtime: state.runtime,
      stillCurrent: syncInput.isCurrent,
    });
    if (!moved) {
      if (!syncInput.isCurrent()) {
        syncInput.requestRemoteReconciliation(intent.parentContainerId);
        return "abandoned";
      }
      await recordPendingMoveIntentError({
        containerId: intent.containerId,
        expectedIntentId: intent.id,
        expectedUpdatedAt: intent.updatedAt,
        isCurrent: syncInput.isCurrent,
        message: "Remote container move was rejected or unavailable",
        state,
      });
      return currentMoveResult(syncInput.isCurrent, "failed");
    }
    remoteMoveApplied = true;
    remoteParentId = moved.parentId;
    if (!syncInput.isCurrent()) return abandonAppliedMove();

    const persisted = await persistAcceptedMoveIntent({
      host,
      isCurrent: syncInput.isCurrent,
      intent,
      moved,
      requestRemoteReconciliation: syncInput.requestRemoteReconciliation,
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
    if (!syncInput.isCurrent()) {
      return abandonAppliedMove();
    }
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
      return abandonAppliedMove();
    }
    await recordPendingMoveIntentError({
      containerId: intent.containerId,
      expectedIntentId: intent.id,
      expectedUpdatedAt: intent.updatedAt,
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
      expectedIntentId: intent.id,
      expectedUpdatedAt: intent.updatedAt,
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
      expectedIntentId: intent.id,
      expectedUpdatedAt: intent.updatedAt,
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
      expectedIntentId: intent.id,
      expectedUpdatedAt: intent.updatedAt,
      isCurrent: input.isCurrent,
      message: "Container move source is not synced yet",
      state,
    });
    return currentMoveResult(input.isCurrent, "blocked");
  }
  if (!hasRemoteContainerMetadataState(parentState)) {
    await recordPendingMoveIntentError({
      containerId: intent.containerId,
      expectedIntentId: intent.id,
      expectedUpdatedAt: intent.updatedAt,
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
  requestRemoteReconciliation: (parentContainerId: string | null) => void;
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
      requestRemoteReconciliation: input.requestRemoteReconciliation,
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
