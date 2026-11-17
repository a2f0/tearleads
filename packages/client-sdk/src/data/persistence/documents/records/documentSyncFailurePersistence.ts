import { and, eq, isNotNull } from "drizzle-orm";
import { localIntents } from "../../../sqlite/schema";
import { documents } from "../../../sqlite/schema/documentRecordSchema";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";
import type { DocumentScope } from "./documentPersistenceTypes";

export interface DocumentSyncFailureFields {
  readonly attemptedAt: string;
  readonly message: string;
}

/** The `documents` column values of a scope with no recorded failure. */
export const CLEARED_DOCUMENT_SYNC_FAILURE = {
  syncFailureAttemptedAt: null,
  syncFailureMessage: null,
} as const;

function scopeWhere(scope: DocumentScope) {
  return and(
    eq(documents.appKind, scope.appKind),
    eq(documents.localId, scope.localId),
  );
}

/**
 * Record the last terminal failure or incoming-update quarantine on a document
 * scope's row. The durable pending-update queue has no status columns, so
 * these columns let the write-queue view explain a blocked document. A newer
 * failure replaces the old. A scope with no `documents` row has nothing left
 * to explain, so the update is a no-op there.
 */
export async function recordDocumentSyncFailureInTransaction(
  tx: ClientSQLiteTransactionScope,
  scope: DocumentScope,
  failure: DocumentSyncFailureFields,
): Promise<void> {
  await tx
    .update(documents)
    .set({
      syncFailureAttemptedAt: failure.attemptedAt,
      syncFailureMessage: failure.message,
    })
    .where(scopeWhere(scope))
    .run();
}

/**
 * Whether any queued local write has recorded a terminal failure — a document
 * row carrying a sync failure or an intent row carrying `last_error`. This is
 * the evidence gate for recovery triggers (e.g. re-arming write lanes when org
 * access is restored): without it a transient denial during bootstrap would
 * fire recovery work with nothing to recover, racing the startup sync passes.
 */
export async function selectHasRecordedTerminalSyncFailures(
  db: Pick<ClientSQLiteTransactionScope, "select">,
): Promise<boolean> {
  const [failure] = await db
    .select({ localId: documents.localId })
    .from(documents)
    .where(isNotNull(documents.syncFailureMessage))
    .limit(1);
  if (failure) {
    return true;
  }
  const [intent] = await db
    .select({ id: localIntents.id })
    .from(localIntents)
    .where(isNotNull(localIntents.lastError))
    .limit(1);
  return intent !== undefined;
}

/**
 * Clear a scope's recorded failure inside a caller's transaction. Called when
 * a later sync pass for the scope succeeds and whenever the scope's local sync
 * state is torn down, so a stale failure never outlives the condition it
 * describes.
 */
export async function clearDocumentSyncFailureInTransaction(
  tx: ClientSQLiteTransactionScope,
  scope: DocumentScope,
): Promise<void> {
  await tx
    .update(documents)
    .set(CLEARED_DOCUMENT_SYNC_FAILURE)
    .where(scopeWhere(scope))
    .run();
}
