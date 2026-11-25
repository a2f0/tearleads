import { validateDocumentSyncUpdateImports } from "../../../data/documents/shared/sync/documentSyncImportVerdicts";
import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/sync/documentSyncTypes";
import {
  type DocumentSyncImportVerdicts,
  type DocumentVoidStage,
  documentVerdictJudge,
} from "../../../data/documents/shared/sync/documentUpdateVerdict";
import {
  type LoroLifetimes,
  processLoroLifetimes,
} from "../../../data/documents/shared/sync/loroLifetime";
import {
  type LoroRuntimeAttempts,
  MAX_LORO_RUNTIME_ATTEMPTS,
  processLoroRuntimeFailures,
} from "../../../data/documents/shared/sync/loroRuntimeFailureLedger";
import type { DocumentScope } from "../../../data/persistence/documents/records";
import {
  ensureDocumentTables,
  recordCommittedSeedProgressInTransaction,
} from "../../../data/persistence/documents/records";
import {
  type DocumentSyncVerdictInput,
  type DocumentSyncVerdictOutcome,
  type RecordedImportVoid,
  readRecordedImportVoids,
  recordDocumentSyncVerdictsInTransaction,
} from "../../../data/persistence/documents/records/documentSyncVerdictPersistence";
import { readFinalVoidUpdateIds } from "../../../data/persistence/documents/records/finalVoidUpdates";
import { markLoroWindowsNotCountingInTransaction } from "../../../data/persistence/documents/records/loroWindowPersistence";
import { readProcessedCursorCoveredBy } from "../../../data/persistence/documents/records/processedCursorForVersion";
import {
  readSendableProcessedCursor,
  readSendableProcessedProgress,
} from "../../../data/persistence/documents/records/sendableProcessedCursor";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "../../../data/sqlite/sqlSchema";
import type { WorkflowRuntimeUtilInput } from "../../shared/runtimeInput";
import {
  type DocumentSyncLoroWindow,
  type LoroWindowOpening,
  noteDocumentSyncLoroWindowVerdicts,
  openDocumentSyncLoroWindow,
  stopCountingLoroWindows,
} from "./loroPassWindow";
import { reportQuietly } from "./reportQuietly";

/**
 * The processed cursor a document's next pull may carry: the upper bound of
 * its last completed pull, while the persisted frontier still covers the
 * version recorded with it and every verdict behind it came from the running
 * judge. Otherwise undefined, and the pull goes by version alone.
 *
 * The content key this pass holds is no input. The running judge accepts or
 * voids an update only under the key its writer-signed envelope commits to,
 * and a pass holding another key fails at that update and records no
 * verdict for it, so every verdict behind the cursor is the one the
 * committed key gives. A cursor recorded before readers checked the commitment carries an
 * older judge and is withheld. A pass that now holds another key for an
 * epoch cannot judge those updates differently: it can only fail on the
 * epoch's updates after the cursor. `ContentKeyCommitment.tla` checks this:
 * `Fetch` and `StaleKey` change a reader's keys and leave its cursor, and
 * `VerdictsAreCanonical` holds.
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
 * How many updates the pull behind `readProcessedCursorForSync`'s cursor
 * counted, or null when there is no sendable cursor or its count is unknown.
 * A listing count at or below it was read before that pull's bound, so it
 * owes no read.
 */
export async function readProcessedUpdateCountForSync(
  execSql: ExecSql,
  input: {
    readonly documentId: string;
    readonly frontier: string;
    readonly scope: DocumentScope;
  },
): Promise<number | null> {
  await ensureDocumentTables(execSql);
  const progress = await readSendableProcessedProgress(
    getClientSQLitePersistenceRuntime(execSql).db,
    { ...input, judge: documentVerdictJudge() },
  );
  return progress?.updateCount ?? null;
}

/**
 * Records the processed cursor a create's committed seed stands for, in the
 * transaction that saves the created record, after the save. The create made
 * the seed its document's only update and this device wrote it, so a
 * container listing that counts it owes no read of it. See
 * `recordCommittedSeedProgressInTransaction`.
 */
