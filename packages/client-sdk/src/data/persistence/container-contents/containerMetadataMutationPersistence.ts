import { and, eq, or } from "drizzle-orm";
import { documentSyncPullContinuationsEqual } from "../../documents/shared/sync/pullContinuation";
import {
  inLocalIntentLane,
  LOCAL_INTENT_LANES,
  localIntents,
} from "../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { runSerializedSqlMutation } from "../../sqlite/sqlSchema";
import {
  enqueueDocumentPendingUpdate,
  type PendingUpdateFields,
} from "../documents/records";
import {
  hasQueuedDocumentUpdates,
  settleQueuedDocumentUpdatesInTransaction,
} from "../documents/records/documentPendingUpdatePersistence";
import { clearDocumentSyncFailureInTransaction } from "../documents/records/documentSyncFailurePersistence";
import { resetAccessDiscovery } from "./containerAccessDiscovery";
import {
  assertHeldContainerBinding,
  heldContainerBinding,
} from "./containerBinding";
import type {
  ContainerContentsPersistence,
  ContainerMetadataRecord,
  StoredContainerState,
} from "./containerContentsPersistenceTypes";
import { settleContainerCreateIntentRevision } from "./containerCreateIntentSettlement";
import {
  ContainerCreateIntentSupersededError,
  deleteContainerMoveIntentRevision,
} from "./containerIntentPersistence";
import {
  getContainerMetadataScope,
  saveContainerContentsContainerRows,
  selectContainerMetadataRecord,
} from "./containerMetadataRows";
import {
  type ContainerRecord,
  loadContainerById,
} from "./containerPersistence";
import { CONTAINER_METADATA_APP_KIND } from "./dormantContainerMetadata";

function sameNullableValue(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return (left ?? null) === (right ?? null);
}

function committedMetadataMutationResult(input: {
  container: ContainerRecord;
  createIntentSettled: boolean;
  moveIntentSettled: boolean;
}) {
  return {
    committed: true as const,
    container: input.container,
    ...(input.createIntentSettled
      ? { createIntentSettled: true as const }
      : {}),
    ...(input.moveIntentSettled ? { moveIntentSettled: true as const } : {}),
  };
}

function sameMetadataSecurityIdentity(
  current: ContainerMetadataRecord,
  expected: ContainerMetadataRecord,
): boolean {
  return (
    current.id === expected.id &&
    current.documentId === expected.documentId &&
    current.accessEpoch === expected.accessEpoch &&
    sameNullableValue(current.accessStateHash, expected.accessStateHash) &&
    sameNullableValue(current.contentKeyBundle, expected.contentKeyBundle) &&
    sameNullableValue(
      current.documentKekTargets,
      expected.documentKekTargets,
    ) &&
    sameNullableValue(
      current.documentManifestBundle,
      expected.documentManifestBundle,
    )
  );
}

function sameMetadataRecord(
  current: ContainerMetadataRecord,
  expected: ContainerMetadataRecord,
): boolean {
  return (
    sameMetadataSecurityIdentity(current, expected) &&
    sameNullableValue(current.lastCommitLsn, expected.lastCommitLsn) &&
    current.metadataUpdates === expected.metadataUpdates &&
    current.snapshotEndVersion === expected.snapshotEndVersion &&
    documentSyncPullContinuationsEqual(
      current.pullContinuation,
      expected.pullContinuation,
    ) &&
    Boolean(current.pullContinuationRecoveryRequired) ===
      Boolean(expected.pullContinuationRecoveryRequired)
  );
}

function sameContainerRecord(
  current: ContainerRecord,
  expected: ContainerRecord,
): boolean {
  return (
    current.id === expected.id &&
    current.parentId === expected.parentId &&
    current.organizationId === expected.organizationId &&
    current.metadataDocumentId === expected.metadataDocumentId &&
    (current.systemSlot ?? null) === (expected.systemSlot ?? null) &&
    (current.effectiveAccessLevel ?? null) ===
      (expected.effectiveAccessLevel ?? null) &&
    (current.localUpdatedAt ?? null) === (expected.localUpdatedAt ?? null) &&
    (current.serverCreatedAt ?? null) === (expected.serverCreatedAt ?? null) &&
    (current.serverUpdatedAt ?? null) === (expected.serverUpdatedAt ?? null) &&
    current.name === expected.name &&
    (current.icon ?? null) === (expected.icon ?? null)
  );
}

async function loadStoredContainerState(
  execSql: Parameters<
    ContainerContentsPersistence["loadContainerMetadataState"]
  >[0],
  containerId: string,
): Promise<StoredContainerState | null> {
  const container = await loadContainerById(execSql, containerId);
  if (!container) return null;
  return {
    container,
    record: await selectContainerMetadataRecord(execSql, containerId),
  };
}

async function deleteAcceptedPendingUpdates(
  tx: ClientSQLiteTransactionScope,
  containerId: string,
  ids: readonly string[],
): Promise<void> {
  await settleQueuedDocumentUpdatesInTransaction(
    tx,
    getContainerMetadataScope(containerId),
    ids,
  );
}

