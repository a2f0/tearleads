import { and, eq, sql } from "drizzle-orm";
import {
  DOCUMENT_SYNC_PULL_RECOVERY_REQUIRED,
  type DocumentSyncPullContinuation,
  serializeDocumentSyncPullContinuation,
} from "../documents/shared/pullContinuation";
import type { DocumentRecord } from "./documentPersistenceTypes";
import { loadDocumentRecord } from "./documentRecordPersistence";
import { documentProjectionTables, documents, documentTables } from "./schema";
import { getClientSQLitePersistenceRuntime } from "./sqlitePersistenceRuntime";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "./sqlSchema";

export function ensureDocumentTables(execSql: ExecSql): Promise<void> {
  return ensureSqlTables(execSql, documentTables);
}

export function ensureDocumentProjectionTables(
  execSql: ExecSql,
): Promise<void> {
  return ensureSqlTables(execSql, documentProjectionTables);
}

/** Replace only the exact rejected continuation with a durable recovery marker. */
export async function invalidateDocumentSyncPullContinuation(
  execSql: ExecSql,
  input: {
    accessEpoch: number;
    accessStateHash: string | null;
    appKind: string;
    continuation: DocumentSyncPullContinuation;
    contentKeyBundle: string | null;
    documentId: string;
    documentKekTargets: string | null;
    documentManifestBundle: string | null;
    lastCommitLsn: string | null;
    localId: string;
  },
): Promise<DocumentRecord | null> {
  await ensureDocumentTables(execSql);
  const expectedContinuation = serializeDocumentSyncPullContinuation(
    input.continuation,
  );
  if (expectedContinuation === null) return null;
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    const { db } = getClientSQLitePersistenceRuntime(lockedExecSql);
    await db
      .update(documents)
      .set({ pullContinuation: DOCUMENT_SYNC_PULL_RECOVERY_REQUIRED })
      .where(
        and(
          eq(documents.appKind, input.appKind),
          eq(documents.localId, input.localId),
          eq(documents.documentId, input.documentId),
          eq(documents.accessEpoch, input.accessEpoch),
          sql`${documents.accessStateHash} IS ${input.accessStateHash}`,
          sql`${documents.contentKeyBundle} IS ${input.contentKeyBundle}`,
          sql`${documents.documentKekTargets} IS ${input.documentKekTargets}`,
          sql`${documents.documentManifestBundle} IS ${input.documentManifestBundle}`,
          sql`${documents.lastCommitLsn} IS ${input.lastCommitLsn}`,
          eq(documents.pullContinuation, expectedContinuation),
        ),
      )
      .run();
    return loadDocumentRecord(lockedExecSql, {
      appKind: input.appKind,
      localId: input.localId,
    });
  });
}

export {
  deleteDocumentPendingUpdate,
  deleteDocumentPendingUpdates,
  enqueueDocumentPendingUpdate,
  enqueueDocumentPendingUpdateWithHistory,
  listDocumentPendingUpdates,
  MAX_PENDING_UPDATE_REKEYS,
  rekeyDocumentPendingUpdate,
  resetDocumentPendingUpdateRekeyBudget,
} from "./documentPendingUpdatePersistence";
export type {
  DocumentRecord,
  DocumentScope,
  PendingUpdateFields,
  PendingUpdateRecord,
} from "./documentPersistenceTypes";
export {
  deleteDocumentRecord,
  documentRecordSelection,
  findLocalIdByDocumentId,
  loadDocumentRecord,
  mapSelectedDocumentRecord,
} from "./documentRecordPersistence";
export {
  clearDocumentSyncFailure,
  hasRecordedTerminalSyncFailures,
  recordDocumentSyncFailure,
} from "./documentSyncFailurePersistence";
