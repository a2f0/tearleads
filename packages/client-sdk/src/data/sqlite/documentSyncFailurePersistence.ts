import { and, eq } from "drizzle-orm";
import type { DocumentScope } from "./documentPersistenceTypes";
import { documentSyncFailures } from "./schema";
import { getClientSQLitePersistenceRuntime } from "./sqlitePersistenceRuntime";
import type { ExecSql } from "./sqlSchema";

interface DocumentSyncFailureFields {
  readonly attemptedAt: string;
  readonly message: string;
  readonly status: number | null;
}

/**
 * Upsert the last terminal outbound-sync failure for a document scope. The
 * durable pending-update queue has no status columns, so this row is what lets
 * the write-queue view explain a stuck write (e.g. a 403 after shared-org
 * access was revoked). One row per scope: a newer failure replaces the old.
 */
export async function recordDocumentSyncFailure(
  execSql: ExecSql,
  scope: DocumentScope,
  failure: DocumentSyncFailureFields,
): Promise<void> {
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    await db
      .insert(documentSyncFailures)
      .values({
        appKind: scope.appKind,
        localId: scope.localId,
        status: failure.status,
        message: failure.message,
        attemptedAt: failure.attemptedAt,
      })
      .onConflictDoUpdate({
        target: [documentSyncFailures.appKind, documentSyncFailures.localId],
        set: {
          status: failure.status,
          message: failure.message,
          attemptedAt: failure.attemptedAt,
        },
      })
      .run();
  });
}

/**
 * Drop the recorded failure for a scope. Called when a later sync pass for the
 * scope succeeds and whenever the scope's local sync state is torn down, so a
 * stale failure never outlives the condition it describes.
 */
export async function clearDocumentSyncFailure(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<void> {
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    await db
      .delete(documentSyncFailures)
      .where(
        and(
          eq(documentSyncFailures.appKind, scope.appKind),
          eq(documentSyncFailures.localId, scope.localId),
        ),
      )
      .run();
  });
}
