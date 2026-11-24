import { and, eq } from "drizzle-orm";
import { documents } from "../../../sqlite/schema/documentRecordSchema";
import { documentSyncProgress } from "../../../sqlite/schema/documentSyncVerdictSchema";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";
import type { DocumentScope } from "./documentPersistenceTypes";

/** A seed is its new document's one update. */
const SEED_UPDATE_COUNT = 1;

/**
 * Records the processed cursor a committed seed stands for. A create that
 * commits its seed makes the seed its document's only update, and this
 * device wrote it, so the first pull the seed replaces would have ended at
 * it with a count of one. Without the cursor, a container listing that
 * counts the seed would owe this device a read of its own update.
 *
 * Runs in the transaction that saves the seeded record, after the save, so
 * the cursor's version is the frontier that record holds. A scope that
 * already keeps a cursor keeps it, and a record that was not saved (a purged
 * document id) gets none.
 */
export async function recordCommittedSeedProgressInTransaction(
  tx: Pick<ClientSQLiteTransactionScope, "insert" | "select">,
  input: {
    readonly documentId: string;
    readonly judge: string;
    readonly scope: DocumentScope;
    readonly seedUpdateId: string;
  },
): Promise<void> {
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
  if (!record || record.documentId !== input.documentId) return;
  await tx
    .insert(documentSyncProgress)
    .values({
      appKind: input.scope.appKind,
      documentId: input.documentId,
      judge: input.judge,
      localId: input.scope.localId,
      pullJudge: null,
      pullSentCursor: null,
      throughUpdateCount: SEED_UPDATE_COUNT,
      throughUpdateId: input.seedUpdateId,
      throughVersion: record.snapshotEndVersion,
    })
    .onConflictDoNothing()
    .run();
}
