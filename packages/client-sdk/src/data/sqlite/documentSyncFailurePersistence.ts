import { and, eq, isNotNull } from "drizzle-orm";
import type { DocumentScope } from "./documentPersistenceTypes";
import {
  containerCreateIntents,
  containerCreateIntentTables,
  containerMoveIntents,
  containerMoveIntentTables,
  documentMoveIntents,
  documentMoveIntentTables,
  documentSyncFailures,
  documentTables,
} from "./schema";
import { getClientSQLitePersistenceRuntime } from "./sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "./sqlSchema";

interface DocumentSyncFailureFields {
  readonly attemptedAt: string;
  readonly message: string;
  readonly status: number | null;
}

/**
 * Upsert the last terminal failure or incoming-update quarantine for a document
 * scope. The durable pending-update queue has no status columns, so this row is
 * what lets the write-queue view explain a blocked document. One row per scope:
 * a newer failure replaces the old.
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
 * Whether any queued local write has recorded a terminal failure — a
 * `document_sync_failures` row or an intent row carrying `last_error`. This is
 * the evidence gate for recovery triggers (e.g. re-arming write lanes when org
 * access is restored): without it a transient denial during bootstrap would
 * fire recovery work with nothing to recover, racing the startup sync passes.
 */
export async function hasRecordedTerminalSyncFailures(
  execSql: ExecSql,
): Promise<boolean> {
  await ensureSqlTables(execSql, [
    ...documentTables,
    ...containerCreateIntentTables,
    ...containerMoveIntentTables,
    ...documentMoveIntentTables,
  ]);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const [failure] = await db
    .select({ localId: documentSyncFailures.localId })
    .from(documentSyncFailures)
    .limit(1);
  if (failure) {
    return true;
  }
  const [createIntent] = await db
    .select({ id: containerCreateIntents.id })
    .from(containerCreateIntents)
    .where(isNotNull(containerCreateIntents.lastError))
    .limit(1);
  if (createIntent) {
    return true;
  }
  const [moveIntent] = await db
    .select({ id: containerMoveIntents.id })
    .from(containerMoveIntents)
    .where(isNotNull(containerMoveIntents.lastError))
    .limit(1);
  if (moveIntent) {
    return true;
  }
  const [documentMoveIntent] = await db
    .select({ id: documentMoveIntents.id })
    .from(documentMoveIntents)
    .where(isNotNull(documentMoveIntents.lastError))
    .limit(1);
  return documentMoveIntent !== undefined;
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
