import { and, eq, inArray } from "drizzle-orm";
import { documentSyncPullContinuationsEqual } from "../../../documents/shared/pullContinuation";
import {
  appendDocumentHistoryUpdates,
  replaceDocumentHistoryCheckpoint,
} from "../../../sqlite/documentHistoryPersistence";
import { insertDocumentPendingUpdateWithHistoryInTransaction } from "../../../sqlite/documentPendingUpdatePersistence";
import { documentPendingUpdates } from "../../../sqlite/schema";
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
import { resolveDocumentSaveTimestamp, saveDocumentRows } from "./documentRows";

function sameNullableValue(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return (left ?? null) === (right ?? null);
}

function sameDocumentSecurityIdentity(
  current: StoredDocumentRecord,
  expected: StoredDocumentRecord,
): boolean {
  return (
    current.id === expected.id &&
    current.documentId === expected.documentId &&
    current.containerId === expected.containerId &&
    current.accessEpoch === expected.accessEpoch &&
    sameNullableValue(current.accessStateHash, expected.accessStateHash) &&
    (current.effectiveAccessLevel ?? null) ===
      (expected.effectiveAccessLevel ?? null) &&
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

function sameExpectedDocumentRecord(
  current: StoredDocumentRecord,
  expected: StoredDocumentRecord,
): boolean {
  return (
    sameDocumentSecurityIdentity(current, expected) &&
    sameNullableValue(current.lastCommitLsn, expected.lastCommitLsn) &&
    current.snapshotEndVersion === expected.snapshotEndVersion &&
    sameNullableValue(
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
): Promise<void> {
  if (input.historyCheckpoint) {
    await replaceDocumentHistoryCheckpoint(
      execSql,
      { appKind: DOCUMENTS_APP_KIND, localId: input.document.id },
      input.historyCheckpoint,
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
        await appendMutationHistory(lockedExecSql, input);
        await insertPendingUpdate(tx, input.document.id, input.pendingUpdate);
        await deleteAcceptedPendingUpdates(
          tx,
          input.document.id,
          input.acceptedPendingUpdateIds,
        );
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