export function recordCommittedDocumentSeedProgress(
  transactionExecSql: ExecSql,
  input: {
    readonly documentId: string;
    readonly scope: DocumentScope;
    readonly seedUpdateId: string;
  },
): Promise<void> {
  return recordCommittedSeedProgressInTransaction(
    getClientSQLitePersistenceRuntime(transactionExecSql).db,
    { ...input, judge: documentVerdictJudge() },
  );
}

/**
 * The processed cursor an attachment bind or detach may carry with the
 * document version it cites, so the API skips the updates this device
 * already judged; undefined when no cursor's recorded version is covered by
 * `version`, and the API then weighs every committed update.
 *
 * It needs no content key: every verdict behind any cursor was reached under
 * the key its update's signed envelope commits to, which is the verdict every
 * reader reaches, so a cursor from any scope stands for the server's history.
 */
export async function readProcessedCursorForVersion(
  execSql: ExecSql,
  input: { readonly documentId: string; readonly version: string },
): Promise<string | undefined> {
  await ensureDocumentTables(execSql);
  return readProcessedCursorCoveredBy(
    getClientSQLitePersistenceRuntime(execSql).db,
    { ...input, judge: documentVerdictJudge() },
  );
}

/**
 * The updates of a server document this device voided for good under its
 * running judge. Readers of edit attribution leave them out, so an
 * operation a void update declared is credited to nobody rather than to it.
 */
export async function readFinalDocumentVoidUpdateIds(
  execSql: ExecSql,
  documentId: string,
): Promise<ReadonlySet<string>> {
  await ensureDocumentTables(execSql);
  return readFinalVoidUpdateIds(getClientSQLitePersistenceRuntime(execSql).db, {
    documentId,
    judge: documentVerdictJudge(),
  });
}

interface RecordedImportJudgements {
  /** Updates void at a stage the import judge decides, with the stage. */
  readonly knownVoids: ReadonlyMap<string, DocumentVoidStage>;
  /** Unsettled runtime failures: the lifetimes that have failed each. */
  readonly runtimeAttempts: ReadonlyMap<string, number>;
}

function isImportJudgeStage(stage: string): stage is DocumentVoidStage {
  return (
    stage === "loro_import" ||
    stage === "loro_metadata" ||
    stage === "loro_runtime"
  );
}

/**
 * Splits the recorded verdicts: a final void stays void without a Loro call,
 * and an unsettled runtime failure keeps its attempts.
 */
function recordedImportJudgements(
  recorded: readonly RecordedImportVoid[],
): RecordedImportJudgements {
  const knownVoids = new Map<string, DocumentVoidStage>();
  const runtimeAttempts = new Map<string, number>();
  for (const row of recorded) {
    if (!isImportJudgeStage(row.stage)) continue;
    const attempts = row.attempts ?? 0;
    if (row.stage === "loro_runtime" && attempts < MAX_LORO_RUNTIME_ATTEMPTS) {
      runtimeAttempts.set(row.updateId, attempts);
    } else {
      knownVoids.set(row.updateId, row.stage);
    }
  }
  return { knownVoids, runtimeAttempts };
}

async function readRecordedImportJudgements(input: {
  readonly execSql: ExecSql;
  readonly result: Pick<SyncRemoteDocumentResult, "decryptedUpdates">;
  readonly scope: DocumentScope;
}): Promise<RecordedImportJudgements> {
  await ensureDocumentTables(input.execSql);
  const recorded = await readRecordedImportVoids(
    getClientSQLitePersistenceRuntime(input.execSql).db,
    {
      judge: documentVerdictJudge(),
      scope: input.scope,
      updateIds: input.result.decryptedUpdates.map((update) => update.id),
    },
  );
  return recordedImportJudgements(recorded);
}

/**
 * The final voids this scope recorded for a page's updates under the running
 * judge: a judge that records nothing, such as a rotation's raw-history
 * judge, keeps them void without a Loro call.
 */
