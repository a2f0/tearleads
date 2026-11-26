import { mergeVersionVectors, versionVectorsEqual } from "@tearleads/loro";
import { and, eq } from "drizzle-orm";
import { documents } from "../../../sqlite/schema/documentRecordSchema";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";
import { settleQueuedDocumentUpdatesInTransaction } from "./documentPendingUpdatePersistence";
import type { DocumentScope } from "./documentPersistenceTypes";

function inScope(scope: DocumentScope) {
  return and(
    eq(documents.appKind, scope.appKind),
    eq(documents.localId, scope.localId),
  );
}

/**
 * Raise the record's committed version to cover `versions`, each one a
 * version the server was seen to hold: per peer it keeps the highest
 * counter. The column has two writers that raise it, this one and a peer
 * recovery's install, and both only merge: nothing that changes the queue,
 * the history, or the record can lower it. A discard and a remote reset
 * clear it. `current` is the column as the caller read it in this
 * transaction, so a response that shows nothing new writes nothing.
 */
async function raiseDocumentCommittedVersionInTransaction(
  tx: Pick<ClientSQLiteTransactionScope, "update">,
  scope: DocumentScope,
  current: string | null | undefined,
  versions: readonly string[],
): Promise<void> {
  if (versions.length === 0) return;
  const raised = mergeVersionVectors([
    ...(current ? [current] : []),
    ...versions,
  ]);
  if (current && versionVectorsEqual(raised, current)) return;
  await tx
    .update(documents)
    .set({ committedVersion: raised })
    .where(inScope(scope))
    .run();
}

/**
 * Settle a sync response in the caller's one transaction. The updates the
 * server acknowledged leave the queue, and the record's committed version
 * rises to cover `committedVersions`: the spans of those updates and of the
 * served updates the pass accepted. `record` is the record as this
 * transaction read it.
 */
export async function settleDocumentSyncResponseInTransaction(
  tx: ClientSQLiteTransactionScope,
  scope: DocumentScope,
  record: { readonly committedVersion?: string | undefined },
  response: {
    readonly acceptedPendingUpdateIds: readonly string[];
    readonly committedVersions?: readonly string[] | undefined;
  },
): Promise<void> {
  await settleQueuedDocumentUpdatesInTransaction(
    tx,
    scope,
    response.acceptedPendingUpdateIds,
  );
  await raiseDocumentCommittedVersionInTransaction(
    tx,
    scope,
    record.committedVersion,
    response.committedVersions ?? [],
  );
}

/**
 * Forget what the server was seen to commit for a record whose history a
 * discard drops: the operations it writes next may reuse counters that
 * history held, and a version kept across the discard would call them
 * committed. A remote reset clears the column too
 * (`resetDocumentServerIdentity`).
 */
export async function clearDocumentCommittedVersionInTransaction(
  tx: Pick<ClientSQLiteTransactionScope, "update">,
  scope: DocumentScope,
): Promise<void> {
  await tx
    .update(documents)
    .set({ committedVersion: null })
    .where(inScope(scope))
    .run();
}
