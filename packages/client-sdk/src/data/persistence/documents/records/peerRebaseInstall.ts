import { base64ToBytes } from "@tearleads/encoding";
import { getImportBlobMetadata, satisfiesVersionVector } from "@tearleads/loro";
import { and, eq } from "drizzle-orm";
import {
  documentHistoryCheckpoints,
  documentHistoryUpdates,
  documents,
  documentTables,
} from "../../../sqlite/schema/documentRecordSchema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../../sqlite/sqlSchema";
import { insertDocumentPendingUpdateInTransaction } from "./documentPendingUpdatePersistence";
import type {
  DocumentScope,
  PendingUpdateFields,
} from "./documentPersistenceTypes";
import { deleteDocumentSyncVerdictsInTransaction } from "./documentSyncVerdictPersistence";

/**
 * How the record follows its fork. A document keeps the salt of its fresh
 * peer, so a reload writes on it, and fences out every writer that read the
 * old history with the next recovery generation. Container metadata keeps
 * its fresh peer in memory only; its writes are fenced by their content.
 */
export type DocumentPeerRebaseRecord =
  | { readonly kind: "document"; readonly peerSalt: string }
  | { readonly kind: "container_metadata" };

/** The fork a peer rebase built, and the record it was built from. */
export interface DocumentPeerRebaseInstall {
  readonly scope: DocumentScope;
  readonly expectedDocumentId: string;
  readonly expectedRecoveryGeneration: number;
  /**
   * The version of the document the rebase read, durable history included.
   * A history row or checkpoint past it was written after that read, and its
   * operations would be lost, so the install refuses.
   */
  readonly readVersion: string;
  /**
   * The fork's full history, which becomes the record's only history: a
   * full-history snapshot for a document, the exported updates for
   * container metadata.
   */
  readonly checkpoint: {
    readonly endVersionVector: string;
    readonly snapshot: string;
  };
  /** The fork's operations after the unsent base, the one queued update. */
  readonly pendingUpdate: PendingUpdateFields;
  readonly record: DocumentPeerRebaseRecord;
  /** Rechecked in the synchronous slice that dispatches the commit. */
  readonly stillCurrent: () => boolean;
}

function inScope(scope: DocumentScope) {
  return and(
    eq(documentHistoryUpdates.appKind, scope.appKind),
    eq(documentHistoryUpdates.localId, scope.localId),
  );
}

function updateEndVersion(row: {
  partialEndVersionVector: string | null;
  updateData: string;
}): string {
  return (
    row.partialEndVersionVector ??
    getImportBlobMetadata(base64ToBytes(row.updateData)).partialEndVersionVector
  );
}

/** Whether the record and every durable row are still what the rebase read. */
async function readStillCovered(
  tx: ClientSQLiteTransactionScope,
  input: DocumentPeerRebaseInstall,
): Promise<boolean> {
  const { scope } = input;
  const [record] = await tx
    .select({
      documentId: documents.documentId,
      recoveryGeneration: documents.recoveryGeneration,
    })
    .from(documents)
    .where(
      and(
        eq(documents.appKind, scope.appKind),
        eq(documents.localId, scope.localId),
      ),
    )
    .limit(1);
  if (
    !record ||
    record.documentId !== input.expectedDocumentId ||
    record.recoveryGeneration !== input.expectedRecoveryGeneration
  ) {
    return false;
  }
  const [checkpoint] = await tx
    .select({ endVersionVector: documentHistoryCheckpoints.endVersionVector })
    .from(documentHistoryCheckpoints)
    .where(
      and(
        eq(documentHistoryCheckpoints.appKind, scope.appKind),
        eq(documentHistoryCheckpoints.localId, scope.localId),
      ),
    )
    .limit(1);
  if (
    checkpoint &&
    !satisfiesVersionVector(input.readVersion, checkpoint.endVersionVector)
  ) {
    return false;
  }
  const rows = await tx
    .select({
      partialEndVersionVector: documentHistoryUpdates.partialEndVersionVector,
      updateData: documentHistoryUpdates.updateData,
    })
    .from(documentHistoryUpdates)
    .where(inScope(scope));
  return rows.every((row) =>
    satisfiesVersionVector(input.readVersion, updateEndVersion(row)),
  );
}

async function replaceHistoryWithFork(
  tx: ClientSQLiteTransactionScope,
  input: DocumentPeerRebaseInstall,
  updatedAt: string,
): Promise<void> {
  const { scope } = input;
  // Every row is covered by the fork: tail history, queued updates that carry
  // cut operations, and outbox rows alike. The one update the fork queues
  // below replaces all of them.
  await tx.delete(documentHistoryUpdates).where(inScope(scope)).run();
  const checkpoint = {
    endVersionVector: input.checkpoint.endVersionVector,
    // A new revision makes a concurrent compactor's compare-and-swap fail, so
    // it re-reads this checkpoint before writing its own.
    revision: crypto.randomUUID(),
    snapshot: input.checkpoint.snapshot,
    updatedAt,
  };
  await tx
    .insert(documentHistoryCheckpoints)
    .values({ ...scope, ...checkpoint })
    .onConflictDoUpdate({
      target: [
        documentHistoryCheckpoints.appKind,
        documentHistoryCheckpoints.localId,
      ],
      set: checkpoint,
    })
    .run();
  await insertDocumentPendingUpdateInTransaction(tx, {
    createdAt: updatedAt,
    pendingUpdate: input.pendingUpdate,
    scope,
    updateId: crypto.randomUUID(),
  });
  // The refused updates' void rows and preemption notices name ids the
  // rebase removed; the processed cursor named the old frontier.
  await deleteDocumentSyncVerdictsInTransaction(tx, scope.appKind, [
    scope.localId,
  ]);
}

function recordSet(input: DocumentPeerRebaseInstall, updatedAt: string) {
  const frontier = {
    snapshotEndVersion: input.checkpoint.endVersionVector,
    updatedAt,
  };
  return input.record.kind === "document"
    ? {
        ...frontier,
        peerSalt: input.record.peerSalt,
        pendingBaseVersion: input.checkpoint.endVersionVector,
        recoveryGeneration: input.expectedRecoveryGeneration + 1,
      }
    : frontier;
}

/**
 * Move a record onto the fork a peer rebase built, in one transaction: the
 * fork's full history becomes the checkpoint, every history row goes, one
 * update queues the fork's unsent operations, and the record takes the
 * fork's frontier (and, for a document, its fresh peer's salt and the next
 * recovery generation). Returns false, writing nothing, when the record or
 * its history moved past what the rebase read.
 */
export async function installDocumentPeerRebase(
  execSql: ExecSql,
  input: DocumentPeerRebaseInstall,
): Promise<boolean> {
  await ensureSqlTables(execSql, documentTables);
  const runtime = getClientSQLitePersistenceRuntime(execSql);
  const outcome = await runtime.guardedTransaction(
    async (tx) => {
      if (!input.stillCurrent() || !(await readStillCovered(tx, input))) {
        return false;
      }
      const updatedAt = new Date().toISOString();
      const { scope } = input;
      await tx
        .update(documents)
        .set(recordSet(input, updatedAt))
        .where(
          and(
            eq(documents.appKind, scope.appKind),
            eq(documents.localId, scope.localId),
          ),
        )
        .run();
      await replaceHistoryWithFork(tx, input, updatedAt);
      return true;
    },
    input.stillCurrent,
    { behavior: "immediate" },
  );
  return outcome.committed && outcome.result === true;
}
