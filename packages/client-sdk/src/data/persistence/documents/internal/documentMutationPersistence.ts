import { base64ToBytes } from "@symcrypt/encoding";
import { getImportBlobMetadata, satisfiesVersionVector } from "@symcrypt/loro";
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

function sameExpectedDocumentRecord(
  current: StoredDocumentRecord,
  expected: StoredDocumentRecord,
): boolean {
  return (
    sameDocumentSecurityIdentity(current, expected) &&
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
    )
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
          input.historyCheckpoint.endVersionVector,
        )
      : {
          checkpointIds: [],
          hasOrdinaryPendingUpdates: false,
          tailIds: [],
        };
    if (
      input.historyCheckpoint.pruneCoveredLocalState &&
      coveredLocalState.hasOrdinaryPendingUpdates
    ) {
      throw new Error(
        "Document recovery found unproven pending updates before installation",
      );
    }
    const checkpointReplaced = await replaceDocumentHistoryCheckpoint(
      execSql,
      { appKind: DOCUMENTS_APP_KIND, localId: input.document.id },
      {
        ...input.historyCheckpoint,
        coveredTailIds: [
          ...new Set([
            ...input.historyCheckpoint.coveredTailIds,
            ...coveredLocalState.tailIds,
          ]),
        ],
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
  documentVersion: string,
): Promise<{
  checkpointIds: string[];
  hasOrdinaryPendingUpdates: boolean;
  tailIds: string[];
}> {
  const scope = and(
    eq(documentPendingUpdates.appKind, DOCUMENTS_APP_KIND),
    eq(documentPendingUpdates.localId, localId),
  );
  const pendingUpdates = await tx
    .select({
      id: documentPendingUpdates.id,
      sourceVersionVector: documentPendingUpdates.sourceVersionVector,
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
  return {
    checkpointIds: pendingUpdates.flatMap((row) =>
      row.id !== null &&
      row.sourceVersionVector !== null &&
      satisfiesVersionVector(documentVersion, row.sourceVersionVector)
        ? [row.id]
        : [],
    ),
    hasOrdinaryPendingUpdates: pendingUpdates.some(
      (row) => row.sourceVersionVector === null,
    ),
    tailIds: tail.flatMap((row) => {
      if (row.id === null) return [];
      try {
        const metadata = getImportBlobMetadata(base64ToBytes(row.updateData));
        return satisfiesVersionVector(
          documentVersion,
          metadata.partialEndVersionVector,
        )
          ? [row.id]
          : [];
      } catch {
        return [row.id];
      }
    }),
  };
}

export async function commitStoredDocumentMutation(
  execSql: Parameters<DocumentsPersistence["commitDocumentMutation"]>[0],
  input: Parameters<DocumentsPersistence["commitDocumentMutation"]>[1],
  saveClientProjection: Parameters<
    DocumentsPersistence["commitDocumentMutation"]
  >[2],
  loadDocument: DocumentsPersistence["loadDocument"],
) {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
    getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
      async (tx) => {
        const currentRecord = await loadDocument(
          lockedExecSql,
          input.document.id,
        );
        if (input.stillCurrent && !input.stillCurrent()) {
          return { committed: false as const, currentRecord };
        }
        if (
          !currentRecord ||
          !sameExpectedDocumentRecord(currentRecord, input.expectedRecord)
        ) {
          await settleMutationConflict({ currentRecord, mutation: input, tx });
          return { committed: false as const, currentRecord };
        }

        if (input.attachmentRemoval) {
          await applyStoredAttachmentRemoval({
            localId: input.document.id,
            removal: input.attachmentRemoval,
            tx,
          });
        }
        if (input.attachmentStaging) {
          await upsertStoredAttachmentStagingRows({
            createdAt: new Date().toISOString(),
            localId: input.document.id,
            staging: input.attachmentStaging,
            tx,
          });
        }
        await appendMutationHistory(lockedExecSql, input, tx);
        await insertPendingUpdate(tx, input.document.id, input.pendingUpdate);
        await deleteAcceptedPendingUpdates(
          tx,
          input.document.id,
          input.acceptedPendingUpdateIds,
        );
        if (input.clearSyncFailure) {
          await clearSyncFailure(tx, input.document.id);
        }
        const updatedAt = await resolveDocumentSaveTimestamp({
          document: input.document,
          options:
            input.updatedAt === undefined
              ? undefined
              : { updatedAt: input.updatedAt },
          tx,
        });
        await saveDocumentRows({ document: input.document, tx, updatedAt });
        await saveClientProjection(lockedExecSql, updatedAt);
        return { committed: true as const, updatedAt };
      },
      { behavior: "immediate" },
    ),
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
        sameDocumentSecurityIdentity(currentRecord, input.expectedRecord)
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
