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
  readonly contentKeyEpoch: number | null;
  readonly message: string;
  readonly stage: string;
  readonly updateId: string;
}

export interface DocumentSyncVerdictInput {
  readonly acceptedUpdateIds: readonly string[];
  readonly documentId: string;
  readonly judge: string;
  readonly keyFingerprintsByEpoch: ReadonlyMap<number, string>;
  /**
   * False for runtime failures recorded ahead of their page's save: voids
   * judged under another key stay for that save to find, so it clears the
   * cursor instead of advancing it past them.
   */
  readonly resolvesKeyConflicts?: boolean | undefined;
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
  /** A void was judged under another key for its epoch; its cursor is gone. */
  readonly cursorCleared: boolean;
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

/** A verdict the import judge reached, with the key it was judged under. */
export interface RecordedImportVoid {
  readonly attempts: number | null;
  readonly contentKeyEpoch: number | null;
  readonly keyFingerprint: string | null;
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
          contentKeyEpoch: documentVoidUpdates.contentKeyEpoch,
          keyFingerprint: documentVoidUpdates.keyFingerprint,
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

/** Void rows of the scope judged under another key for an epoch this pass held. */
async function deleteVoidsJudgedUnderOtherKeys(
  tx: ClientSQLiteTransactionScope,
  input: DocumentSyncVerdictInput,
): Promise<boolean> {
  const epochs = [...input.keyFingerprintsByEpoch.keys()];
  if (epochs.length === 0) return false;
  const rows = await tx
    .select({
      contentKeyEpoch: documentVoidUpdates.contentKeyEpoch,
      keyFingerprint: documentVoidUpdates.keyFingerprint,
      updateId: documentVoidUpdates.updateId,
    })
    .from(documentVoidUpdates)
    .where(
      and(
        voidScope(input.scope),
        inArray(documentVoidUpdates.contentKeyEpoch, epochs),
      ),
    );
  const conflicting = rows.flatMap((row) =>
    row.contentKeyEpoch !== null &&
    row.keyFingerprint !== null &&
    input.keyFingerprintsByEpoch.get(row.contentKeyEpoch) !== row.keyFingerprint
      ? [row.updateId]
      : [],
  );
  await deleteVoidRows(tx, input.scope, conflicting);
  return conflicting.length > 0;
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
    const verdict = {
      contentKeyEpoch: voided.contentKeyEpoch,
      documentId: input.documentId,
      judge: input.judge,
      keyFingerprint:
        voided.contentKeyEpoch === null
          ? null
          : (input.keyFingerprintsByEpoch.get(voided.contentKeyEpoch) ?? null),
    };
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
    case "cleared":
      await clearDocumentSyncProgressInTransaction(tx, input.scope);
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
 * advances the processed cursor to its upper bound. A void judged under a
 * different key for its epoch than this pass held drops that row and the
 * cursor, so the next pull serves the update again.
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
    return {
      cursorCleared: false,
      newlyPreemptedUpdateIds: [],
      newlyVoidedUpdateIds: [],
    };
  }
  const keyConflict =
    input.resolvesKeyConflicts !== false &&
    (await deleteVoidsJudgedUnderOtherKeys(tx, input));
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
    keyConflict,
    page: input.pullPage,
    recordedFrontier: record.snapshotEndVersion,
    storedPremise: input.pullPage?.first
      ? null
      : await readPullPremise(tx, input.scope, input.documentId),
  });
  await applyProcessedCursorTransition(tx, input, transition);
  return {
    cursorCleared: transition.status === "cleared",
    newlyPreemptedUpdateIds,
    newlyVoidedUpdateIds,
  };
}

/** Forget where a scope's pulls reached, so the next one pulls by version. */
async function clearDocumentSyncProgressInTransaction(
  tx: Pick<ClientSQLiteTransactionScope, "delete">,
  scope: DocumentScope,
): Promise<void> {
  await tx.delete(documentSyncProgress).where(progressScope(scope)).run();
}

/** Remove a deleted or rebound scope's cursor, void rows, and notices. */
export async function deleteDocumentSyncVerdictsInTransaction(
  tx: Pick<ClientSQLiteTransactionScope, "delete">,
  appKind: string,
  localIds: readonly string[],
): Promise<void> {
  await deleteDocumentPeerPreemptionsInTransaction(tx, appKind, localIds);
  await deleteRecordedAttachmentSlotsInTransaction(tx, appKind, localIds);
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