function clearMetadataSyncFailure(
  tx: ClientSQLiteTransactionScope,
  containerId: string,
): Promise<void> {
  return clearDocumentSyncFailureInTransaction(tx, {
    appKind: CONTAINER_METADATA_APP_KIND,
    localId: containerId,
  });
}

async function hasPendingUpdates(
  tx: ClientSQLiteTransactionScope,
  containerId: string,
): Promise<boolean> {
  return hasQueuedDocumentUpdates(tx, getContainerMetadataScope(containerId));
}

async function hasPendingStructuralIntent(
  tx: ClientSQLiteTransactionScope,
  containerId: string,
): Promise<boolean> {
  // A pending create or any surviving (unsynced) move of this container.
  const structural = await tx
    .select({ id: localIntents.id })
    .from(localIntents)
    .where(
      and(
        eq(localIntents.subjectId, containerId),
        or(
          and(
            inLocalIntentLane(LOCAL_INTENT_LANES.containerCreate),
            eq(localIntents.syncStatus, "pending"),
          ),
          inLocalIntentLane(LOCAL_INTENT_LANES.containerMove),
        ),
      ),
    )
    .limit(1);
  return structural.length > 0;
}

async function enqueuePendingUpdate(
  execSql: Parameters<
    ContainerContentsPersistence["commitMetadataMutation"]
  >[0],
  containerId: string,
  pendingUpdate: PendingUpdateFields | undefined,
): Promise<void> {
  if (!pendingUpdate) return;
  await enqueueDocumentPendingUpdate(
    execSql,
    getContainerMetadataScope(containerId),
    pendingUpdate,
  );
}

type CommitMetadataMutationInput = Parameters<
  ContainerContentsPersistence["commitMetadataMutation"]
>[1];

function staleServerMutationResult(
  currentState: StoredContainerState | null,
  input: CommitMetadataMutationInput,
) {
  const incomingServerUpdatedAt =
    input.saveOptions?.serverTimestamps?.updatedAt;
  const hasOlderContainerTimestamp =
    incomingServerUpdatedAt != null &&
    currentState?.container.serverUpdatedAt != null &&
    currentState.container.serverUpdatedAt > incomingServerUpdatedAt;
  const hasOlderMetadataAccessEpoch =
    currentState?.record != null &&
    currentState.record.documentId === input.record.documentId &&
    currentState.record.accessEpoch > input.record.accessEpoch;
  return currentState?.record &&
    (hasOlderContainerTimestamp || hasOlderMetadataAccessEpoch)
    ? {
        committed: false as const,
        currentState,
        staleServerState: true as const,
      }
    : null;
}

function metadataMutationStateMatches(
  currentState: StoredContainerState | null,
  input: CommitMetadataMutationInput,
): currentState is StoredContainerState & {
  record: ContainerMetadataRecord;
} {
  return Boolean(
    currentState?.record &&
      sameContainerRecord(currentState.container, input.expectedContainer) &&
      sameMetadataRecord(currentState.record, input.expectedRecord),
  );
}

async function rejectMetadataMutationConflict(input: {
  currentState: StoredContainerState | null;
  mutation: CommitMetadataMutationInput;
  tx: ClientSQLiteTransactionScope;
}) {
  const { currentState, mutation, tx } = input;
  if (
    currentState?.record &&
    mutation.settleAcceptedPendingOnConflict &&
    sameMetadataSecurityIdentity(currentState.record, mutation.expectedRecord)
  ) {
    await deleteAcceptedPendingUpdates(
      tx,
      mutation.container.id,
      mutation.acceptedPendingUpdateIds,
    );
  }
  return { committed: false as const, currentState };
}

async function prepareContainerMutationWrite(input: {
  currentContainer: ContainerRecord;
  mutation: CommitMetadataMutationInput;
  tx: ClientSQLiteTransactionScope;
}): Promise<{ container: ContainerRecord; localUpdatedAt: string }> {
  const { currentContainer, mutation, tx } = input;
  const requestedLocalUpdatedAt =
    mutation.saveOptions?.localUpdatedAt ??
    mutation.saveOptions?.updatedAt ??
    new Date().toISOString();
  // Nothing below writes local intents, so one read answers both checks.
  let pendingStructuralIntent: boolean | undefined;
  const hasStructuralIntent = async () => {
    pendingStructuralIntent ??= await hasPendingStructuralIntent(
      tx,
      mutation.container.id,
    );
    return pendingStructuralIntent;
  };
  const preserveDurableStructure =
    mutation.preserveDurableStructureWhenPending === true &&
    (await hasStructuralIntent());
  // Syncing metadata is not a local edit. Preserve the durable edit clock,
  // including an edit another pane made while this request was in flight.
  const localUpdatedAt =
    preserveDurableStructure || mutation.settleAcceptedPendingOnConflict
      ? (currentContainer.localUpdatedAt ?? requestedLocalUpdatedAt)
      : requestedLocalUpdatedAt;
  const structurallyRebasedContainer = preserveDurableStructure
    ? { ...mutation.container, parentId: currentContainer.parentId }
    : mutation.container;
  const didSettleOutgoing =
    mutation.acceptedPendingUpdateIds.length > 0 &&
    !(await hasPendingUpdates(tx, mutation.container.id)) &&
    !(await hasStructuralIntent());
  // Only container responses establish the server's structural clock. A
  // metadata acknowledgement supplies no such timestamp; marking it with our
  // wall clock would make later valid listings appear stale forever.
  return {
    container: structurallyRebasedContainer,
    localUpdatedAt: didSettleOutgoing
      ? (currentContainer.serverUpdatedAt ?? localUpdatedAt)
      : localUpdatedAt,
  };
}

