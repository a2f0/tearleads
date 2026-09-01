import { and, eq, inArray } from "drizzle-orm";
import { documentSyncPullContinuationsEqual } from "../../documents/shared/pullContinuation";
import {
  enqueueDocumentPendingUpdate,
  type PendingUpdateFields,
} from "../../sqlite/documentPersistence";
import {
  containerCreateIntents,
  containerMoveIntents,
  documentPendingUpdates,
  documentSyncFailures,
} from "../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { runSerializedSqlMutation } from "../../sqlite/sqlSchema";
import {
  type ContainerRecord,
  loadContainerById,
} from "../containers/containerPersistence";
import { getLatestTimestamp } from "../latestTimestamp";
import type {
  ContainerContentsPersistence,
  ContainerMetadataRecord,
  StoredContainerState,
} from "./containerContentsPersistenceTypes";
import {
  getContainerMetadataScope,
  saveContainerContentsContainerRows,
  selectContainerMetadataRecord,
} from "./containerMetadataRows";
import { CONTAINER_METADATA_APP_KIND } from "./dormantContainerMetadata";

function sameNullableValue(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return (left ?? null) === (right ?? null);
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
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return;
  await tx
    .delete(documentPendingUpdates)
    .where(
      and(
        eq(documentPendingUpdates.appKind, CONTAINER_METADATA_APP_KIND),
        eq(documentPendingUpdates.localId, containerId),
        inArray(documentPendingUpdates.id, uniqueIds),
      ),
    )
    .run();
}

async function clearSyncFailure(
  tx: ClientSQLiteTransactionScope,
  containerId: string,
): Promise<void> {
  await tx
    .delete(documentSyncFailures)
    .where(
      and(
        eq(documentSyncFailures.appKind, CONTAINER_METADATA_APP_KIND),
        eq(documentSyncFailures.localId, containerId),
      ),
    )
    .run();
}

async function hasPendingUpdates(
  tx: ClientSQLiteTransactionScope,
  containerId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: documentPendingUpdates.id })
    .from(documentPendingUpdates)
    .where(
      and(
        eq(documentPendingUpdates.appKind, CONTAINER_METADATA_APP_KIND),
        eq(documentPendingUpdates.localId, containerId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function hasPendingStructuralIntent(
  tx: ClientSQLiteTransactionScope,
  containerId: string,
): Promise<boolean> {
  const pendingCreates = await tx
    .select({ id: containerCreateIntents.id })
    .from(containerCreateIntents)
    .where(
      and(
        eq(containerCreateIntents.containerId, containerId),
        eq(containerCreateIntents.syncStatus, "pending"),
      ),
    )
    .limit(1);
  if (pendingCreates.length > 0) return true;

  const unsyncedMoves = await tx
    .select({ id: containerMoveIntents.id })
    .from(containerMoveIntents)
    .where(eq(containerMoveIntents.containerId, containerId))
    .limit(1);
  return unsyncedMoves.length > 0;
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
  const preserveDurableStructure =
    mutation.preserveDurableStructureWhenPending === true &&
    (await hasPendingStructuralIntent(tx, mutation.container.id));
  const localUpdatedAt = preserveDurableStructure
    ? (currentContainer.localUpdatedAt ?? requestedLocalUpdatedAt)
    : requestedLocalUpdatedAt;
  const structurallyRebasedContainer = preserveDurableStructure
    ? { ...mutation.container, parentId: currentContainer.parentId }
    : mutation.container;
  const didSettleOutgoing =
    mutation.acceptedPendingUpdateIds.length > 0 &&
    !(await hasPendingUpdates(tx, mutation.container.id));
  const container = didSettleOutgoing
    ? {
        ...structurallyRebasedContainer,
        serverUpdatedAt: getLatestTimestamp(
          structurallyRebasedContainer.serverUpdatedAt,
          localUpdatedAt,
        ),
      }
    : structurallyRebasedContainer;
  return { container, localUpdatedAt };
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
          await clearSyncFailure(tx, input.container.id);
        }
        const { container, localUpdatedAt } =
          await prepareContainerMutationWrite({
            currentContainer: currentState.container,
            mutation: input,
            tx,
          });
        const savedContainer = await saveContainerContentsContainerRows({
          container,
          createIntent: input.saveOptions?.createIntent,
          localUpdatedAt,
          moveIntent: input.saveOptions?.moveIntent,
          record: input.record,
          serverTimestamps: input.saveOptions?.serverTimestamps,
          tx,
        });
        return { committed: true as const, container: savedContainer };
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
  return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
    getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
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
      { behavior: "immediate" },
    ),
  );
}