export async function readRecordedDocumentSyncVoids(input: {
  readonly execSql: ExecSql;
  readonly result: Pick<SyncRemoteDocumentResult, "decryptedUpdates">;
  readonly scope: DocumentScope;
}): Promise<ReadonlyMap<string, DocumentVoidStage>> {
  return (await readRecordedImportJudgements(input)).knownVoids;
}

/**
 * Judges a sync page's imports against `currentDocument`. An update this
 * scope already voided at a stage the import judge decides, under the
 * running judge, stays void without being read again: a re-served void costs nothing, so a pass
 * that deferred part of its page makes progress on the next one.
 *
 * Every Loro runtime failure is recorded before this returns, in its own
 * transaction: a trap can leave the module unusable, so the save that would
 * otherwise record it may fail, and an attempt that is never recorded would
 * be made again in every process.
 *
 * The update reads run inside the pass's `loroWindow`, which the page's
 * save closes (`loroPassWindow.ts`), opened once the reader's history is
 * built, so a death inside them is found by the next lifetime. The caller
 * claims the windows ended lifetimes left before its pull asks for the
 * page (`claimDocumentSyncOrphanWindows`), so their counts are recorded
 * first.
 */
export async function judgeDocumentSyncImports(input: {
  readonly currentDocument: Parameters<
    typeof validateDocumentSyncUpdateImports
  >[0]["currentDocument"];
  readonly documentId: string;
  readonly execSql: ExecSql;
  readonly isCurrent?: (() => boolean) | undefined;
  /** @internal This realm's lifetime; tests stand in another one. */
  readonly lifetimes?: LoroLifetimes | undefined;
  readonly logError?: WorkflowRuntimeUtilInput["logError"] | undefined;
  /** The pass's read window, which this page's save closes. */
  readonly loroWindow: DocumentSyncLoroWindow;
  readonly result: Pick<
    SyncRemoteDocumentResult,
    "decryptedUpdates" | "response"
  >;
  /** @internal This process's runtime failures; tests stand in a new one. */
  readonly runtimeLedger?: LoroRuntimeAttempts | undefined;
  readonly scope: DocumentScope;
}): Promise<DocumentSyncImportVerdicts> {
  const { result } = input;
  const ledger = input.runtimeLedger ?? processLoroRuntimeFailures;
  const lifetimes = input.lifetimes ?? processLoroLifetimes;
  const recorded = await readRecordedImportJudgements(input);
  const opened: { current: LoroWindowOpening } = { current: "none" };
  const verdicts = await validateDocumentSyncUpdateImports({
    ...recorded,
    beforeUpdateReads: async () => {
      opened.current = await openDocumentSyncLoroWindow({
        ...input,
        knownVoids: recorded.knownVoids,
        ledger,
        lifetimes,
        reads: { kind: "read" },
        window: input.loroWindow,
      });
    },
    currentDocument: input.currentDocument,
    decryptedUpdates: result.decryptedUpdates,
    lifetimes,
    responseUpdates: result.response.updates,
    runtimeLedger: ledger,
  });
  noteDocumentSyncLoroWindowVerdicts(input.loroWindow, verdicts);
  if (verdicts.runtimeFailures.length > 0) {
    await recordDocumentSyncRuntimeFailures({ ...input, lifetimes, verdicts });
  } else if (opened.current === "counting" && ledger.hasFailed()) {
    await stopCountingLoroWindows(input.execSql, lifetimes);
  }
  return verdicts;
}

