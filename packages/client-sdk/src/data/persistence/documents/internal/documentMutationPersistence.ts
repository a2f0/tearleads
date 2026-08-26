import { base64ToBytes } from "@symcrypt/encoding";
import {
  createDocument,
  importSnapshot,
  updateMatchesDocumentHistory,
} from "@symcrypt/loro";
import { and, eq, inArray } from "drizzle-orm";
import { documentSyncPullContinuationsEqual } from "../../../documents/shared/pullContinuation";
import {
  appendDocumentHistoryUpdates,
  replaceDocumentHistoryCheckpoint,
} from "../../../sqlite/documentHistoryPersistence";
import { insertDocumentPendingUpdateWithHistoryInTransaction } from "../../../sqlite/documentPendingUpdatePersistence";
import {
  documentHistoryUpdates,
  documentPendingUpdates,
  documentSyncFailures,
} from "../../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../../sqlite/sqlitePersistenceRuntime";
import { runSerializedSqlMutation } from "../../../sqlite/sqlSchema";
import type { DocumentsPersistence, StoredDocumentRecord } from "../types";
import {
  applyStoredAttachmentRemoval,
  upsertStoredAttachmentStagingRows,
} from "./attachmentStagingPersistence";
import { DOCUMENTS_APP_KIND } from "./constants";
import {
  sameDocumentSecurityIdentity,
  sameNullableDocumentValue,
} from "./documentRecordIdentity";
import { resolveDocumentSaveTimestamp, saveDocumentRows } from "./documentRows";

function sameRecoveryGeneration(
  current: StoredDocumentRecord,
  expected: StoredDocumentRecord,
): boolean {
  return (
    (current.recoveryGeneration ?? 0) === (expected.recoveryGeneration ?? 0)
  );
}

function sameExpectedDocumentRecord(
  current: StoredDocumentRecord,
  expected: StoredDocumentRecord,
): boolean {
  return (
    sameDocumentSecurityIdentity(current, expected) &&
    sameRecoveryGeneration(current, expected) &&
    sameNullableDocumentValue(current.lastCommitLsn, expected.lastCommitLsn) &&
    current.snapshotEndVersion === expected.snapshotEndVersion &&
    sameNullableDocumentValue(
      current.pendingBaseVersion,
      expected.pendingBaseVersion,
    ) &&
    documentSyncPullContinuationsEqual(
      current.pullContinuation,
      expected.pullContinuation,
    ) &&
    Boolean(current.pullContinuationRecoveryRequired) ===
      Boolean(expected.pullContinuationRecoveryRequired) &&
    (current.documentKind ?? null) === (expected.documentKind ?? null) &&
    current.text === expected.text &&
    (current.title ?? null) === (expected.title ?? null)
  );
}

async function deleteAcceptedPendingUpdates(
  tx: ClientSQLiteTransactionScope,
  localId: string,
  ids: readonly string[],
): Promise<void> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return;
  await tx
    .delete(documentPendingUpdates)
    .where(
      and(
        eq(documentPendingUpdates.appKind, DOCUMENTS_APP_KIND),
        eq(documentPendingUpdates.localId, localId),
        inArray(documentPendingUpdates.id, uniqueIds),
      ),
    )
    .run();
}

async function clearSyncFailure(
  tx: ClientSQLiteTransactionScope,
  localId: string,
): Promise<void> {
  await tx
    .delete(documentSyncFailures)
    .where(
      and(
        eq(documentSyncFailures.appKind, DOCUMENTS_APP_KIND),
        eq(documentSyncFailures.localId, localId),
      ),
    )
    .run();
}

async function insertPendingUpdate(
  tx: ClientSQLiteTransactionScope,
  documentId: string,
  pendingUpdate: Parameters<
    DocumentsPersistence["commitDocumentMutation"]
  >[1]["pendingUpdate"],
): Promise<void> {
  if (!pendingUpdate) return;
  await insertDocumentPendingUpdateWithHistoryInTransaction({
    createdAt: new Date().toISOString(),
    pendingUpdate,
    scope: { appKind: DOCUMENTS_APP_KIND, localId: documentId },
    tx,
  });
}