/** Server acknowledgements and listings cannot rebind a held folder. */
function assertMutationKeepsHeldBinding(
  currentState: StoredContainerState & { record: ContainerMetadataRecord },
  input: CommitMetadataMutationInput,
): void {
  const recordDocumentIds =
    input.record.documentId === currentState.record.documentId
      ? []
      : [input.record.documentId];
  assertHeldContainerBinding(heldContainerBinding(currentState), {
    organizationId: input.container.organizationId,
    metadataDocumentIds: [
      input.container.metadataDocumentId,
      ...recordDocumentIds,
    ],
  });
}

async function settleMetadataStructuralIntents(
  tx: ClientSQLiteTransactionScope,
  input: CommitMetadataMutationInput,
): Promise<void> {
  if (
    input.createIntentSettlement &&
    (await settleContainerCreateIntentRevision({
      ...input.createIntentSettlement,
      tx,
    })) === "superseded"
  ) {
    throw new ContainerCreateIntentSupersededError();
  }
  if (input.moveIntentSettlement) {
    if (
      !(await deleteContainerMoveIntentRevision({
        ...input.moveIntentSettlement,
        tx,
      }))
    ) {
      throw new Error(
        "Container move intent was superseded before local settlement",
      );
    }
  }
}

export async function commitStoredMetadataMutation(
  execSql: Parameters<
    ContainerContentsPersistence["commitMetadataMutation"]
  >[0],
  input: Parameters<ContainerContentsPersistence["commitMetadataMutation"]>[1],
) {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    const outcome = await getClientSQLitePersistenceRuntime(
      lockedExecSql,
    ).guardedTransaction(
      async (tx) => {
        const currentState = await loadStoredContainerState(
          lockedExecSql,
          input.container.id,
        );
        const staleServerResult = staleServerMutationResult(
          currentState,
          input,
        );
        if (staleServerResult) return staleServerResult;
        if (!metadataMutationStateMatches(currentState, input)) {
          return rejectMetadataMutationConflict({
            currentState,
            mutation: input,
            tx,
          });
        }
        assertMutationKeepsHeldBinding(currentState, input);

        await enqueuePendingUpdate(
          lockedExecSql,
          input.container.id,
          input.pendingUpdate,
        );
        await deleteAcceptedPendingUpdates(
          tx,
          input.container.id,
          input.acceptedPendingUpdateIds,
        );
        if (input.clearSyncFailure) {
          await clearMetadataSyncFailure(tx, input.container.id);
        }
        const { container, localUpdatedAt } =
          await prepareContainerMutationWrite({
            currentContainer: currentState.container,
            mutation: input,
            tx,
          });
        const saved = await saveContainerContentsContainerRows({
          container,
          createIntent: input.saveOptions?.createIntent,
          localUpdatedAt,
          moveIntent: input.saveOptions?.moveIntent,
          record: input.record,
          serverTimestamps: input.saveOptions?.serverTimestamps,
          tx,
        });
        await resetAccessDiscovery(tx, currentState.container, saved);
        await settleMetadataStructuralIntents(tx, input);
        return committedMetadataMutationResult({
          container: saved,
          createIntentSettled: input.createIntentSettlement !== undefined,
          moveIntentSettled: input.moveIntentSettlement !== undefined,
        });
      },
      () => !input.stillCurrent || input.stillCurrent(),
      { behavior: "immediate" },
    );
    if (outcome.committed && outcome.result) {
      return outcome.result;
    }
    return {
      committed: false as const,
      currentState: await loadStoredContainerState(
        lockedExecSql,
        input.container.id,
      ),
    };
  });
}

export async function settleStoredMetadataPendingUpdates(
  execSql: Parameters<
    ContainerContentsPersistence["settleAcceptedMetadataPendingUpdates"]
  >[0],
  input: Parameters<
    ContainerContentsPersistence["settleAcceptedMetadataPendingUpdates"]
  >[1],
) {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    const outcome = await getClientSQLitePersistenceRuntime(
      lockedExecSql,
    ).guardedTransaction(
      async (tx) => {
        const currentState = await loadStoredContainerState(
          lockedExecSql,
          input.containerId,
        );
        if (
          currentState?.record &&
          sameMetadataSecurityIdentity(
            currentState.record,
            input.expectedRecord,
          )
        ) {
          await deleteAcceptedPendingUpdates(
            tx,
            input.containerId,
            input.pendingUpdateIds,
          );
        }
        return currentState;
      },
      () => !input.stillCurrent || input.stillCurrent(),
      { behavior: "immediate" },
    );
    return outcome.committed ? outcome.result : null;
  });
}
