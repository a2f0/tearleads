import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { documents } from "../../../sqlite/schema/documentRecordSchema";
import {
  documentSyncProgress,
  documentVoidUpdates,
} from "../../../sqlite/schema/documentSyncVerdictSchema";
import { sqliteRowsPerStatement } from "../../../sqlite/sqliteBindBudget";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";
import {
  type DocumentPeerPreemption,
  deleteDocumentPeerPreemptionsInTransaction,
  recordDocumentPeerPreemptions,
} from "./documentPeerPreemptionPersistence";
import type { DocumentScope } from "./documentPersistenceTypes";
import { deleteDocumentLoroWindowsInTransaction } from "./loroWindowPersistence";
import {
  type ProcessedCursorTransition,
  type PullPagePosition,
  type PullPremise,
  processedCursorTransition,
} from "./processedCursorState";
import { deleteRecordedAttachmentSlotsInTransaction } from "./recordedAttachmentSlotPersistence";

type VerdictReader = Pick<ClientSQLiteTransactionScope, "select">;

export interface DocumentVoidVerdict {
  /**
   * For a `loro_runtime` verdict, the process lifetimes that have failed it;
   * null keeps what the row recorded.
   */
  readonly attempts: number | null;
  readonly message: string;
  readonly stage: string;
  readonly updateId: string;
}

export interface DocumentSyncVerdictInput {
  readonly acceptedUpdateIds: readonly string[];
  readonly documentId: string;
  readonly judge: string;
  readonly now: string;
  /** Voided updates that reused this device's own operation ids. */
  readonly preemptions?: readonly DocumentPeerPreemption[] | undefined;
  /**
   * Where the page sits in its pull; a completed pull advances the cursor.
   * Undefined for a judge that keeps no cursor, such as rotation's.
   */
  readonly pullPage?: PullPagePosition | undefined;
  readonly scope: DocumentScope;
  readonly voids: readonly DocumentVoidVerdict[];
}

export interface DocumentSyncVerdictOutcome {
  /** Preemption notices first recorded by this call, each reported once. */
  readonly newlyPreemptedUpdateIds: readonly string[];
  /** Voids first recorded by this call, each to be reported once. */
  readonly newlyVoidedUpdateIds: readonly string[];
}

// Two binds name the scope; the rest carry update ids.
const UPDATE_IDS_PER_STATEMENT = sqliteRowsPerStatement(1, 2);
// The scope, the judge, and the stages; the rest carry update ids.
const RECORDED_VOID_IDS_PER_STATEMENT = sqliteRowsPerStatement(1, 6);

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

function voidScope(scope: DocumentScope) {
  return and(
    eq(documentVoidUpdates.appKind, scope.appKind),
    eq(documentVoidUpdates.localId, scope.localId),
  );
}

function progressScope(scope: DocumentScope) {
  return and(
    eq(documentSyncProgress.appKind, scope.appKind),
    eq(documentSyncProgress.localId, scope.localId),
  );
}

/** A verdict the import judge reached. */
export interface RecordedImportVoid {
  readonly attempts: number | null;
  readonly stage: string;
  readonly updateId: string;
}

/** The stages the import judge decides, so a re-served update can skip it. */
const IMPORT_JUDGE_STAGES = ["loro_import", "loro_metadata", "loro_runtime"];

/**
 * The served updates this scope already judged void, or unsettled, at a
 * stage the import judge decides, under `judge`. A void judged under another
 * judge is judged again.
 */
export async function readRecordedImportVoids(
  db: VerdictReader,
  input: {
    readonly judge: string;
    readonly scope: DocumentScope;
    readonly updateIds: readonly string[];
  },
): Promise<RecordedImportVoid[]> {
  const recorded: RecordedImportVoid[] = [];
  for (const batch of chunks(
    input.updateIds,
    RECORDED_VOID_IDS_PER_STATEMENT,
  )) {
    recorded.push(
      ...(await db
        .select({
          attempts: documentVoidUpdates.attempts,
          stage: documentVoidUpdates.stage,
          updateId: documentVoidUpdates.updateId,
        })
        .from(documentVoidUpdates)
        .where(
          and(
            voidScope(input.scope),
            eq(documentVoidUpdates.judge, input.judge),
            inArray(documentVoidUpdates.stage, IMPORT_JUDGE_STAGES),
            inArray(documentVoidUpdates.updateId, batch),
          ),
        )),
    );
  }
  return recorded;
}

