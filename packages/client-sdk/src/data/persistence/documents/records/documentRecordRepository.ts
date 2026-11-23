import { and, eq, inArray, sql } from "drizzle-orm";
import {
  DOCUMENT_SYNC_PULL_RECOVERY_REQUIRED,
  type DocumentSyncPullContinuation,
  serializeDocumentSyncPullContinuation,
} from "../../../documents/shared/sync/pullContinuation";
import { localIntentTables } from "../../../sqlite/schema";
import {
  documentHistoryUpdates,
  documents,
  documentTables,
} from "../../../sqlite/schema/documentRecordSchema";
import { sqliteRowsPerStatement } from "../../../sqlite/sqliteBindBudget";
import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../../sqlite/sqlSchema";
import {
  type DocumentHistoryCheckpointReplacement,
  type DocumentHistoryRestoreState,
  type DocumentHistoryTailEntry,
  type DocumentHistoryTailSize,
  type DocumentHistoryUpdateOrigin,
  deleteDocumentHistoryInTransaction,
  insertDocumentHistoryUpdatesInTransaction,
  replaceDocumentHistoryCheckpointInTransaction,
  selectDocumentHistoryRestoreState,
  selectDocumentHistoryTailEntries,
  selectDocumentHistoryTailSize,
} from "./documentHistoryPersistence";
import {
  documentWriteFenceMatchesInTransaction,
  insertDocumentPendingUpdateInTransaction,
  insertDocumentPendingUpdateWithHistoryInTransaction,
  queuedInScope,
  rekeyDocumentPendingUpdateInTransaction,
  selectDocumentPendingUpdates,
  settleDocumentPendingUpdateInTransaction,
  unqueueDocumentScopesInTransaction,
} from "./documentPendingUpdatePersistence";
import type {
  DocumentRecord,
  DocumentScope,
  PendingUpdateFields,
  QueuedPendingUpdateRecord,
} from "./documentPersistenceTypes";
import {
  type QueuedUpdateReplacement,
  replaceDocumentQueuedUpdatesInTransaction,
} from "./documentQueuedUpdateReplacement";
import {
  documentRecordSelection,
  localIdPreferenceOrder,
  mapSelectedDocumentRecord,
} from "./documentRecordPersistence";
import {
  clearDocumentSyncFailureInTransaction,
  type DocumentSyncFailureFields,
  recordDocumentSyncFailureInTransaction,
  selectHasRecordedTerminalSyncFailures,
} from "./documentSyncFailurePersistence";
import { deleteDocumentSyncVerdictsInTransaction } from "./documentSyncVerdictPersistence";

/** The exact continuation `invalidateDocumentSyncPullContinuation` replaces. */
export interface DocumentSyncPullContinuationInvalidation {
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
}

/**
 * A document scope's record row, its history checkpoint and tail, its queue
 * of pending updates and its recorded sync failure, bound to one executor
 * and clock. Each method keeps the transaction shape it always had: reads
 * run on the bound handle, writers run their own serialized mutation (or an
 * immediate transaction where noted). Build it from the executor you hold;
 * inside a locked section that is the locked handle. Work inside a caller's
 * transaction takes the handle per call through the `*InTransaction`
 * functions instead.
 */
export class DocumentRecordRepository {
  private readonly execSql: ExecSql;
  private readonly now: () => Date;

  constructor(execSql: ExecSql, now: () => Date = () => new Date()) {
    this.execSql = execSql;
    this.now = now;
  }

  /** Replace only the exact rejected continuation with a durable recovery marker. */
  async invalidateDocumentSyncPullContinuation(
    input: DocumentSyncPullContinuationInvalidation,
  ): Promise<DocumentRecord | null> {
    await ensureSqlTables(this.execSql, documentTables);
    const expectedContinuation = serializeDocumentSyncPullContinuation(
      input.continuation,
    );
    if (expectedContinuation === null) return null;
    return runSerializedSqlMutation(this.execSql, async (lockedExecSql) => {
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
      return new DocumentRecordRepository(
        lockedExecSql,
        this.now,
      ).loadDocumentRecord({ appKind: input.appKind, localId: input.localId });
    });
  }