async function settleMutationConflict(input: {
  currentRecord: StoredDocumentRecord | null;
  mutation: Parameters<DocumentsPersistence["commitDocumentMutation"]>[1];
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  if (
    input.currentRecord &&
    input.mutation.settleAcceptedPendingOnConflict &&
    sameDocumentSecurityIdentity(
      input.currentRecord,
      input.mutation.expectedRecord,
    ) &&
    sameRecoveryGeneration(input.currentRecord, input.mutation.expectedRecord)
  ) {
    await deleteAcceptedPendingUpdates(
      input.tx,
      input.mutation.document.id,
      input.mutation.acceptedPendingUpdateIds,
    );
  }
}

async function appendMutationHistory(
  execSql: Parameters<DocumentsPersistence["commitDocumentMutation"]>[0],
  input: Parameters<DocumentsPersistence["commitDocumentMutation"]>[1],
  tx: ClientSQLiteTransactionScope,
): Promise<void> {
  if (input.historyCheckpoint) {
    const coveredLocalState = input.historyCheckpoint.pruneCoveredLocalState
      ? await findCoveredRecoveryLocalState(
          tx,
          input.document.id,
          input.historyCheckpoint.snapshot,
        )
      : {
          checkpointIds: [],
          hasOrdinaryPendingUpdates: false,
          hasUnprunablePendingUpdates: false,
          hasUnverifiedHistoryTail: false,
          tailIds: [],
        };
    if (
      input.historyCheckpoint.pruneCoveredLocalState &&
      (coveredLocalState.hasOrdinaryPendingUpdates ||
        coveredLocalState.hasUnprunablePendingUpdates)
    ) {
      throw new Error(
        "Document recovery found unproven pending updates before installation",
      );
    }
    if (
      input.historyCheckpoint.pruneCoveredLocalState &&
      coveredLocalState.hasUnverifiedHistoryTail
    ) {
      throw new Error(
        "Document recovery found unverified history tail before installation",
      );
    }
    const checkpointReplaced = await replaceDocumentHistoryCheckpoint(
      execSql,
      { appKind: DOCUMENTS_APP_KIND, localId: input.document.id },
      {
        ...input.historyCheckpoint,
        coveredTailIds: input.historyCheckpoint.pruneCoveredLocalState
          ? coveredLocalState.tailIds
          : input.historyCheckpoint.coveredTailIds,
      },
    );
    if (input.historyCheckpoint.pruneCoveredLocalState && !checkpointReplaced) {
      throw new Error(
        "Document recovery checkpoint was superseded before installation",
      );
    }
    await deleteAcceptedPendingUpdates(
      tx,
      input.document.id,
      coveredLocalState.checkpointIds,
    );
  }
  if (input.historyUpdates && input.historyUpdates.length > 0) {
    await appendDocumentHistoryUpdates(
      execSql,
      { appKind: DOCUMENTS_APP_KIND, localId: input.document.id },
      input.historyUpdates,
      input.historyUpdateOrigin ?? "local",
    );
  }
}

async function findCoveredRecoveryLocalState(
  tx: ClientSQLiteTransactionScope,
  localId: string,
  recoverySnapshot: string,
): Promise<{
  checkpointIds: string[];
  hasOrdinaryPendingUpdates: boolean;
  hasUnprunablePendingUpdates: boolean;
  hasUnverifiedHistoryTail: boolean;
  tailIds: string[];
}> {
  const recoveredDocument = await createDocument(
    `recovery-tail-verification:${localId}`,
  );
  try {
    importSnapshot(recoveredDocument, base64ToBytes(recoverySnapshot));
    const scope = and(
      eq(documentPendingUpdates.appKind, DOCUMENTS_APP_KIND),
      eq(documentPendingUpdates.localId, localId),
    );
    const pendingUpdates = await tx
      .select({
        id: documentPendingUpdates.id,
        sourceVersionVector: documentPendingUpdates.sourceVersionVector,
        updateData: documentPendingUpdates.updateData,
      })
      .from(documentPendingUpdates)
      .where(scope);
    const tail = await tx
      .select({
        id: documentHistoryUpdates.id,
        updateData: documentHistoryUpdates.updateData,
      })
      .from(documentHistoryUpdates)
      .where(
        and(
          eq(documentHistoryUpdates.appKind, DOCUMENTS_APP_KIND),
          eq(documentHistoryUpdates.localId, localId),
        ),
      );
    const checkpointUpdateData = new Set(
      pendingUpdates.flatMap((row) =>
        row.id === null || row.sourceVersionVector === null
          ? []
          : [row.updateData],
      ),
    );
    let hasUnverifiedHistoryTail = false;
    const tailIds = tail.flatMap((row) => {
      if (row.id === null) {
        // An unverifiable row identity cannot participate in the guarded
        // delete, so accepting it would leave a stale recovery redirect.
        hasUnverifiedHistoryTail = true;
        return [];
      }
      if (checkpointUpdateData.has(row.updateData)) return [row.id];
      try {
        if (
          updateMatchesDocumentHistory(
            recoveredDocument,
            base64ToBytes(row.updateData),
          )
        ) {
          return [row.id];
        }
      } catch {
        // Fall through: malformed history is not proven by the rebuild.
      }
      hasUnverifiedHistoryTail = true;
      return [];
    });
    return {
      checkpointIds: pendingUpdates.flatMap((row) =>
        row.id !== null && row.sourceVersionVector !== null ? [row.id] : [],
      ),
      hasOrdinaryPendingUpdates: pendingUpdates.some(
        (row) => row.sourceVersionVector === null,
      ),
      hasUnprunablePendingUpdates: pendingUpdates.some(
        (row) => row.id === null,
      ),
      hasUnverifiedHistoryTail,
      tailIds,
    };
  } finally {
    recoveredDocument.free();
  }
}

type CommitDocumentMutationInput = Parameters<
  DocumentsPersistence["commitDocumentMutation"]
>[1];
type SaveClientProjection = Parameters<
  DocumentsPersistence["commitDocumentMutation"]
>[2];

async function applyStoredDocumentMutation(input: {
  lockedExecSql: Parameters<DocumentsPersistence["commitDocumentMutation"]>[0];
  mutation: CommitDocumentMutationInput;
  saveClientProjection: SaveClientProjection;
  tx: ClientSQLiteTransactionScope;
  loadDocument: DocumentsPersistence["loadDocument"];
}) {
  const { lockedExecSql, mutation, tx } = input;
  const currentRecord = await input.loadDocument(
    lockedExecSql,
    mutation.document.id,
  );
  if (mutation.stillCurrent && !mutation.stillCurrent()) {
    return { committed: false as const, currentRecord };
  }
  if (
    !currentRecord ||
    !sameExpectedDocumentRecord(currentRecord, mutation.expectedRecord)
  ) {
    await settleMutationConflict({ currentRecord, mutation, tx });
    return { committed: false as const, currentRecord };
  }

  if (mutation.attachmentRemoval) {
    await applyStoredAttachmentRemoval({
      localId: mutation.document.id,
      removal: mutation.attachmentRemoval,
      tx,
    });
  }
  if (mutation.attachmentStaging) {
    await upsertStoredAttachmentStagingRows({
      createdAt: new Date().toISOString(),
      localId: mutation.document.id,
      staging: mutation.attachmentStaging,
      tx,
    });
  }
  await appendMutationHistory(lockedExecSql, mutation, tx);
  await insertPendingUpdate(tx, mutation.document.id, mutation.pendingUpdate);
  await deleteAcceptedPendingUpdates(
    tx,
    mutation.document.id,
    mutation.acceptedPendingUpdateIds,
  );
  if (mutation.clearSyncFailure) {
    await clearSyncFailure(tx, mutation.document.id);
  }
  const updatedAt = await resolveDocumentSaveTimestamp({
    document: mutation.document,
    options:
      mutation.updatedAt === undefined
        ? undefined
        : { updatedAt: mutation.updatedAt },
    tx,
  });
  await saveDocumentRows({ document: mutation.document, tx, updatedAt });
  await input.saveClientProjection(lockedExecSql, updatedAt);
  return { committed: true as const, updatedAt };
}

async function runStoredDocumentMutationTransaction(input: {
  lockedExecSql: Parameters<DocumentsPersistence["commitDocumentMutation"]>[0];
  mutation: CommitDocumentMutationInput;
  saveClientProjection: SaveClientProjection;
  loadDocument: DocumentsPersistence["loadDocument"];
}) {
  const outcome = await getClientSQLitePersistenceRuntime(
    input.lockedExecSql,
  ).guardedTransaction(
    (tx) => applyStoredDocumentMutation({ ...input, tx }),
    () => !input.mutation.stillCurrent || input.mutation.stillCurrent(),
    { behavior: "immediate" },
  );
  if (outcome.committed && outcome.result) {
    return outcome.result;
  }
  return {
    committed: false as const,
    currentRecord: await input.loadDocument(
      input.lockedExecSql,
      input.mutation.document.id,
    ),
  };
}

export async function commitStoredDocumentMutation(
  execSql: Parameters<DocumentsPersistence["commitDocumentMutation"]>[0],
  input: CommitDocumentMutationInput,
  saveClientProjection: SaveClientProjection,
  loadDocument: DocumentsPersistence["loadDocument"],
) {
  return runSerializedSqlMutation(execSql, (lockedExecSql) =>
    runStoredDocumentMutationTransaction({
      lockedExecSql,
      loadDocument,
      mutation: input,
      saveClientProjection,
    }),
  );
}

export async function settleStoredDocumentPendingUpdates(
  execSql: Parameters<DocumentsPersistence["settleAcceptedPendingUpdates"]>[0],
  input: Parameters<DocumentsPersistence["settleAcceptedPendingUpdates"]>[1],
  loadDocument: DocumentsPersistence["loadDocument"],
) {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
    getClientSQLitePersistenceRuntime(lockedExecSql).transaction(async (tx) => {
      const currentRecord = await loadDocument(
        lockedExecSql,
        input.expectedRecord.id,
      );
      if (
        currentRecord &&
        sameDocumentSecurityIdentity(currentRecord, input.expectedRecord) &&
        sameRecoveryGeneration(currentRecord, input.expectedRecord)
      ) {
        await deleteAcceptedPendingUpdates(
          tx,
          input.expectedRecord.id,
          input.pendingUpdateIds,
        );
      }
      return currentRecord;
    }),
  );
}
