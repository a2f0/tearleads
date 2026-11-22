import { satisfiesVersionVector } from "@tearleads/loro";
import { and, eq, inArray, ne } from "drizzle-orm";
import { documents } from "../../../sqlite/schema/documentRecordSchema";
import {
  documentSyncProgress,
  documentVoidUpdates,
} from "../../../sqlite/schema/documentSyncVerdictSchema";
import { sqliteRowsPerStatement } from "../../../sqlite/sqliteBindBudget";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";
import type { DocumentScope } from "./documentPersistenceTypes";

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
    const verdict = {
      contentKeyEpoch: voided.contentKeyEpoch,
      documentId: input.documentId,
      judge: input.judge,
      keyFingerprint:
        voided.contentKeyEpoch === null
          ? null
          : (input.keyFingerprintsByEpoch.get(voided.contentKeyEpoch) ?? null),
      message: voided.message,
      stage: voided.stage,
    };
    await tx
      .insert(documentVoidUpdates)
      .values({
        ...verdict,
        appKind: input.scope.appKind,
        localId: input.scope.localId,
        updateId: voided.updateId,
        voidedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [
          documentVoidUpdates.appKind,
          documentVoidUpdates.localId,
          documentVoidUpdates.updateId,
        ],
        set: verdict,
      })
      .run();
  }
  return updateIds.filter((updateId) => !existing.has(updateId));
}

async function advanceProcessedCursor(
  tx: ClientSQLiteTransactionScope,
  input: DocumentSyncVerdictInput & {
    readonly completedPull: NonNullable<
      DocumentSyncVerdictInput["completedPull"]
    > & { readonly throughVersion: string };
  },
): Promise<void> {
  const { throughUpdateId, throughVersion } = input.completedPull;
  if (!input.completedPull.cursorSent) {
    // A pull without a cursor served every update whose declared span the
    // frontier left uncovered and judged it again; a void row it did not
    // rewrite names an update the frontier now covers.
    await tx
      .delete(documentVoidUpdates)
      .where(
        and(voidScope(input.scope), ne(documentVoidUpdates.judge, input.judge)),
      )
      .run();
  }
  if (throughUpdateId === null) return;
  const progress = {
    documentId: input.documentId,
    judge: input.judge,
    throughUpdateId,
    throughVersion,
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
  const cursorCleared = await deleteVoidsJudgedUnderOtherKeys(tx, input);
  await deleteVoidRows(tx, input.scope, input.acceptedUpdateIds);
  const newlyVoidedUpdateIds = await upsertVoidRows(tx, input);
  if (cursorCleared) {
    await clearDocumentSyncProgressInTransaction(tx, input.scope);
  } else if (input.completedPull) {
    await advanceProcessedCursor(tx, {
      ...input,
      completedPull: {
        ...input.completedPull,
        throughVersion: record.snapshotEndVersion,
      },
    });
  }
  return { cursorCleared, newlyVoidedUpdateIds };
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