async function recordDocumentSyncRuntimeFailures(input: {
  readonly documentId: string;
  readonly execSql: ExecSql;
  readonly isCurrent?: (() => boolean) | undefined;
  readonly lifetimes: LoroLifetimes;
  readonly logError?: WorkflowRuntimeUtilInput["logError"] | undefined;
  readonly scope: DocumentScope;
  readonly verdicts: DocumentSyncImportVerdicts;
}): Promise<void> {
  const isCurrent = input.isCurrent ?? (() => true);
  const failures = input.verdicts.runtimeFailures;
  const outcome = await runSerializedSqlMutation(
    input.execSql,
    (lockedExecSql) =>
      getClientSQLitePersistenceRuntime(lockedExecSql).guardedTransaction(
        async (tx) => {
          // This lifetime failed: a death later in it counts nothing more.
          await markLoroWindowsNotCountingInTransaction(tx, input.lifetimes.id);
          return recordDocumentSyncVerdictsInTransaction(tx, {
            acceptedUpdateIds: [],
            documentId: input.documentId,
            judge: documentVerdictJudge(),
            now: new Date().toISOString(),
            scope: input.scope,
            voids: failures.map((failure) => ({
              attempts: failure.attempts,
              message: failure.error.message,
              stage: "loro_runtime",
              updateId: failure.updateId,
            })),
          });
        },
        isCurrent,
      ),
  );
  if (!outcome.committed || !isCurrent()) return;
  for (const failure of failures) {
    if (!failure.counted) continue;
    reportQuietly(
      input.logError,
      `Documents: sync update failed the Loro runtime (attempt ${failure.attempts} of ${MAX_LORO_RUNTIME_ATTEMPTS}${failure.final ? "; voided" : ""})`,
      failure.error,
    );
  }
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
 * The verdicts of one sync page. A judge that keeps no cursor, such as a
 * rotation's raw-history judge, records its voids only.
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
    now: new Date().toISOString(),
    pullPage: input.advancesCursor
      ? {
          first: synced.plan.request.pullCursor === undefined,
          held: synced.hasHeldPull,
          last: !synced.hasIncompletePull,
          sentCursor: synced.plan.request.processedThroughUpdateId ?? null,
          throughUpdateCount: synced.response.pullPage?.throughUpdateCount ?? 0,
          throughUpdateId: synced.response.pullPage?.throughUpdateId ?? null,
        }
      : undefined,
    preemptions: synced.voidedUpdates.flatMap((voided) =>
      voided.preemptedPeerId === undefined
        ? []
        : [
            {
              authorFingerprint: voided.error.authorFingerprint,
              peerId: voided.preemptedPeerId,
              updateId: voided.updateId,
              writerUserId: voided.error.writerUserId,
            },
          ],
    ),
    scope: input.scope,
    voids: synced.voidedUpdates.map((voided) => ({
      // A served runtime void is final; its row may not be written yet.
      attempts:
        voided.stage === "loro_runtime" ? MAX_LORO_RUNTIME_ATTEMPTS : null,
      message: voided.error.message,
      stage: voided.stage,
      updateId: voided.updateId,
    })),
  };
}

/**
 * Reports each void the first time a device records it, and each update that
 * reused this device's own operation ids, naming the writer that signed it.
 * A void does not fail the pass or set the document's sync failure: the
 * writer's record is at fault, and every other update still applies.
 */
export function reportDocumentSyncVoids(
  logError: WorkflowRuntimeUtilInput["logError"] | undefined,
  synced: Pick<SyncRemoteDocumentResult, "voidedUpdates">,
  outcome: Pick<
    DocumentSyncVerdictOutcome,
    "newlyPreemptedUpdateIds" | "newlyVoidedUpdateIds"
  >,
): void {
  const newlyVoided = new Set(outcome.newlyVoidedUpdateIds);
  const newlyPreempted = new Set(outcome.newlyPreemptedUpdateIds);
  for (const voided of synced.voidedUpdates) {
    if (newlyVoided.has(voided.updateId)) {
      reportQuietly(logError, "Documents: sync update voided", voided.error);
    }
    if (newlyPreempted.has(voided.updateId)) {
      reportQuietly(
        logError,
        `Documents: writer ${voided.error.writerUserId ?? "unknown"} (fingerprint ${voided.error.authorFingerprint ?? "unknown"}) committed operations under this device's peer id ${voided.preemptedPeerId ?? "unknown"}; readers that took them first void this device's own`,
        voided.error,
      );
    }
  }
}

/**
 * Records a page's voids for a judge that keeps no cursor, such as a
 * rotation's raw-history judge, in its own serialized transaction, then
 * reports each new one while the pass is still current.
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
  reportDocumentSyncVoids(input.logError, synced, outcome.result);
}