  async loadDocumentRecord(
    scope: DocumentScope,
  ): Promise<DocumentRecord | null> {
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    const rows = await db
      .select(documentRecordSelection)
      .from(documents)
      .where(
        and(
          eq(documents.appKind, scope.appKind),
          eq(documents.localId, scope.localId),
        ),
      )
      .limit(1);
    return rows[0] ? mapSelectedDocumentRecord(rows[0]) : null;
  }

  async findLocalIdByDocumentId(
    appKind: string,
    documentId: string,
  ): Promise<string | null> {
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    const rows = await db
      .select({ localId: documents.localId })
      .from(documents)
      .where(
        and(
          eq(documents.appKind, appKind),
          eq(documents.documentId, documentId),
        ),
      )
      .orderBy(...localIdPreferenceOrder())
      .limit(1);
    return rows[0]?.localId ?? null;
  }

  /**
   * `findLocalIdByDocumentId` for many document ids: one read per chunk, in
   * the same preference order, keeping the first row per document id.
   */
  async findLocalIdsByDocumentIds(
    appKind: string,
    documentIds: ReadonlyArray<string>,
  ): Promise<Map<string, string>> {
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    const localIds = new Map<string, string>();
    const unique = Array.from(new Set(documentIds));
    // One bind for the app kind; the rest carry document ids.
    const chunkSize = sqliteRowsPerStatement(1, 1);
    for (let offset = 0; offset < unique.length; offset += chunkSize) {
      const rows = await db
        .select({
          documentId: documents.documentId,
          localId: documents.localId,
        })
        .from(documents)
        .where(
          and(
            eq(documents.appKind, appKind),
            inArray(
              documents.documentId,
              unique.slice(offset, offset + chunkSize),
            ),
          ),
        )
        .orderBy(...localIdPreferenceOrder());
      for (const row of rows) {
        if (row.documentId !== null && !localIds.has(row.documentId)) {
          localIds.set(row.documentId, row.localId);
        }
      }
    }
    return localIds;
  }

  async deleteDocumentRecord(scope: DocumentScope): Promise<void> {
    await getClientSQLitePersistenceRuntime(this.execSql).runMutation(
      async (db) => {
        await db
          .delete(documents)
          .where(
            and(
              eq(documents.appKind, scope.appKind),
              eq(documents.localId, scope.localId),
            ),
          )
          .run();
        await deleteDocumentSyncVerdictsInTransaction(db, scope.appKind, [
          scope.localId,
        ]);
      },
    );
  }

  async listDocumentPendingUpdates(
    scope: DocumentScope,
  ): Promise<QueuedPendingUpdateRecord[]> {
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    return selectDocumentPendingUpdates(db, scope);
  }

  /**
   * Queue an update that has no history-tail role: container metadata (its
   * content is its checkpoint) and full-state re-uploads after a remote reset.
   */
  async enqueueDocumentPendingUpdate(
    scope: DocumentScope,
    pendingUpdate: PendingUpdateFields,
  ): Promise<string> {
    const updateId = crypto.randomUUID();
    await getClientSQLitePersistenceRuntime(this.execSql).runMutation(
      async (db) => {
        await insertDocumentPendingUpdateInTransaction(db, {
          createdAt: this.now().toISOString(),
          pendingUpdate,
          scope,
          updateId,
        });
      },
    );
    return updateId;
  }

  /**
   * Append a locally authored update to the history tail AND queue it, as one
   * row in one immediate transaction. A crash can therefore never leave the
   * op restorable from history while missing from the outgoing queue, where a
   * null-marker restore would classify it as covered and never send it.
   */
  async enqueueDocumentPendingUpdateWithHistory(
    scope: DocumentScope,
    pendingUpdate: PendingUpdateFields,
    options?: {
      expectedDocumentId: string | null;
      expectedRecoveryGeneration: number;
    },
  ): Promise<string | null> {
    const createdAt = this.now().toISOString();
    return getClientSQLitePersistenceRuntime(this.execSql).transaction(
      async (tx) => {
        if (
          options &&
          !(await documentWriteFenceMatchesInTransaction(tx, scope, options))
        ) {
          return null;
        }
        return insertDocumentPendingUpdateWithHistoryInTransaction({
          createdAt,
          pendingUpdate,
          scope,
          tx,
        });
      },
      { behavior: "immediate" },
    );
  }

