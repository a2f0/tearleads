import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DocumentScope } from "./documentPersistenceTypes";
import {
  documentHistoryCheckpoints,
  documentHistoryUpdates,
  documentTables,
} from "./schema";
import { getClientSQLitePersistenceRuntime } from "./sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "./sqlSchema";

/**
 * Compaction thresholds: once the tail carries this many rows or bytes, the
 * next persist of a full-history-capable document exports a fresh checkpoint
 * and clears the tail. Small enough to keep restore replay short, large
 * enough that a full-history export (O(history)) happens once per burst of
 * edits instead of per keystroke.
 */
export const DOCUMENT_HISTORY_COMPACTION_MAX_ROWS = 200;
export const DOCUMENT_HISTORY_COMPACTION_MAX_BYTES = 512 * 1024;

interface DocumentHistoryRestoreState {
  readonly snapshot: string;
  readonly tailUpdates: readonly string[];
}

export async function appendDocumentHistoryUpdates(
  execSql: ExecSql,
  scope: DocumentScope,
  updates: readonly string[],
): Promise<void> {
  if (updates.length === 0) {
    return;
  }
  await ensureSqlTables(execSql, documentTables);
  const createdAt = new Date().toISOString();
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    await db.insert(documentHistoryUpdates).values(
      updates.map((updateData) => ({
        id: crypto.randomUUID(),
        appKind: scope.appKind,
        localId: scope.localId,
        updateData,
        createdAt,
      })),
    );
  });
}

/**
 * The checkpoint + ordered tail for a scope, or null when no checkpoint
 * exists (a legacy row persisted before history durability; the caller falls
 * back to the shallow snapshot).
 */
export async function loadDocumentHistoryRestoreState(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<DocumentHistoryRestoreState | null> {
  await ensureSqlTables(execSql, documentTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
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
  if (!checkpoint) {
    return null;
  }

  const tail = await db
    .select({
      id: documentHistoryUpdates.id,
      updateData: documentHistoryUpdates.updateData,
    })
    .from(documentHistoryUpdates)
    .where(
      and(
        eq(documentHistoryUpdates.appKind, scope.appKind),
        eq(documentHistoryUpdates.localId, scope.localId),
      ),
    )
    .orderBy(
      asc(documentHistoryUpdates.createdAt),
      asc(documentHistoryUpdates.id),
    );

  return {
    snapshot: checkpoint.snapshot,
    tailUpdates: tail.map((row) => row.updateData),
  };
}

export async function readDocumentHistoryTailSize(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<{ byteLength: number; hasCheckpoint: boolean; rowCount: number }> {
  await ensureSqlTables(execSql, documentTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const [totals] = await db
    .select({
      byteLength: sql<number>`coalesce(sum(length(${documentHistoryUpdates.updateData})), 0)`,
      rowCount: sql<number>`count(*)`,
    })
    .from(documentHistoryUpdates)
    .where(
      and(
        eq(documentHistoryUpdates.appKind, scope.appKind),
        eq(documentHistoryUpdates.localId, scope.localId),
      ),
    );
  const [checkpoint] = await db
    .select({ localId: documentHistoryCheckpoints.localId })
    .from(documentHistoryCheckpoints)
    .where(
      and(
        eq(documentHistoryCheckpoints.appKind, scope.appKind),
        eq(documentHistoryCheckpoints.localId, scope.localId),
      ),
    )
    .limit(1);
  return {
    byteLength: Number(totals?.byteLength ?? 0),
    hasCheckpoint: checkpoint !== undefined,
    rowCount: Number(totals?.rowCount ?? 0),
  };
}

export async function listDocumentHistoryTailIds(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<string[]> {
  await ensureSqlTables(execSql, documentTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({ id: documentHistoryUpdates.id })
    .from(documentHistoryUpdates)
    .where(
      and(
        eq(documentHistoryUpdates.appKind, scope.appKind),
        eq(documentHistoryUpdates.localId, scope.localId),
      ),
    );
  return rows.flatMap((row) => (row.id === null ? [] : [row.id]));
}

const COVERED_TAIL_DELETE_CHUNK = 400;

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
  input: { coveredTailIds: readonly string[]; snapshot: string },
): Promise<void> {
  await ensureSqlTables(execSql, documentTables);
  const updatedAt = new Date().toISOString();
  // Sequential (non-transactional) so callers already inside a transaction
  // can nest this. Crash between the statements leaves the new checkpoint
  // plus covered tail rows — a safe superset, since tail replay is
  // idempotent by op identity.
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (tx) => {
    await tx
      .insert(documentHistoryCheckpoints)
      .values({
        appKind: scope.appKind,
        localId: scope.localId,
        snapshot: input.snapshot,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [
          documentHistoryCheckpoints.appKind,
          documentHistoryCheckpoints.localId,
        ],
        set: { snapshot: input.snapshot, updatedAt },
      });
    for (
      let index = 0;
      index < input.coveredTailIds.length;
      index += COVERED_TAIL_DELETE_CHUNK
    ) {
      await tx
        .delete(documentHistoryUpdates)
        .where(
          and(
            eq(documentHistoryUpdates.appKind, scope.appKind),
            eq(documentHistoryUpdates.localId, scope.localId),
            inArray(
              documentHistoryUpdates.id,
              input.coveredTailIds.slice(
                index,
                index + COVERED_TAIL_DELETE_CHUNK,
              ),
            ),
          ),
        );
    }
  });
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
