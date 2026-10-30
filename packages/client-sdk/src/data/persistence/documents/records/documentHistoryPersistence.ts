import { base64ToBytes } from "@tearleads/encoding";
import {
  createDocument,
  exportFullHistoryIdentity,
  importSnapshot,
  satisfiesVersionVector,
} from "@tearleads/loro";
import { and, eq, exists, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  documentHistoryCheckpoints,
  documentHistoryUpdates,
  documentTables,
} from "../../../sqlite/schema";
import { sqliteInsertBatchSize } from "../../../sqlite/sqliteBindBudget";
import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../../sqlite/sqlSchema";
import type { DocumentScope } from "./documentPersistenceTypes";

const HISTORY_INSERT_BATCH_SIZE = sqliteInsertBatchSize(documentHistoryUpdates);

/**
 * Compaction thresholds: once the tail carries this many rows or bytes, the
 * next persist of a full-history-capable document exports a fresh checkpoint
 * and clears the tail. Small enough to keep restore replay short, large
 * enough that a full-history export (O(history)) happens once per burst of
 * edits instead of per keystroke.
 */
export const DOCUMENT_HISTORY_COMPACTION_MAX_ROWS = 200;
export const DOCUMENT_HISTORY_COMPACTION_MAX_BYTES = 512 * 1024;

/**
 * Row provenance: "local" for updates authored on this device, "remote" for
 * decrypted pulled updates. Restores advance the outgoing-delta marker across
 * remote rows (already server-side); local rows never advance it.
 */
type DocumentHistoryUpdateOrigin = "local" | "remote";

/**
 * Rows of the update log that are history tail: every row except an "outbox"
 * row, which only waits to be sent (see `documentHistoryUpdates`).
 */
function tailInScope(scope: DocumentScope) {
  return and(
    eq(documentHistoryUpdates.appKind, scope.appKind),
    eq(documentHistoryUpdates.localId, scope.localId),
    ne(documentHistoryUpdates.origin, "outbox"),
  );
}

/**
 * Tail rows compaction may fold into a checkpoint and delete: a queued row is
 * the only durable copy of an unsent update, so it waits for settlement even
 * when a checkpoint already covers its operations.
 */
function compactableTailInScope(scope: DocumentScope) {
  return and(tailInScope(scope), isNull(documentHistoryUpdates.updateId));
}

interface DocumentHistoryTailUpdate {
  readonly origin: DocumentHistoryUpdateOrigin;
  readonly updateData: string;
}

interface DocumentHistoryRestoreState {
  readonly snapshot: string;
  readonly tailUpdates: readonly DocumentHistoryTailUpdate[];
}

export async function appendDocumentHistoryUpdates(
  execSql: ExecSql,
  scope: DocumentScope,
  updates: readonly string[],
  origin: DocumentHistoryUpdateOrigin,
): Promise<void> {
  if (updates.length === 0) {
    return;
  }
  await ensureSqlTables(execSql, documentTables);
  const createdAt = new Date().toISOString();
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    // A pull page carries at most 64 updates, which fits one statement; the
    // chunking keeps any longer append within SQLite's bind budget.
    for (
      let index = 0;
      index < updates.length;
      index += HISTORY_INSERT_BATCH_SIZE
    ) {
      await db.insert(documentHistoryUpdates).values(
        updates
          .slice(index, index + HISTORY_INSERT_BATCH_SIZE)
          .map((updateData) => ({
            id: crypto.randomUUID(),
            appKind: scope.appKind,
            localId: scope.localId,
            updateData,
            origin,
            createdAt,
          })),
      );
    }
  });
}

/**
 * The checkpoint + ordered tail for a scope, or null when NEITHER exists (a
 * discovered shell that has not hydrated content yet; the caller starts the
 * document empty and the remote pull supplies the content). A tail WITHOUT a
 * checkpoint — a crash between the first enqueued edit's tail append and the
 * birth-checkpoint seed — restores as tail-only (`snapshot: ""`): those tail
 * rows can be the only durable copy of a local edit, so they must never be
 * silently ignored.
 */