  /**
   * Reset the durable re-key budget for every queued update in a scope. The
   * cap exists to stop a server that keeps conflicting fresh ids from driving
   * a network-speed loop — but a budget burned during an unrelated outage
   * (e.g. yesterday's stale-bundle deadlock 409ing every submit) should not
   * be terminal forever. An explicit manual retry is the deliberate,
   * rate-limited signal that conditions changed, so it gets a fresh budget.
   */
  async resetDocumentPendingUpdateRekeyBudget(
    scope: DocumentScope,
  ): Promise<void> {
    await getClientSQLitePersistenceRuntime(this.execSql).runMutation(
      async (db) => {
        await db
          .update(documentHistoryUpdates)
          .set({ rekeyCount: 0 })
          .where(queuedInScope(scope));
      },
    );
  }

  /** See `MAX_PENDING_UPDATE_REKEYS`: the new id, or null with no progress. */
  async rekeyDocumentPendingUpdate(id: string): Promise<string | null> {
    const nextId = crypto.randomUUID();
    const rekeyed = await getClientSQLitePersistenceRuntime(
      this.execSql,
    ).runMutation((db) =>
      rekeyDocumentPendingUpdateInTransaction(db, id, nextId),
    );
    return rekeyed ? nextId : null;
  }

  /** Settle one queued update by id, whatever its scope. */
  async settleDocumentPendingUpdate(id: string): Promise<void> {
    await getClientSQLitePersistenceRuntime(this.execSql).runMutation(
      async (db) => {
        await settleDocumentPendingUpdateInTransaction(db, id);
      },
    );
  }

  async unqueueDocumentPendingUpdates(scope: DocumentScope): Promise<void> {
    await getClientSQLitePersistenceRuntime(this.execSql).runMutation(
      async (db) => {
        await unqueueDocumentScopesInTransaction(db, [scope]);
      },
    );
  }

  /**
   * Replace queued local updates with one merged update, all or nothing, in
   * one immediate transaction. Every check must hold or nothing changes and
   * the result is null: the document still has the captured document id and
   * recovery generation, and the members are still queued under their ids as
   * ordinary local rows (no outbox row, no rotation checkpoint) forming one
   * contiguous run in queue order that starts with the first listed member.
   *
   * The first member's row is updated in place, so it keeps its row id,
   * `created_at` and rowid (its queue and history-tail position), and
   * receives a fresh update id (an id is never reused for different
   * content), the merged data and vectors, and `rekeyCount`. The other
   * members are deleted. Resolves to the merged row's new update id.
   */
  async replaceDocumentQueuedUpdates(
    scope: DocumentScope,
    replacement: QueuedUpdateReplacement,
  ): Promise<string | null> {
    if (replacement.memberUpdateIds.length < 2) return null;
    return getClientSQLitePersistenceRuntime(this.execSql).transaction(
      (tx) => replaceDocumentQueuedUpdatesInTransaction(tx, scope, replacement),
      { behavior: "immediate" },
    );
  }

  async appendDocumentHistoryUpdates(
    scope: DocumentScope,
    updates: readonly string[],
    origin: DocumentHistoryUpdateOrigin,
  ): Promise<void> {
    if (updates.length === 0) {
      return;
    }
    await ensureSqlTables(this.execSql, documentTables);
    const createdAt = this.now().toISOString();
    await getClientSQLitePersistenceRuntime(this.execSql).runMutation((db) =>
      insertDocumentHistoryUpdatesInTransaction(db, {
        createdAt,
        origin,
        scope,
        updates,
      }),
    );
  }

