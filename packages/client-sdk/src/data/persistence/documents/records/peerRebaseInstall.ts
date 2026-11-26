import { base64ToBytes } from "@tearleads/encoding";
import {
  getImportBlobMetadata,
  mergeVersionVectors,
  satisfiesVersionVector,
} from "@tearleads/loro";
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
import {
  insertDocumentPendingUpdateInTransaction,
  unqueueDocumentScopesInTransaction,
} from "./documentPendingUpdatePersistence";
import type {
  DocumentScope,
  PendingUpdateFields,
} from "./documentPersistenceTypes";
import { clearDocumentSyncVerdictsInTransaction } from "./documentSyncVerdictPersistence";

/**
 * How the record follows its fork. A document keeps the salt of its fresh
 * peer, so a reload writes on it, and fences out every writer that read the
 * old history with the next recovery generation. Container metadata keeps
 * its fresh peer in memory only; its writes are fenced by their content.
 */
export type DocumentPeerRebaseRecord =
  | { readonly kind: "document"; readonly peerSalt: string }
  | { readonly kind: "container_metadata" };

/** The record a peer refusal's recovery read, and the one update it queues. */
interface DocumentPeerRecoveryInstall {
  readonly scope: DocumentScope;
  readonly expectedDocumentId: string;
  readonly expectedRecoveryGeneration: number;
  /**
   * The version of the document the recovery read, durable history included.
   * A history row or checkpoint past it was written after that read, and its
   * operations would be lost, so the install refuses.
   */
  readonly readVersion: string;
  /**
   * The ids of the updates queued when the recovery read the record. It
   * kept what it took to be unsent; another runtime that settled, merged,
   * rekeyed, or queued an update since changed that, and the one update
   * could replay committed operations or miss queued ones, so the install
   * refuses.
   */
  readonly queuedUpdateIds: readonly string[];
  /** The one update that replaces the queue. */
  readonly pendingUpdate: PendingUpdateFields;
  /**
   * What the device knew was committed when it planned the recovery. The
   * install merges it into the record's committed version, keeping the
   * higher counter on each peer: the one update may start below operations
   * that were known committed only for being outside the queue.
   */
  readonly committedVersion: string;
  /** Rechecked in the synchronous slice that dispatches the commit. */
  readonly stillCurrent: () => boolean;
}

/** The fork a peer rebase built, which replaces the record's history. */
interface DocumentPeerForkInstall extends DocumentPeerRecoveryInstall {
  readonly kind: "fork";
  /**
   * The fork's full history, which becomes the record's only history: a
   * full-history snapshot for a document, the exported updates for
   * container metadata.
   */
  readonly checkpoint: {
    readonly endVersionVector: string;
    readonly snapshot: string;
  };
  readonly record: DocumentPeerRebaseRecord;
}

/**
 * A relay of operations the server lost. The document and its history stay
 * as they are; only the queue changes, to the one update that sends the lost
 * operations again under their own peers.
 */
interface DocumentPeerRelayInstall extends DocumentPeerRecoveryInstall {
  readonly kind: "relay";
}

/** What a peer refusal's recovery installs: a rebase's fork, or a relay. */
export type DocumentPeerRebaseInstall =
  | DocumentPeerForkInstall
  | DocumentPeerRelayInstall;

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

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const ids = new Set(left);
  return ids.size === new Set(right).size && right.every((id) => ids.has(id));
}

/**
 * The record's committed version raised to what the recovery knew, or null
 * when the record is no longer the one the recovery read.
 */
