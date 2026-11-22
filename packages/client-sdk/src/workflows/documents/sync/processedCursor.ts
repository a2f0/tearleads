import { validateDocumentSyncUpdateImports } from "../../../data/documents/shared/sync/documentSyncImportVerdicts";
import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/sync/documentSyncTypes";
import {
  type DocumentSyncImportVerdicts,
  documentVerdictJudge,
} from "../../../data/documents/shared/sync/documentUpdateVerdict";
import type { DocumentScope } from "../../../data/persistence/documents/records";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import {
  type DocumentSyncVerdictInput,
  type DocumentSyncVerdictOutcome,
  readRecordedImportVoids,
  readSendableProcessedCursor,
  recordDocumentSyncVerdictsInTransaction,
} from "../../../data/persistence/documents/records/documentSyncVerdictPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "../../../data/sqlite/sqlSchema";
import type { WorkflowRuntimeUtilInput } from "../../shared/runtimeInput";

/**
 * The processed cursor a document's next pull may carry: the upper bound of
 * its last completed pull, while the persisted frontier still covers the
 * version recorded with it and every verdict behind it came from the running
 * judge. Otherwise undefined, and the pull goes by version alone.
 */
export async function readProcessedCursorForSync(
  execSql: ExecSql,
  input: {
    readonly documentId: string;
    readonly frontier: string;
    readonly scope: DocumentScope;
  },
): Promise<string | undefined> {
  await ensureDocumentTables(execSql);
  return readSendableProcessedCursor(
    getClientSQLitePersistenceRuntime(execSql).db,
    { ...input, judge: documentVerdictJudge() },
  );
}

/**
 * Judges a sync page's imports against `currentDocument`. An update this
 * scope already voided at the import stage, under the running judge and the
 * content key this pass holds for its epoch, stays void without being
 * imported again: a re-served void costs nothing, so a pass that deferred
 * part of its page makes progress on the next one.
 */
export async function judgeDocumentSyncImports(input: {
  readonly currentDocument: Parameters<
    typeof validateDocumentSyncUpdateImports
  >[0]["currentDocument"];
  readonly execSql: ExecSql;
  readonly result: Pick<
    SyncRemoteDocumentResult,
    "contentKeyFingerprintsByEpoch" | "decryptedUpdates" | "response"
  >;
  readonly scope: DocumentScope;
}): Promise<DocumentSyncImportVerdicts> {
  const { result } = input;
  await ensureDocumentTables(input.execSql);
  const recorded = await readRecordedImportVoids(
    getClientSQLitePersistenceRuntime(input.execSql).db,
    {
      judge: documentVerdictJudge(),
      scope: input.scope,
      updateIds: result.decryptedUpdates.map((update) => update.id),
    },
  );
  const knownVoids = new Set(
    recorded.flatMap((row) =>
      row.contentKeyEpoch === null ||
      result.contentKeyFingerprintsByEpoch.get(row.contentKeyEpoch) ===
        row.keyFingerprint
        ? [row.updateId]
        : [],
    ),
  );
  return validateDocumentSyncUpdateImports({
    currentDocument: input.currentDocument,
    decryptedUpdates: result.decryptedUpdates,
    knownVoids,
    responseUpdates: result.response.updates,
  });
}

/**
 * Records a sync page's voids and, when its pull completed, the cursor, in
 * the transaction that saves the page's record. Call it as the save's commit
 * side effect, so the cursor never runs ahead of the frontier it describes.
 */
export function recordDocumentSyncVerdicts(
  transactionExecSql: ExecSql,
  input: {
    readonly scope: DocumentScope;
    readonly synced: SyncRemoteDocumentResult;
  },
): Promise<DocumentSyncVerdictOutcome> {
  return recordDocumentSyncVerdictsInTransaction(
    getClientSQLitePersistenceRuntime(transactionExecSql).db,
    documentSyncVerdictInput({ ...input, advancesCursor: true }),
  );
}

/**
 * The verdicts of one sync page. A scope that keeps no cursor (container
 * metadata, which pulls by version alone) records its voids only.
 */
function documentSyncVerdictInput(input: {
  readonly advancesCursor: boolean;
  readonly scope: DocumentScope;
  readonly synced: SyncRemoteDocumentResult;
}): DocumentSyncVerdictInput {
  const { synced } = input;
  return {
    acceptedUpdateIds: synced.decryptedUpdates.map((update) => update.id),
    documentId: synced.plan.documentId,
    judge: documentVerdictJudge(),
    keyFingerprintsByEpoch: synced.contentKeyFingerprintsByEpoch,
    now: new Date().toISOString(),
    pullPage: input.advancesCursor
      ? {
          first: synced.plan.request.pullCursor === undefined,
          last: !synced.hasIncompletePull,
          sentCursor: synced.plan.request.processedThroughUpdateId ?? null,
          throughUpdateId: synced.response.pullPage?.throughUpdateId ?? null,
        }
      : undefined,
    scope: input.scope,
    voids: synced.voidedUpdates.map((voided) => ({
      contentKeyEpoch: voided.contentKeyEpoch,
      message: voided.error.message,
      stage: voided.stage,
      updateId: voided.updateId,
    })),
  };
}

/**
 * Reports each void the first time a device records it. A void does not
 * fail the pass or set the document's sync failure: the writer's record is
 * at fault, and every other update still applies.
 */
export function reportDocumentSyncVoids(
  logError: WorkflowRuntimeUtilInput["logError"] | undefined,
  synced: Pick<SyncRemoteDocumentResult, "voidedUpdates">,
  newlyVoidedUpdateIds: readonly string[],
): void {
  if (!logError || newlyVoidedUpdateIds.length === 0) return;
  const newlyVoided = new Set(newlyVoidedUpdateIds);
  for (const voided of synced.voidedUpdates) {
    if (!newlyVoided.has(voided.updateId)) continue;
    try {
      void Promise.resolve(
        logError("Documents: sync update voided", voided.error),
      ).catch(() => undefined);
    } catch {
      // Hosts may throw synchronously or return a rejected promise.
    }
  }
}

/**
 * Records a sync page's voids for a scope that keeps no cursor (container
 * metadata, which pulls by version alone) in its own serialized transaction,
 * then reports each new one while the pass is still current.
 */
export async function recordUncursoredDocumentSyncVerdicts(input: {
  readonly execSql: ExecSql;
  readonly isCurrent: () => boolean;
  readonly logError?: WorkflowRuntimeUtilInput["logError"] | undefined;
  readonly scope: DocumentScope;
  readonly synced: SyncRemoteDocumentResult;
}): Promise<void> {
  const { synced } = input;
  if (synced.voidedUpdates.length === 0 && synced.decryptedUpdates.length === 0)
    return;
  await ensureDocumentTables(input.execSql);
  const outcome = await runSerializedSqlMutation(
    input.execSql,
    (lockedExecSql) =>
      getClientSQLitePersistenceRuntime(lockedExecSql).guardedTransaction(
        (tx) =>
          recordDocumentSyncVerdictsInTransaction(
            tx,
            documentSyncVerdictInput({
              advancesCursor: false,
              scope: input.scope,
              synced,
            }),
          ),
        input.isCurrent,
      ),
  );
  if (!outcome.committed || !outcome.result || !input.isCurrent()) return;
  reportDocumentSyncVoids(
    input.logError,
    synced,
    outcome.result.newlyVoidedUpdateIds,
  );
}