async function deleteVoidRows(
  tx: ClientSQLiteTransactionScope,
  scope: DocumentScope,
  updateIds: readonly string[],
): Promise<void> {
  for (const batch of chunks(updateIds, UPDATE_IDS_PER_STATEMENT)) {
    await tx
      .delete(documentVoidUpdates)
      .where(
        and(voidScope(scope), inArray(documentVoidUpdates.updateId, batch)),
      )
      .run();
  }
}

async function upsertVoidRows(
  tx: ClientSQLiteTransactionScope,
  input: DocumentSyncVerdictInput,
): Promise<string[]> {
  const updateIds = input.voids.map((voided) => voided.updateId);
  const existing = new Set<string>();
  for (const batch of chunks(updateIds, UPDATE_IDS_PER_STATEMENT)) {
    const rows = await tx
      .select({ updateId: documentVoidUpdates.updateId })
      .from(documentVoidUpdates)
      .where(
        and(
          voidScope(input.scope),
          inArray(documentVoidUpdates.updateId, batch),
        ),
      );
    for (const row of rows) existing.add(row.updateId);
  }
  for (const voided of input.voids) {
    // A row keeps the reason it was first voided for while its stage holds;
    // a verdict at another stage (a new decoder reads further) replaces both.
    const verdict = { documentId: input.documentId, judge: input.judge };
    await tx
      .insert(documentVoidUpdates)
      .values({
        ...verdict,
        appKind: input.scope.appKind,
        localId: input.scope.localId,
        attempts: voided.attempts,
        message: voided.message,
        stage: voided.stage,
        updateId: voided.updateId,
        voidedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [
          documentVoidUpdates.appKind,
          documentVoidUpdates.localId,
          documentVoidUpdates.updateId,
        ],
        set: {
          ...verdict,
          attempts: sql`COALESCE(excluded.attempts, ${documentVoidUpdates.attempts})`,
          message: sql`CASE WHEN ${documentVoidUpdates.stage} = excluded.stage
            THEN ${documentVoidUpdates.message} ELSE excluded.message END`,
          stage: voided.stage,
        },
      })
      .run();
  }
  return updateIds.filter((updateId) => !existing.has(updateId));
}

/** The premise of the scope's pull in progress for `documentId`, if any. */
async function readPullPremise(
  tx: ClientSQLiteTransactionScope,
  scope: DocumentScope,
  documentId: string,
): Promise<PullPremise | null> {
  const [row] = await tx
    .select({
      documentId: documentSyncProgress.documentId,
      pullJudge: documentSyncProgress.pullJudge,
      pullSentCursor: documentSyncProgress.pullSentCursor,
    })
    .from(documentSyncProgress)
    .where(progressScope(scope))
    .limit(1);
  if (!row || row.documentId !== documentId || row.pullJudge === null) {
    return null;
  }
  return { judge: row.pullJudge, sentCursor: row.pullSentCursor };
}

/** Writes `fields` onto the scope's progress row, creating it if needed. */
async function upsertProgress(
  tx: ClientSQLiteTransactionScope,
  scope: DocumentScope,
  fields: Partial<typeof documentSyncProgress.$inferInsert> & {
    readonly documentId: string;
  },
): Promise<void> {
  await tx
    .insert(documentSyncProgress)
    .values({ ...fields, appKind: scope.appKind, localId: scope.localId })
    .onConflictDoUpdate({
      target: [documentSyncProgress.appKind, documentSyncProgress.localId],
      set: fields,
    })
    .run();
}

async function applyProcessedCursorTransition(
  tx: ClientSQLiteTransactionScope,
  input: DocumentSyncVerdictInput,
  transition: ProcessedCursorTransition,
): Promise<void> {
  const noPull = { pullJudge: null, pullSentCursor: null };
  switch (transition.status) {
    case "unchanged":
      return;
    case "pulling":
      await upsertProgress(tx, input.scope, {
        documentId: input.documentId,
        pullJudge: transition.premise.judge,
        pullSentCursor: transition.premise.sentCursor,
      });
      return;
    case "abandoned":
      await tx
        .update(documentSyncProgress)
        .set(noPull)
        .where(progressScope(input.scope))
        .run();
      return;
    case "advanced":
      break;
  }
  if (transition.dropsOtherJudges) {
    await tx
      .delete(documentVoidUpdates)
      .where(
        and(voidScope(input.scope), ne(documentVoidUpdates.judge, input.judge)),
      )
      .run();
  }
  await upsertProgress(tx, input.scope, {
    documentId: input.documentId,
    ...noPull,
    ...(transition.through === null
      ? {}
      : {
          judge: input.judge,
          throughUpdateCount: transition.through.updateCount,
          throughUpdateId: transition.through.updateId,
          throughVersion: transition.through.version,
        }),
  });
}