async function readRaisedCommittedVersion(
  tx: ClientSQLiteTransactionScope,
  input: DocumentPeerRebaseInstall,
): Promise<string | null> {
  const { scope } = input;
  const [record] = await tx
    .select({
      committedVersion: documents.committedVersion,
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
    return null;
  }
  return mergeVersionVectors([
    ...(record.committedVersion === null ? [] : [record.committedVersion]),
    input.committedVersion,
  ]);
}

/** Whether every durable row is still what the recovery read. */
async function historyStillCovered(
  tx: ClientSQLiteTransactionScope,
  input: DocumentPeerRebaseInstall,
): Promise<boolean> {
  const { scope } = input;
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
      updateId: documentHistoryUpdates.updateId,
    })
    .from(documentHistoryUpdates)
    .where(inScope(scope));
  const queuedIds = rows.flatMap((row) =>
    row.updateId === null ? [] : [row.updateId],
  );
  return (
    sameIds(queuedIds, input.queuedUpdateIds) &&
    rows.every((row) =>
      satisfiesVersionVector(input.readVersion, updateEndVersion(row)),
    )
  );
}

async function replaceHistoryWithFork(
  tx: ClientSQLiteTransactionScope,
  input: DocumentPeerForkInstall,
  updatedAt: string,
  committedVersion: string,
): Promise<void> {
  const { scope } = input;
  await tx
    .update(documents)
    .set({ ...recordSet(input, updatedAt), committedVersion })
    .where(
      and(
        eq(documents.appKind, scope.appKind),
        eq(documents.localId, scope.localId),
      ),
    )
    .run();
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
  // rebase removed; the processed cursor named the old frontier. The slots
  // the record saw recorded stay: the rebase changes no content, and a live
  // store, which already counts them seen, would not record them again.
  await clearDocumentSyncVerdictsInTransaction(tx, scope.appKind, [
    scope.localId,
  ]);
}

/**
 * Every queued update stops being queued and the relay's one update takes
 * their place. A local row keeps its content as history, which the relay
 * leaves alone, so the record's checkpoint and its verdicts stay too. Of
 * the record only its committed version moves: the relay's update starts
 * below operations the device knew were committed for being outside the
 * queue, and the record must go on saying so.
 */
async function replaceQueueWithRelay(
  tx: ClientSQLiteTransactionScope,
  input: DocumentPeerRelayInstall,
  createdAt: string,
  committedVersion: string,
): Promise<void> {
  const { scope } = input;
  await tx
    .update(documents)
    .set({ committedVersion })
    .where(
      and(
        eq(documents.appKind, scope.appKind),
        eq(documents.localId, scope.localId),
      ),
    )
    .run();
  await unqueueDocumentScopesInTransaction(tx, [scope]);
  await insertDocumentPendingUpdateInTransaction(tx, {
    createdAt,
    pendingUpdate: input.pendingUpdate,
    scope,
    updateId: crypto.randomUUID(),
  });
}

function recordSet(input: DocumentPeerForkInstall, updatedAt: string) {
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
 * Install a peer refusal's recovery in one transaction. A fork moves the
 * record onto it: the fork's full history becomes the checkpoint, every
 * history row goes, one update queues the fork's unsent operations, and the
 * record takes the fork's frontier (and, for a document, its fresh peer's
 * salt and the next recovery generation). A relay replaces only the queue,
 * with its one update, and leaves the history as it is. Either one raises
 * the record's committed version to what the recovery knew. Returns false,
 * writing nothing, when the record or its history moved past what the
 * recovery read.
 */
export async function installDocumentPeerRebase(
  execSql: ExecSql,
  input: DocumentPeerRebaseInstall,
): Promise<boolean> {
  await ensureSqlTables(execSql, documentTables);
  const runtime = getClientSQLitePersistenceRuntime(execSql);
  const outcome = await runtime.guardedTransaction(
    async (tx) => {
      if (!input.stillCurrent()) return false;
      const committed = await readRaisedCommittedVersion(tx, input);
      if (committed === null || !(await historyStillCovered(tx, input))) {
        return false;
      }
      const now = new Date().toISOString();
      if (input.kind === "fork") {
        await replaceHistoryWithFork(tx, input, now, committed);
      } else {
        await replaceQueueWithRelay(tx, input, now, committed);
      }
      return true;
    },
    input.stillCurrent,
    { behavior: "immediate" },
  );
  return outcome.committed && outcome.result === true;
}