export async function loadDocumentHistoryRestoreState(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<DocumentHistoryRestoreState | null> {
  await ensureSqlTables(execSql, documentTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  // Read the TAIL before the (full) checkpoint: if another pane compacts
  // between the two reads, this order yields old-tail + new-checkpoint — a
  // safe superset (the new checkpoint subsumes the old tail, and replay is
  // idempotent by op identity). The reverse order could yield old-checkpoint
  // + already-emptied tail, a torn read that silently drops the compacted
  // ops for the whole session.
  const tail = await db
    .select({
      id: documentHistoryUpdates.id,
      origin: documentHistoryUpdates.origin,
      updateData: documentHistoryUpdates.updateData,
    })
    .from(documentHistoryUpdates)
    .where(tailInScope(scope))
    // Insertion order: same-millisecond appends make createdAt tie and a
    // random-uuid tiebreak would replay out of order. importUpdates tolerates
    // out-of-order batches, but replay should still be deterministic.
    .orderBy(sql`rowid`);

  const [checkpoint] = await db
    .select({ snapshot: documentHistoryCheckpoints.snapshot })
    .from(documentHistoryCheckpoints)
    .where(
      and(
        eq(documentHistoryCheckpoints.appKind, scope.appKind),
        eq(documentHistoryCheckpoints.localId, scope.localId),
      ),
    )
    .limit(1);
  if (!checkpoint && tail.length === 0) {
    return null;
  }

  return {
    snapshot: checkpoint?.snapshot ?? "",
    tailUpdates: tail.map((row) => ({
      // Fail toward re-sending: an unrecognized origin never advances the
      // marker, which is the recoverable direction (a redundant re-submit
      // is idempotent; a skipped local op would be orphaned from sync).
      origin:
        row.origin === "remote" ? ("remote" as const) : ("local" as const),
      updateData: row.updateData,
    })),
  };
}

/**
 * Size of the tail compaction can shrink. Queued rows are excluded: they stay
 * until settlement, so counting them would re-export full history on every
 * persist while offline edits wait to sync.
 */
export async function readDocumentHistoryTailSize(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<{ byteLength: number; hasCheckpoint: boolean; rowCount: number }> {
  await ensureSqlTables(execSql, documentTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  // One statement: an aggregate without GROUP BY always returns one row, and
  // the checkpoint probe rides along as an EXISTS column.
  const [totals] = await db
    .select({
      byteLength: sql<number>`coalesce(sum(length(${documentHistoryUpdates.updateData})), 0)`,
      hasCheckpoint: sql<number>`${exists(
        db
          .select({ localId: documentHistoryCheckpoints.localId })
          .from(documentHistoryCheckpoints)
          .where(
            and(
              eq(documentHistoryCheckpoints.appKind, scope.appKind),
              eq(documentHistoryCheckpoints.localId, scope.localId),
            ),
          ),
      )}`,
      rowCount: sql<number>`count(*)`,
    })
    .from(documentHistoryUpdates)
    .where(compactableTailInScope(scope));
  return {
    byteLength: Number(totals?.byteLength ?? 0),
    hasCheckpoint: Number(totals?.hasCheckpoint ?? 0) !== 0,
    rowCount: Number(totals?.rowCount ?? 0),
  };
}

interface DocumentHistoryTailEntry {
  readonly id: string;
  readonly updateData: string;
}

/**
 * The current compactable tail rows WITH their payloads, so a compactor can
 * prove each row's ops are covered by the snapshot it is about to install
 * (another pane's append may carry ops this pane's document has not merged
 * yet). Queued rows are never candidates.
 */
export async function listDocumentHistoryTailEntries(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<DocumentHistoryTailEntry[]> {
  await ensureSqlTables(execSql, documentTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({
      id: documentHistoryUpdates.id,
      updateData: documentHistoryUpdates.updateData,
    })
    .from(documentHistoryUpdates)
    .where(compactableTailInScope(scope));
  return rows.flatMap((row) =>
    row.id === null ? [] : [{ id: row.id, updateData: row.updateData }],
  );
}

/** Covered-tail ids per delete; the scope adds only a few binds. */
const HISTORY_ROW_CHUNK = 400;

/**
 * Replace the scope's checkpoint with a fresh full-history snapshot and
 * delete ONLY the tail rows the caller captured before exporting it. Every
 * append path writes its tail row after the ops are already in the live
 * document, so any row captured before the export is provably covered by
 * the snapshot — while a row appended concurrently (between export and this
 * delete) survives for the next compaction instead of being lost.
 */
export async function replaceDocumentHistoryCheckpoint(
  execSql: ExecSql,
  scope: DocumentScope,
  input: {
    coveredTailIds: readonly string[];
    endVersionVector: string;
    /**
     * Skip the monotonic version gate. Only for document CREATION, where any
     * existing checkpoint under this localId is the orphan of a failed prior
     * attempt (checkpoint written, record row never committed) — a retry's
     * fresh document need not dominate that orphan to replace it.
     */
    force?: boolean;
    snapshot: string;
    /**
     * Re-checked after acquiring the serialized mutation slot (like the
     * record-save path): a store reset/recreation that happened while this
     * call waited in the queue must abort the write, or a stale compactor
     * could install the OLD document's checkpoint over the new identity's.
     */
    stillCurrent?: () => boolean;
  },
): Promise<boolean> {
  await ensureSqlTables(execSql, documentTables);
  // Sequential (non-transactional) so callers already inside a transaction
  // can nest this. Crash between the statements leaves the new checkpoint
  // plus covered tail rows — a safe superset, since tail replay is
  // idempotent by op identity. The replacement itself is a compare-and-swap
  // on the stored revision, so the version gate cannot be bypassed by a
  // concurrent compactor between the read and the write: whoever loses the
  // CAS re-reads and re-evaluates the gate against the winner's checkpoint.
  return getClientSQLitePersistenceRuntime(execSql).runMutation(async (tx) => {
    if (input.stillCurrent?.() === false) {
      return false;
    }
    for (let attempt = 0; attempt < CHECKPOINT_CAS_ATTEMPTS; attempt += 1) {
      let replaced: boolean;
      try {
        replaced = await tryReplaceCheckpointOnce(tx, scope, input);
      } catch (error) {
        if (error instanceof CheckpointGateRejected) {
          // A fresher checkpoint dominates this candidate: no write, and
          // the caller's covered rows must stay for the covering pane.
          return false;
        }
        throw error;
      }
      if (!replaced) {
        // CAS lost to a concurrent writer — re-read and re-evaluate the
        // gate against the winner's checkpoint.
        continue;
      }
      for (
        let index = 0;
        index < input.coveredTailIds.length;
        index += HISTORY_ROW_CHUNK
      ) {
        // Never a queued row, even if a caller names one: its operations may
        // be in the checkpoint, but it is still the unsent update itself.
        await tx
          .delete(documentHistoryUpdates)
          .where(
            and(
              compactableTailInScope(scope),
              inArray(
                documentHistoryUpdates.id,
                input.coveredTailIds.slice(index, index + HISTORY_ROW_CHUNK),
              ),
            ),
          );
      }
      return true;
    }
    // Exhaustion must not read as durable success: creation and rebuild
    // callers persist record rows assuming the checkpoint landed.
    throw new Error(
      "Document history checkpoint replacement lost every CAS attempt",
    );
  });
}

const CHECKPOINT_CAS_ATTEMPTS = 16;

type MutationDb = Parameters<
  Parameters<
    ReturnType<typeof getClientSQLitePersistenceRuntime>["runMutation"]
  >[0]
>[0];

/**
 * One compare-and-swap attempt. Returns true when this caller's checkpoint
 * became the stored one, false when a concurrent writer won the CAS (the
 * caller re-reads and retries), and throws CheckpointGateRejected when a
 * fresher stored checkpoint dominates the candidate.
 */
async function tryReplaceCheckpointOnce(
  tx: MutationDb,
  scope: DocumentScope,
  input: {
    endVersionVector: string;
    force?: boolean;
    snapshot: string;
  },
): Promise<boolean> {
  const updatedAt = new Date().toISOString();
  const revision = crypto.randomUUID();
  const [stored] = await tx
    .select({
      endVersionVector: documentHistoryCheckpoints.endVersionVector,
      revision: documentHistoryCheckpoints.revision,
      snapshot: documentHistoryCheckpoints.snapshot,
    })
    .from(documentHistoryCheckpoints)
    .where(
      and(
        eq(documentHistoryCheckpoints.appKind, scope.appKind),
        eq(documentHistoryCheckpoints.localId, scope.localId),
      ),
    )
    .limit(1);

  if (!stored) {
    const inserted = await tx
      .insert(documentHistoryCheckpoints)
      .values({
        appKind: scope.appKind,
        localId: scope.localId,
        snapshot: input.snapshot,
        endVersionVector: input.endVersionVector,
        revision,
        updatedAt,
      })
      .onConflictDoNothing({
        target: [
          documentHistoryCheckpoints.appKind,
          documentHistoryCheckpoints.localId,
        ],
      })
      .returning({ localId: documentHistoryCheckpoints.localId });
    // Conflict means a concurrent writer inserted first — retry the gate.
    return inserted.length > 0;
  }

  // A stale compactor (a pane whose document has not merged another pane's
  // ops) must never replace a checkpoint it does not cover: the covered
  // pane may already have deleted its tail rows, so regressing the
  // checkpoint would leave those ops with no durable copy at all. Vector
  // dominance proves counter coverage; the retained-prefix identity also
  // proves the candidate carries the exact stored operations at those
  // counters rather than a same-frontier fork.
  if (input.force !== true) {
    if (
      !satisfiesVersionVector(input.endVersionVector, stored.endVersionVector)
    ) {
      throw new CheckpointGateRejected();
    }
    if (
      input.snapshot !== stored.snapshot &&
      !(await candidateContainsStoredCheckpointHistory({
        candidateSnapshot: input.snapshot,
        storedEndVersion: stored.endVersionVector,
        storedSnapshot: stored.snapshot,
      }))
    ) {
      throw new CheckpointGateRejected();
    }
  }

  const replaced = await tx
    .update(documentHistoryCheckpoints)
    .set({
      snapshot: input.snapshot,
      endVersionVector: input.endVersionVector,
      revision,
      updatedAt,
    })
    .where(
      and(
        eq(documentHistoryCheckpoints.appKind, scope.appKind),
        eq(documentHistoryCheckpoints.localId, scope.localId),
        eq(documentHistoryCheckpoints.revision, stored.revision),
      ),
    )
    .returning({ localId: documentHistoryCheckpoints.localId });
  return replaced.length > 0;
}

async function candidateContainsStoredCheckpointHistory(input: {
  candidateSnapshot: string;
  storedEndVersion: string;
  storedSnapshot: string;
}): Promise<boolean> {
  const [candidateDocument, storedDocument] = await Promise.all([
    createDocument("checkpoint-candidate-history-gate"),
    createDocument("checkpoint-stored-history-gate"),
  ]);
  try {
    importSnapshot(candidateDocument, base64ToBytes(input.candidateSnapshot));
    importSnapshot(storedDocument, base64ToBytes(input.storedSnapshot));
    return (
      exportFullHistoryIdentity(candidateDocument, input.storedEndVersion) ===
      exportFullHistoryIdentity(storedDocument)
    );
  } finally {
    candidateDocument.free();
    storedDocument.free();
  }
}

class CheckpointGateRejected extends Error {
  constructor() {
    super("checkpoint gate rejected");
    this.name = "CheckpointGateRejected";
  }
}

export async function deleteDocumentHistory(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<void> {
  await ensureSqlTables(execSql, documentTables);
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (tx) => {
    await tx
      .delete(documentHistoryCheckpoints)
      .where(
        and(
          eq(documentHistoryCheckpoints.appKind, scope.appKind),
          eq(documentHistoryCheckpoints.localId, scope.localId),
        ),
      );
    await tx
      .delete(documentHistoryUpdates)
      .where(
        and(
          eq(documentHistoryUpdates.appKind, scope.appKind),
          eq(documentHistoryUpdates.localId, scope.localId),
        ),
      );
  });
}