  /**
   * The checkpoint + ordered tail for a scope, or null when NEITHER exists (a
   * discovered shell that has not hydrated content yet; the caller starts the
   * document empty and the remote pull supplies the content). A tail WITHOUT
   * a checkpoint — a crash between the first enqueued edit's tail append and
   * the birth-checkpoint seed — restores as tail-only (`snapshot: ""`): those
   * tail rows can be the only durable copy of a local edit, so they must
   * never be silently ignored.
   */
  async loadDocumentHistoryRestoreState(
    scope: DocumentScope,
  ): Promise<DocumentHistoryRestoreState | null> {
    await ensureSqlTables(this.execSql, documentTables);
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    return selectDocumentHistoryRestoreState(db, scope);
  }

  /**
   * Size of the tail compaction can shrink. Queued rows are excluded: they
   * stay until settlement, so counting them would re-export full history on
   * every persist while offline edits wait to sync.
   */
  async readDocumentHistoryTailSize(
    scope: DocumentScope,
  ): Promise<DocumentHistoryTailSize> {
    await ensureSqlTables(this.execSql, documentTables);
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    return selectDocumentHistoryTailSize(db, scope);
  }

  /**
   * The current compactable tail rows WITH their payloads, so a compactor can
   * prove each row's ops are covered by the snapshot it is about to install
   * (another pane's append may carry ops this pane's document has not merged
   * yet). Queued rows are never candidates.
   */
  async listDocumentHistoryTailEntries(
    scope: DocumentScope,
  ): Promise<DocumentHistoryTailEntry[]> {
    await ensureSqlTables(this.execSql, documentTables);
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    return selectDocumentHistoryTailEntries(db, scope);
  }

  /**
   * Replace the scope's checkpoint with a fresh full-history snapshot and
   * delete ONLY the tail rows the caller captured before exporting it. Every
   * append path writes its tail row after the ops are already in the live
   * document, so any row captured before the export is provably covered by
   * the snapshot — while a row appended concurrently (between export and
   * this delete) survives for the next compaction instead of being lost.
   */
  async replaceDocumentHistoryCheckpoint(
    scope: DocumentScope,
    input: DocumentHistoryCheckpointReplacement,
  ): Promise<boolean> {
    await ensureSqlTables(this.execSql, documentTables);
    // Sequential (non-transactional) so callers already inside a transaction
    // can nest this. Crash between the statements leaves the new checkpoint
    // plus covered tail rows — a safe superset, since tail replay is
    // idempotent by op identity. The replacement itself is a compare-and-swap
    // on the stored revision, so the version gate cannot be bypassed by a
    // concurrent compactor between the read and the write: whoever loses the
    // CAS re-reads and re-evaluates the gate against the winner's checkpoint.
    return getClientSQLitePersistenceRuntime(this.execSql).runMutation((tx) =>
      replaceDocumentHistoryCheckpointInTransaction(tx, scope, input, this.now),
    );
  }

  async deleteDocumentHistory(scope: DocumentScope): Promise<void> {
    await ensureSqlTables(this.execSql, documentTables);
    await getClientSQLitePersistenceRuntime(this.execSql).runMutation((tx) =>
      deleteDocumentHistoryInTransaction(tx, scope),
    );
  }

  /**
   * Record the last terminal failure or incoming-update quarantine on the
   * scope's row; the caller supplies `attemptedAt`. A scope with no
   * `documents` row has nothing left to explain, so it is a no-op there.
   */
  async recordDocumentSyncFailure(
    scope: DocumentScope,
    failure: DocumentSyncFailureFields,
  ): Promise<void> {
    await getClientSQLitePersistenceRuntime(this.execSql).runMutation((db) =>
      recordDocumentSyncFailureInTransaction(db, scope, failure),
    );
  }

  /** Whether any queued local write has recorded a terminal failure. */
  async hasRecordedTerminalSyncFailures(): Promise<boolean> {
    await ensureSqlTables(this.execSql, [
      ...documentTables,
      ...localIntentTables,
    ]);
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    return selectHasRecordedTerminalSyncFailures(db);
  }

  /** Drop the recorded failure for a scope. */
  async clearDocumentSyncFailure(scope: DocumentScope): Promise<void> {
    await getClientSQLitePersistenceRuntime(this.execSql).runMutation((db) =>
      clearDocumentSyncFailureInTransaction(db, scope),
    );
  }
}