/**
 * Records one sync page's verdicts in the transaction that saves its record:
 * voids are written or refreshed, updates now accepted lose their void row,
 * and a pull that completed under the premise its first page recorded
 * advances the processed cursor to its upper bound.
 *
 * No verdict depends on the content key a pass held. A void or an acceptance
 * is recorded only for an update whose signed envelope committed to the key
 * the reader judged it under, and every reader holding that key reaches the
 * same verdict. A reader holding another key reaches none: its pass fails at
 * that update, before this runs. A later pass holding another key for an
 * epoch therefore has nothing here to undo.
 */
export async function recordDocumentSyncVerdictsInTransaction(
  tx: ClientSQLiteTransactionScope,
  input: DocumentSyncVerdictInput,
): Promise<DocumentSyncVerdictOutcome> {
  // The frontier the record holds now: inside a record save, the one it
  // just wrote. A scope deleted or rebound meanwhile keeps no verdicts.
  const [record] = await tx
    .select({
      documentId: documents.documentId,
      snapshotEndVersion: documents.snapshotEndVersion,
    })
    .from(documents)
    .where(
      and(
        eq(documents.appKind, input.scope.appKind),
        eq(documents.localId, input.scope.localId),
      ),
    )
    .limit(1);
  if (!record || record.documentId !== input.documentId) {
    return { newlyPreemptedUpdateIds: [], newlyVoidedUpdateIds: [] };
  }
  await deleteVoidRows(tx, input.scope, input.acceptedUpdateIds);
  const newlyVoidedUpdateIds = await upsertVoidRows(tx, input);
  const newlyPreemptedUpdateIds = await recordDocumentPeerPreemptions(tx, {
    documentId: input.documentId,
    now: input.now,
    preemptions: input.preemptions ?? [],
    scope: input.scope,
  });
  const transition = processedCursorTransition({
    judge: input.judge,
    page: input.pullPage,
    recordedFrontier: record.snapshotEndVersion,
    storedPremise: input.pullPage?.first
      ? null
      : await readPullPremise(tx, input.scope, input.documentId),
  });
  await applyProcessedCursorTransition(tx, input, transition);
  return { newlyPreemptedUpdateIds, newlyVoidedUpdateIds };
}

/** Remove a deleted or rebound scope's cursor, void rows, and notices. */
export async function deleteDocumentSyncVerdictsInTransaction(
  tx: Pick<ClientSQLiteTransactionScope, "delete">,
  appKind: string,
  localIds: readonly string[],
): Promise<void> {
  await clearDocumentSyncVerdictsInTransaction(tx, appKind, localIds);
  await deleteRecordedAttachmentSlotsInTransaction(tx, appKind, localIds);
}

/**
 * Forget a scope's cursor, void rows, read windows, and notices, but keep the
 * attachment slots it saw recorded: they belong to the document, not to its
 * sync state.
 */
export async function clearDocumentSyncVerdictsInTransaction(
  tx: Pick<ClientSQLiteTransactionScope, "delete">,
  appKind: string,
  localIds: readonly string[],
): Promise<void> {
  await deleteDocumentPeerPreemptionsInTransaction(tx, appKind, localIds);
  await deleteDocumentLoroWindowsInTransaction(tx, appKind, localIds);
  for (const batch of chunks(localIds, UPDATE_IDS_PER_STATEMENT)) {
    await tx
      .delete(documentSyncProgress)
      .where(
        and(
          eq(documentSyncProgress.appKind, appKind),
          inArray(documentSyncProgress.localId, batch),
        ),
      )
      .run();
    await tx
      .delete(documentVoidUpdates)
      .where(
        and(
          eq(documentVoidUpdates.appKind, appKind),
          inArray(documentVoidUpdates.localId, batch),
        ),
      )
      .run();
  }
}
