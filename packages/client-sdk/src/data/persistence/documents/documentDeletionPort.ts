import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../sqlite/sqlSchema";

/**
 * Removes a deleted document's placements inside its deletion transaction:
 * its container link rows with their tombstone holds, then its queued
 * placement intents. Container Contents owns those tables, so the composition
 * root binds its implementation.
 */
export type DocumentPlacementCleanup = (
  tx: ClientSQLiteTransactionScope,
  documentId: string,
) => Promise<void>;

/**
 * The `DocumentsPersistence` members that delete a document. Each runs
 * `deleteDocumentPlacements` inside its deletion transaction.
 */
export interface DocumentDeletionPort<StoredRecord> {
  deleteDocument: (
    execSql: ExecSql,
    localId: string,
    deleteDocumentPlacements: DocumentPlacementCleanup,
  ) => Promise<void>;
  /**
   * Delete the canonical row and every side row only when its security identity
   * and container placement still match the captured record. The comparison,
   * deletes, and client projection callback must share one write transaction.
   */
  deleteDocumentIfMatches: (
    execSql: ExecSql,
    expectedRecord: StoredRecord,
    deleteClientProjection: (transactionExecSql: ExecSql) => Promise<void>,
    deleteDocumentPlacements: DocumentPlacementCleanup,
  ) => Promise<boolean>;
  /**
   * Delete orphaned side rows only if the canonical document is still absent.
   * The absence check, row cleanup, and client projection callback must share
   * one write transaction so a concurrent create is preserved.
   */
  deleteDocumentSideRowsIfAbsent: (
    execSql: ExecSql,
    localId: string,
    expectedDocumentId: string | null,
    deleteClientProjection: (transactionExecSql: ExecSql) => Promise<void>,
    deleteDocumentPlacements: DocumentPlacementCleanup,
  ) => Promise<boolean>;
}
