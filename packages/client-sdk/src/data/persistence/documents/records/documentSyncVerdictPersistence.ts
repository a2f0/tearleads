import { satisfiesVersionVector } from "@tearleads/loro";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { documents } from "../../../sqlite/schema/documentRecordSchema";
import {
  documentSyncProgress,
  documentVoidUpdates,
} from "../../../sqlite/schema/documentSyncVerdictSchema";
import { sqliteRowsPerStatement } from "../../../sqlite/sqliteBindBudget";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";
import type { DocumentScope } from "./documentPersistenceTypes";
import {
  type ProcessedCursorTransition,
  processedCursorTransition,
} from "./processedCursorState";

type VerdictReader = Pick<ClientSQLiteTransactionScope, "select">;

export interface DocumentVoidVerdict {
  readonly contentKeyEpoch: number | null;
  readonly message: string;
  readonly stage: string;
  readonly updateId: string;
}

export interface DocumentSyncVerdictInput {
  readonly acceptedUpdateIds: readonly string[];
  /** Set when this page ended its pull; the cursor advances only then. */
  readonly completedPull?:
    | {
        /** Whether the request carried a processed cursor. */
        readonly cursorSent: boolean;
        readonly throughUpdateId: string | null;
      }
    | undefined;
  readonly documentId: string;
  readonly judge: string;
  readonly keyFingerprintsByEpoch: ReadonlyMap<number, string>;
  readonly now: string;
  readonly scope: DocumentScope;
  readonly voids: readonly DocumentVoidVerdict[];
}

export interface DocumentSyncVerdictOutcome {
  /** A void was judged under another key for its epoch; its cursor is gone. */
  readonly cursorCleared: boolean;
  /** Voids first recorded by this call, each to be reported once. */
  readonly newlyVoidedUpdateIds: readonly string[];
}

// Two binds name the scope; the rest carry update ids.
const UPDATE_IDS_PER_STATEMENT = sqliteRowsPerStatement(1, 2);
// The scope, the judge, and the stage; the rest carry update ids.
const RECORDED_VOID_IDS_PER_STATEMENT = sqliteRowsPerStatement(1, 4);

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

/**
 * The processed cursor a pull may send, or undefined to pull by version
 * alone. It needs a row for this server document, reached by the running
 * judge, whose recorded frontier the current one still covers. A row reached
 * by the running judge implies every void row was too: the judge changes
 * only between pulls, the next pull then goes without a cursor, and its
 * completion drops each void row it did not judge again.
 */
export async function readSendableProcessedCursor(
  db: VerdictReader,
  input: {
    readonly documentId: string;
    readonly frontier: string;
    readonly judge: string;
    readonly scope: DocumentScope;
  },
): Promise<string | undefined> {
  const [progress] = await db
    .select()
    .from(documentSyncProgress)
    .where(progressScope(input.scope))
    .limit(1);
  if (
    !progress ||
    progress.documentId !== input.documentId ||
    progress.judge !== input.judge ||
    !satisfiesVersionVector(input.frontier, progress.throughVersion)
  ) {
    return undefined;
  }
  return progress.throughUpdateId;
}

/** An import-stage void this scope recorded, with the key it was judged under. */
export interface RecordedImportVoid {
  readonly contentKeyEpoch: number | null;
  readonly keyFingerprint: string | null;
  readonly updateId: string;
}

/**
 * The served updates this scope already voided at the import stage under
 * `judge`. A void judged under another judge is judged again.
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
          contentKeyEpoch: documentVoidUpdates.contentKeyEpoch,
          keyFingerprint: documentVoidUpdates.keyFingerprint,
          updateId: documentVoidUpdates.updateId,
        })
        .from(documentVoidUpdates)
        .where(
          and(
            voidScope(input.scope),
            eq(documentVoidUpdates.judge, input.judge),
            eq(documentVoidUpdates.stage, "loro_import"),
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
          message: sql`CASE WHEN ${documentVoidUpdates.stage} = excluded.stage
            THEN ${documentVoidUpdates.message} ELSE excluded.message END`,
          stage: voided.stage,
        },
      })
      .run();
  }
  return updateIds.filter((updateId) => !existing.has(updateId));
}

async function applyProcessedCursorTransition(
  tx: ClientSQLiteTransactionScope,
  input: DocumentSyncVerdictInput,
  transition: ProcessedCursorTransition,
): Promise<void> {
  if (transition.status === "unchanged") return;
  if (transition.status === "cleared") {
    await clearDocumentSyncProgressInTransaction(tx, input.scope);
    return;
  }
  if (transition.dropsOtherJudges) {
    await tx
      .delete(documentVoidUpdates)
      .where(
        and(voidScope(input.scope), ne(documentVoidUpdates.judge, input.judge)),
      )
      .run();
  }
  if (transition.through === null) return;
  const progress = {
    documentId: input.documentId,
    judge: input.judge,
    throughUpdateId: transition.through.updateId,
    throughVersion: transition.through.version,
  };
  await tx
    .insert(documentSyncProgress)
    .values({
      ...progress,
      appKind: input.scope.appKind,
      localId: input.scope.localId,
    })
    .onConflictDoUpdate({
      target: [documentSyncProgress.appKind, documentSyncProgress.localId],
      set: progress,
    })
    .run();
}

/**
 * Records one sync page's verdicts in the transaction that saves its record:
 * voids are written or refreshed, updates now accepted lose their void row,
 * and a completed pull advances the processed cursor to its upper bound. A
 * void judged under a different key for its epoch than this pass held drops
 * that row and the cursor, so the next pull serves the update again.
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
    return { cursorCleared: false, newlyVoidedUpdateIds: [] };
  }
  const keyConflict = await deleteVoidsJudgedUnderOtherKeys(tx, input);
  await deleteVoidRows(tx, input.scope, input.acceptedUpdateIds);
  const newlyVoidedUpdateIds = await upsertVoidRows(tx, input);
  const transition = processedCursorTransition({
    completedPull: input.completedPull,
    keyConflict,
    recordedFrontier: record.snapshotEndVersion,
  });
  await applyProcessedCursorTransition(tx, input, transition);
  return {
    cursorCleared: transition.status === "cleared",
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

/** Remove a deleted or rebound scope's cursor and void rows. */
export async function deleteDocumentSyncVerdictsInTransaction(
  tx: Pick<ClientSQLiteTransactionScope, "delete">,
  appKind: string,
  localIds: readonly string[],
): Promise<void> {
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
